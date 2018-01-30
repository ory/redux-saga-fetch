// @flow
// createRegistry, createRequestAction, createRequestFailureAction, createRequestSuccessAction, createRootReducer, createRootSaga
import { createAction, handleActions } from 'redux-actions'
import { all, call, put, takeLatest, select, take } from 'redux-saga/effects'
import 'babel-core/register'
import 'babel-polyfill'

type OptionsType = {
  fetcher: () => Promise<*>,
  takeStrategy?: Function,
  group?: string,
}

type Registry = {
  [key: string]: OptionsType,
}

type StateItem = {
  status: string,
  payload: mixed,
  errorPayload: mixed,
}

type State = {
  reduxSagaFetch: {
    [key: string]: StateItem,
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
export const hasFetchFailures = (state: State) => {
  const states = pathOr(['reduxSagaFetch'], state, {})
  return Boolean(
    Object.keys(states).find(key => states[key].status === STATE_FAILURE)
  )
}

// mapStates filters all the states by status and then maps with the custom map function
const mapStates = (
  state: State,
  status: string,
  mapFunc: (curr: StateItem, key: string) => mixed
) => {
  const states = pathOr(['reduxSagaFetch'], state, {})
  return Object.keys(states)
    .filter(key => states[key].status === status)
    .map((key: string) => mapFunc(states[key], key))
}

export const selectErrorPayloads = (state: State) =>
  mapStates(state, STATE_FAILURE, (current, key) => ({
    key,
    error: current.errorPayload,
  }))

const fetchingActionsInGroup = (
  state: State,
  registry: Registry,
  group: ?string,
  key: string
) =>
  group
    ? mapStates(
        state,
        STATE_FETCHING,
        (current, key: string) => (registry[key].group === group ? key : undefined)
      ).filter(k => k && k !== key)
    : []

const getFinishedActions = (keys: string[]) =>
  keys
    .map(k => createRequestSuccessAction(k).toString())
    .concat(keys.map(k => createRequestFailureAction(k).toString()))

const createDefaultWorker = (key: string, registry: Registry) =>
  function*(action) {
    try {
      const { group, fetcher } = registry[key]
      let blockedInGroup = yield select(
        fetchingActionsInGroup,
        registry,
        group,
        key
      )

      // wait for group to get unblocked
      while (blockedInGroup.length > 0) {
        yield take(getFinishedActions(blockedInGroup))
        blockedInGroup = yield select(
          fetchingActionsInGroup,
          registry,
          group,
          key
        )
      }

      const successAction = createRequestSuccessAction(key)
      const response = yield call(fetcher, action.payload)
      yield put(successAction({ response, request: action.payload }))
    } catch (error) {
      const failureAction = createRequestFailureAction(key)
      yield put(failureAction({ error, request: action.payload }))
    }
  }

const createWatcher = (action, worker, takeStrategy) =>
  function*() {
    yield takeStrategy(action, worker)
  }

const createWatchers = (registry: Registry) =>
  Object.keys(registry).map(key => {
    const { takeStrategy = takeLatest } = registry[key]
    const action = createRequestAction(key)
    const worker = createDefaultWorker(key, registry)

    return createWatcher(action, worker, takeStrategy)()
  })

const STATE_FETCHING = 'FETCHING'
const STATE_SUCCESS = 'SUCCESS'
const STATE_FAILURE = 'FAILURE'

class SagaFetcher {
  registry: Registry = {}

  constructor(
    config: {
      [key: string]: OptionsType,
    } = {}
  ) {
    if (typeof config !== 'object') {
      throw new Error(`Registry must be an object but got ${typeof config}`)
    }

    Object.keys(config).forEach(key => {
      const options = config[key]
      this.add(key, options)
    })
  }

  add = (key: string, options: OptionsType) => {
    if (typeof options.fetcher !== 'function') {
      throw new Error(
        `Expected a function for key ${key} but got ${typeof options.fetcher}`
      )
    }

    this.registry[key] = {
      ...options,
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
        [key]: {
          status: STATE_SUCCESS,
          payload: payload.response,
          errorPayload: undefined,
        },
      })
      handlers[createRequestFailureAction(key).toString()] = (
        state,
        { payload }
      ) => ({
        ...state,
        [key]: {
          status: STATE_FAILURE,
          payload: undefined,
          errorPayload: payload.error,
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
