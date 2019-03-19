import {
  createRequestAction,
  createSagaFetcher,
  isFetchFailure,
  isFetching,
  isFetchSuccess,
  selectPayload,
  selectErrorPayload,
  hasFetchFailures,
  selectErrorPayloads,
  State,
  StateItem,
} from './index'
import { AnyAction, applyMiddleware, combineReducers, createStore } from 'redux'
import createSagaMiddleware from 'redux-saga'

const internalServerError = new Error('Internal server error')

const delay = (time: number) =>
  new Promise((resolve: any) => setTimeout(resolve, time))

describe('createRegistry', () => {
  it('should throw an error when an invalid registry is given', () => {
    expect(() =>
      createSagaFetcher(<any>{
        foo: 'bar',
      })
    ).toThrow()
  })

  it('should throw an error when the registry is not an object but a string', () => {
    expect(() => createSagaFetcher(<any>'foo')).toThrow()
  })

  it('should throw an error when the registry is not an object but an array', () => {
    expect(() => createSagaFetcher(<any>['foo'])).toThrow()
  })
})

describe('The public api of redux-saga-fetch', () => {
  const initialState: {
    testKey: string
    reduxSagaFetch: { [key: string]: StateItem }
  } = { testKey: 'testValue', reduxSagaFetch: {} }

  const registry = createSagaFetcher<typeof initialState>({
    serverError: {
      fetcher: id => delay(50).then(() => Promise.reject(internalServerError)),
    },
    success: { fetcher: id => delay(50).then(() => ({ foo: 'bar', id })) },
    successWithoutContent: { fetcher: () => delay(50) },
    expectsState: {
      fetcher: (payload, testValue) =>
        delay(50).then(() => Promise.resolve(testValue)),
      selector: (state: any) => state.testKey,
    },
  })
  const rootReducer = combineReducers(
    registry.wrapRootReducer({ testKey: () => initialState.testKey })
  )

  const sagaMiddleware = createSagaMiddleware()
  const store = createStore<
    { testKey: string; reduxSagaFetch: { [key: string]: StateItem } },
    AnyAction,
    {},
    {}
  >(rootReducer, initialState, applyMiddleware(sagaMiddleware))

  sagaMiddleware.run(registry.createRootSaga())

  const testCases = [
    {
      key: 'success',
      actionPayload: 'foo',
      expectedPayload: { foo: 'bar', id: 'foo' },
      expectedError: false,
    },
    {
      key: 'successWithoutContent',
      actionPayload: undefined,
      expectedPayload: undefined,
      expectedError: false,
    },
    {
      key: 'expectsState',
      actionPayload: undefined,
      expectedPayload: initialState.testKey,
      expectedError: false,
    },
    // Failures must be after successes for the hasFetchFailures tests to pass
    {
      key: 'serverError',
      actionPayload: undefined,
      expectedPayload: internalServerError,
      expectedError: true,
    },
  ]

  testCases.forEach((testCase, testIndex) => {
    console.log(<State>store.getState())
    describe(`performing test case ${testIndex}`, () => {
      beforeAll(() => {
        store.dispatch(
          createRequestAction(testCase.key)(testCase.actionPayload)
        )
      })

      it('should show that the status is fetching', async () => {
        await delay(1)
        expect(isFetching(testCase.key)(<State>store.getState())).toBeTruthy()
      })

      it('should show that the status is done', async () => {
        await delay(55)
        expect(isFetching(testCase.key)(<State>store.getState())).toBeFalsy()
        expect(isFetchFailure(testCase.key)(<State>store.getState())).toEqual(
          testCase.expectedError
        )
        expect(hasFetchFailures(<State>store.getState())).toEqual(
          testCase.expectedError
        )
        expect(isFetchSuccess(testCase.key)(<State>store.getState())).toEqual(
          !testCase.expectedError
        )
        if (testCase.expectedError) {
          expect(
            selectErrorPayload(testCase.key)(<State>store.getState())
          ).toEqual(testCase.expectedPayload)
          expect(selectErrorPayloads(<State>store.getState())[0].error).toEqual(
            testCase.expectedPayload
          )
          expect(
            selectPayload(testCase.key)(<State>store.getState())
          ).toBeUndefined()
        } else {
          expect(selectPayload(testCase.key)(<State>store.getState())).toEqual(
            testCase.expectedPayload
          )
          expect(
            selectErrorPayload(testCase.key)(<State>store.getState())
          ).toBeUndefined()
          expect(selectErrorPayloads(<State>store.getState()).length).toEqual(0)
        }
      })
    })
  })

  it('grouping of requests works', async () => {
    const group = 'group'

    const registry = createSagaFetcher({
      request1: {
        fetcher: () => delay(50).then(() => Promise.resolve('')),
        group,
      },
      request2: {
        fetcher: () => delay(10).then(() => Promise.resolve('')),
        group,
      },
    })

    const request1 = createRequestAction('request1')
    const request2 = createRequestAction('request2')

    const rootReducer = combineReducers(registry.wrapRootReducer())

    const initialState = {}
    const sagaMiddleware = createSagaMiddleware()
    const store = createStore(
      rootReducer,
      initialState,
      applyMiddleware(sagaMiddleware)
    )

    sagaMiddleware.run(registry.createRootSaga())

    const expectFetching = (r1: any, r2: any) => {
      expect(isFetching('request1')(<State>store.getState())).toBe(r1)
      expect(isFetching('request2')(<State>store.getState())).toBe(r2)
    }

    const expectSuccess = (r1: any, r2: any) => {
      expect(isFetchSuccess('request1')(<State>store.getState())).toBe(r1)
      expect(isFetchSuccess('request2')(<State>store.getState())).toBe(r2)
    }

    store.dispatch(request1())
    store.dispatch(request2())

    expectFetching(true, true)
    expectSuccess(false, false)

    await delay(55)
    expectFetching(false, true)
    expectSuccess(true, false)

    await delay(10)
    expectFetching(false, false)
    expectSuccess(true, true)
  })
})
