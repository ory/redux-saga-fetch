import {
  createRequestAction,
  createSagaFetcher,
  isFetchFailure,
  isFetching,
  isFetchSuccess,
  selectPayload,
} from './index'

import { applyMiddleware, combineReducers, createStore } from 'redux'
import createSagaMiddleware from 'redux-saga'

const internalServerError = new Error('Internal server error')

const delay = time => new Promise(resolve => setTimeout(resolve, time))

describe('createRegistry', () => {
  it('should throw an error when an invalid registry is given', () => {
    expect(() =>
      createSagaFetcher({
        foo: 'bar',
      })
    ).toThrow()
  })

  it('should throw an error when the registry is not an object but a string', () => {
    expect(() => createSagaFetcher('foo')).toThrow()
  })

  it('should throw an error when the registry is not an object but an array', () => {
    expect(() => createSagaFetcher(['foo'])).toThrow()
  })
})

describe('The public api of redux-saga-fetch', () => {
  const registry = createSagaFetcher({
    serverError: {
      fetcher: id => delay(50).then(() => Promise.reject(internalServerError)),
    },
    success: { fetcher: id => delay(50).then(() => ({ foo: 'bar', id })) },
    successWithoutContent: { fetcher: () => delay(50) },
  })

  const rootReducer = combineReducers(registry.wrapRootReducer({}))

  const initialState = {}
  const sagaMiddleware = createSagaMiddleware()
  const store = createStore(
    rootReducer,
    initialState,
    applyMiddleware(sagaMiddleware)
  )

  sagaMiddleware.run(registry.createRootSaga())

  const testCases = [
    {
      key: 'serverError',
      actionPayload: undefined,
      expectedPayload: internalServerError,
      expectedError: true,
    },
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
  ]

  testCases.forEach((testCase, testIndex) => {
    describe(`performing test case ${testIndex}`, () => {
      beforeAll(() => {
        store.dispatch(
          createRequestAction(testCase.key)(testCase.actionPayload)
        )
      })

      it('should show that the status is fetching', async () => {
        await delay(1)
        expect(isFetching(store.getState())(testCase.key)).toBeTruthy()
      })

      it('should show that the status is done', async () => {
        await delay(55)
        expect(isFetching(store.getState())(testCase.key)).toBeFalsy()
        expect(isFetchFailure(store.getState())(testCase.key)).toEqual(
          testCase.expectedError
        )
        expect(isFetchSuccess(store.getState())(testCase.key)).toEqual(
          !testCase.expectedError
        )
        expect(selectPayload(store.getState())(testCase.key)).toEqual(
          testCase.expectedPayload
        )
      })
    })
  })
})
