import {
  createRequestAction,
  createRequestFailureAction,
  createSagaFetcher,
  isFetchFailure,
  isFetching,
  isFetchSuccess,
  selectPayload,
} from './index'
import { applyMiddleware, combineReducers, createStore } from 'redux'
import createSagaMiddleware from 'redux-saga'

const internalServerError = new Error('Internal server error')

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
    serverError: { fetcher: id => new Promise((resolve, reject) => setTimeout(() => reject(internalServerError), 100)) },
    success: { fetcher: id => new Promise((resolve) => setTimeout(() => resolve({ foo: 'bar', id }), 100)) },
    successWithoutContent: { fetcher: () => new Promise((resolve) => setTimeout(() => resolve(), 100)) },
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
      action: createRequestAction('serverError')('foo'),
      expectedAction: createRequestFailureAction('serverError').toString(),
      expectedPayload: internalServerError,
      expectedError: true
    },
    {
      key: 'success',
      action: createRequestAction('success')('foo'),
      expectedAction: createRequestFailureAction('success').toString(),
      expectedPayload: { foo: 'bar', id: 'foo' },
      expectedError: false
    },
  ]

  testCases.forEach((testCase, testIndex) => {
    describe(`performing test case ${testIndex}`, () => {
      store.dispatch(testCase.action)

      it('should show that the status is fetching', async () => {
        await new Promise((resolve, reject) => {
          setTimeout(() => {
            try {
              expect(isFetching(testCase.key)(store.getState())).toBeTruthy()
            } catch (e) {
              reject(e)
            }
            resolve()
          }, 10)
        })
      })

      it('should show that the status is done', async () => {
        await new Promise((resolve, reject) => {
          setTimeout(() => {
            try {
              expect(isFetching(testCase.key)(store.getState())).toBeFalsy()
              expect(isFetchFailure(testCase.key)(store.getState())).toEqual(testCase.expectedError)
              expect(isFetchSuccess(testCase.key)(store.getState())).toEqual(!testCase.expectedError)
              expect(selectPayload(testCase.key)(store.getState())).toEqual(testCase.expectedPayload)
            } catch (e) {
              reject(e)
            }
            resolve()
          }, 105)
        })
      })
    })
  })
})
