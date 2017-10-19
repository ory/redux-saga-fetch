// @flow
// createRegistry, createRequestAction, createRequestFailureAction, createRequestSuccessAction, createRootReducer, createRootSaga
import { createAction, handleActions } from 'redux-actions'
import { all, call, put, takeLatest } from 'redux-saga/effects'
import 'babel-core/register'
import 'babel-polyfill'

type Registry = {
  [key: string]: {
    fetcher: () => Promise<*>,
    takeStrategy: Function,
  },
}

type State = {
  reduxSagaFetch: {
    [key: string]: {
      status: string,
      payload: mixed,
    },
  },
}

const pathOr = (p: any[], o: any, d: any) =>
  p.reduce((xs, x) => (xs && xs[x] ? xs[x] : d), o)

export const isFetching = (key: string) => (state: State) =>
  pathOr(['reduxSagaFetch', key, 'status'], state, null) === STATE_FETCHING
export const isFetchFailure = (key: string) => (state: State) =>
  pathOr(['reduxSagaFetch', key, 'status'], state, null) === STATE_FAILURE
export const isFetchSuccess = (key: string) => (state: State) =>
  pathOr(['reduxSagaFetch', key, 'status'], state, null) === STATE_SUCCESS
export const selectPayload = (key: string) => (state: State) =>
  pathOr(['reduxSagaFetch', key, 'payload'], state, undefined)
export const selectErrorPayload = (key: string) => (state: State) =>
  pathOr(['reduxSagaFetch', key, 'errorPayload'], state, undefined)

const createDefaultWorker = (fetcher, successAction, failureAction) =>
  function*(action) {
    try {
      const result = yield call(fetcher, action.payload)
      yield put(successAction(result))
    } catch (error) {
      yield put(failureAction(error))
    }
  }

const createWatcher = (action, worker, takeStrategy) =>
  function*() {
    yield takeStrategy(action, worker)
  }

const createWatchers = (registry: Registry) =>
  Object.keys(registry).map(key => {
    const { fetcher, takeStrategy } = registry[key]
    const action = createRequestAction(key)
    const worker = createDefaultWorker(
      fetcher,
      createRequestSuccessAction(key),
      createRequestFailureAction(key)
    )

    return createWatcher(action, worker, takeStrategy)()
  })

const STATE_FETCHING = 'FETCHING'
const STATE_SUCCESS = 'SUCCESS'
const STATE_FAILURE = 'FAILURE'

class SagaFetcher {
  registry: Registry = {}

  constructor(
    config: {
      [key: string]: {
        fetcher: () => Promise<*>,
        takeStrategy: any,
      },
    } = {}
  ) {
    if (typeof config !== 'object') {
      throw new Error(`Registry must be an object but got ${typeof config}`)
    }

    Object.keys(config).forEach(key => {
      const options = config[key]
      this.add(key, options.fetcher, options.takeStrategy)
    })
  }

  add = (
    key: string,
    fetcher: (arg: any) => Promise<*>,
    takeStrategy: Function = takeLatest
  ) => {
    if (typeof fetcher !== 'function') {
      throw new Error(
        `Expected a function for key ${key} but got ${typeof fetcher}`
      )
    }

    this.registry[key] = {
      fetcher,
      takeStrategy: takeStrategy,
    }
  }

  wrapRootReducer = (reducers: any = {}) => {
    const handlers = {}

    Object.keys(this.registry).forEach(key => {
      handlers[createRequestAction(key).toString()] = (state, action) => ({
        ...state,
        [key]: {
          status: STATE_FETCHING,
          payload: undefined,
          errorPayload: undefined,
        },
      })
      handlers[createRequestSuccessAction(key).toString()] = (
        state,
        { payload }
      ) => ({
        ...state,
        [key]: { status: STATE_SUCCESS, payload, errorPayload: undefined },
      })
      handlers[createRequestFailureAction(key).toString()] = (
        state,
        { payload }
      ) => ({
        ...state,
        [key]: {
          status: STATE_FAILURE,
          payload: undefined,
          errorPayload: payload,
        },
      })
    })

    return {
      ...reducers,
      reduxSagaFetch: handleActions(handlers, {}),
    }
  }

  createRootSaga = () => {
    const { registry } = this
    return function* rootSaga(): Generator<*, *, *> {
      yield all(createWatchers(registry))
    }
  }
}

/**
 * Creates a new redux-saga-fetch registry.
 *
 *   const registry = createSagaFetcher({
 *     user: {
 *       fetcher: (id) => superagent.get('http://myapi.com/users/' + id)
 *     }
 *   })
 *
 * @param config
 */
export const createSagaFetcher = (config: Registry) => new SagaFetcher(config)

/**
 * Create a request action creator for redux.
 *
 * @param key
 */
export const createRequestAction = (key: string) =>
  createAction(`REDUX_SAGA_FETCH_${key.toUpperCase()}_REQUEST`)

/**
 * Creates an action that is dispatched once a request action succeeds.
 *
 * @param key
 */
export const createRequestSuccessAction = (key: string) =>
  createAction(`REDUX_SAGA_FETCH_${key.toUpperCase()}_SUCCESS`)

/**
 * Creates an action that is dispatched once a request action fails.
 *
 * @param key
 */
export const createRequestFailureAction = (key: string) =>
  createAction(`REDUX_SAGA_FETCH_${key.toUpperCase()}_FAILURE`)
