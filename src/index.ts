import {
  createAction,
  handleActions,
  ReducerMap,
  ReducerMapValue,
} from 'redux-actions'
import { all, call, put, takeLatest, select, take } from 'redux-saga/effects'
import { pathOr } from 'ramda'
import { Action } from 'redux-actions'
import { ReducersMapObject } from 'redux'

type OptionsType<S extends State> = {
  fetcher: (...args: any[]) => Promise<any>
  takeStrategy?: Function
  group?: string
  selector?: (state: S) => any
}

type Registry<S extends State> = {
  [key: string]: OptionsType<S>
}

export type StateItem = {
  status: string
  payload: any
  errorPayload: Error
}

export interface State {
  reduxSagaFetch: {
    [key: string]: StateItem
  }
}

export const isFetching = (key: string) => (state: State) =>
  pathOr(null, ['reduxSagaFetch', key, 'status'], state) === STATE_FETCHING

export const isFetchFailure = (key: string) => (state: State) =>
  pathOr(null, ['reduxSagaFetch', key, 'status'], state) === STATE_FAILURE

export const isFetchSuccess = (key: string) => (state: State) =>
  pathOr(null, ['reduxSagaFetch', key, 'status'], state) === STATE_SUCCESS

export const selectPayload = (key: string) => (state: State) =>
  pathOr(undefined, ['reduxSagaFetch', key, 'payload'], state)

export const selectErrorPayload = (key: string) => (state: State) =>
  pathOr(undefined, ['reduxSagaFetch', key, 'errorPayload'], state)

export const hasFetchFailures = (state: State) => {
  const states = pathOr({}, ['reduxSagaFetch'], state)
  return Boolean(
    Object.keys(states).find(key => states[key].status === STATE_FAILURE)
  )
}

// mapStates filters all the states by status and then maps with the custom map function
const mapStates = <T>(
  state: State,
  status: string,
  mapFunc: (curr: StateItem, key: string) => T
) => {
  const states = pathOr({}, ['reduxSagaFetch'], state)
  return Object.keys(states)
    .filter(key => states[key].status === status)
    .map((key: string) => mapFunc(states[key], key))
}

export const selectErrorPayloads = <S extends State>(state: S) =>
  mapStates<{
    key: string
    error: Error
  }>(state, STATE_FAILURE, (current: StateItem, key: string) => ({
    key,
    error: current.errorPayload,
  }))

const fetchingActionsInGroup = <S extends State>(
  state: S,
  registry: Registry<S>,
  group: string | undefined,
  key: string
) =>
  group
    ? mapStates(state, STATE_FETCHING, (current, key: string) =>
        registry[key].group === group ? key : undefined
      ).filter(k => k && k !== key)
    : []

const getFinishedActions = (keys: string[]) =>
  keys
    .map(k => createRequestSuccessAction(k).toString())
    .concat(keys.map(k => createRequestFailureAction(k).toString()))

const createDefaultWorker = <S extends State>(
  key: string,
  registry: Registry<S>
) =>
  function*(action: Action<any>) {
    try {
      const { group, fetcher, selector = () => undefined } = registry[key]
      let blockedInGroup = yield select<
        S,
        Registry<S>,
        string | undefined,
        string
      >(fetchingActionsInGroup, registry, group, key)

      // wait for group to get unblocked
      while (blockedInGroup.length > 0) {
        yield take(getFinishedActions(blockedInGroup))
        blockedInGroup = yield select<
          S,
          Registry<S>,
          string | undefined,
          string
        >(fetchingActionsInGroup, registry, group, key)
      }

      const requestedState = yield select<S>(selector)
      const successAction = createRequestSuccessAction(key)
      const response = yield call(fetcher, action.payload, requestedState)
      yield put(successAction({ response, request: action.payload }))
    } catch (error) {
      const failureAction = createRequestFailureAction(key)
      yield put(failureAction({ error, request: action.payload }))
    }
  }

const createWatchers = <S extends State>(registry: Registry<S>) =>
  Object.keys(registry).map(key => {
    const { takeStrategy = takeLatest } = registry[key]
    const action = createRequestAction(key)
    const worker = createDefaultWorker(key, registry)

    return (function*(action, worker, takeStrategy) {
      yield takeStrategy(action, worker)
    })(action, worker, takeStrategy)
  })

export const STATE_FETCHING = 'FETCHING'
export const STATE_SUCCESS = 'SUCCESS'
export const STATE_FAILURE = 'FAILURE'

interface Payload {
  response?: any
  error?: Error
}

export class SagaFetcher<S extends State> {
  private registry: Registry<S> = {}

  constructor(config: Registry<S> = {}) {
    if (typeof config !== 'object') {
      throw new Error(`Registry must be an object but got ${typeof config}`)
    }

    Object.keys(config).forEach(key => {
      const options = config[key]
      this.add(key, options)
    })
  }

  add = (key: string, options: OptionsType<S>) => {
    if (typeof options.fetcher !== 'function') {
      throw new Error(
        `Expected a function for key ${key} but got ${typeof options.fetcher}`
      )
    }

    this.registry[key] = {
      ...options,
    }
  }

  wrapRootReducer = <R extends object>(
    reducers?: ReducersMapObject<R>
  ): ReducersMapObject<R & State> => {
    const handlers: ReducerMap<State, Payload> = {}

    Object.keys(this.registry).forEach(key => {
      handlers[createRequestAction(key).toString()] = (state: State) => ({
        ...state,
        [key]: {
          status: STATE_FETCHING,
          payload: undefined,
          errorPayload: undefined,
        },
      })

      handlers[createRequestSuccessAction(key).toString()] = <
        ReducerMapValue<State, Payload>
      >function(state: State, action: Action<Payload>) {
        return {
          ...state,
          [key]: {
            status: STATE_SUCCESS,
            payload: action.payload ? action.payload.response : undefined,
            errorPayload: undefined,
          },
        }
      }

      handlers[createRequestFailureAction(key).toString()] = function(
        state: State,
        action: Action<Payload>
      ) {
        return {
          ...state,
          [key]: {
            status: STATE_FAILURE,
            payload: undefined,
            errorPayload: action.payload ? action.payload.error : undefined,
          },
        }
      }
    })

    return {
      ...(reducers || ({} as ReducersMapObject<R>)),
      reduxSagaFetch: handleActions<State, any>(handlers, {
        reduxSagaFetch: {},
      }),
    } as ReducersMapObject<R & State>
  }

  createRootSaga = () => {
    const { registry } = this
    return function* rootSaga() {
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
export const createSagaFetcher = <S extends State>(config: Registry<S>) =>
  new SagaFetcher<S>(config)

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
