# redux-saga-fetch

[![Build Status](https://travis-ci.org/ory/redux-saga-fetch.svg?branch=master)](https://travis-ci.org/ory/redux-saga-fetch)
[![Coverage Status](https://coveralls.io/repos/github/ory/redux-saga-fetch/badge.svg?branch=master)](https://coveralls.io/github/ory/redux-saga-fetch?branch=master)

`ory-redux-saga-fetch` is a simple wrapper that reduces boilerplate code when using `redux-saga` in combination with
async backend calls.

## Installation

```
npm i --save ory-redux-saga-fetch
```

## API

```jsx
import { applyMiddleware, combineReducers, createStore } from 'redux'
import createSagaMiddleware from 'redux-saga'

import {
  createRequestAction,
  createSagaFetcher,
  isFetchFailure,
  isFetching,
  isFetchSuccess,
  selectPayload
} from 'ory-redux-saga-fetch'

// Some exemplary functions that call a backend and return a promise.
// For more information on the fetch API, go here: https://github.com/bitinn/node-fetch
const getUsersFromAPI = () => fetch('http://myapi.com/users').then(res => res.JSON())
const getArticleFromAPI = (id) => fetch('http://myapi.com/articles/' + id).then(res => res.JSON())
const createArticleAtAPI = (article) => fetch('http://myapi.com/articles', { method: 'POST', body: JSON.stringify(article) }).then(res => res.JSON())

// Configuring our fetcher
const sagaFetcher = createSagaFetcher({
  users: {
    // Fetch is executed when the according action is triggered. Fetch expects a function that returns a Promise.
    fetch: getUsersFromAPI
  },
  article: {
    // The action payload (see below) will be passed as the first argument.
    fetch: (id) => getUsersFromAPI(id)
  },
  createArticle: {
    // This works with POST/PUT/DELETE/... methods as well
    fetch: (payload) => createArticleAtAPI(payload)
  }
})

// We need to wrap the root reducer in order to get sagaFetcher to work.
const rootReducer = combineReducers(
  sagaFetcher.wrapRootReducer({
    myOtherReducer1: (action, state) => ({ /*...*/ })
    myOtherReducer2: (action, state) => ({ /*...*/ })
  })
)

// This is regular redux stuff
const initialState = {}
const sagaMiddleware = createSagaMiddleware()
const store = createStore(
  rootReducer,
  initialState,
  applyMiddleware(sagaMiddleware)
)

// We need to register the saga watchers of reduxSagaFetch
sagaMiddleware.run(registry.createRootSaga())


// Now we're done, let's dispatch some actions!
createRequestAction('users')()
createRequestAction('article')(1234)
createRequestAction('createArticle')({ id: 12345, title: 'foo' })

// Now, the saga watchers will execute the API calls. In the meanwhile, you can check the status of each request using
isFetching(store.getState()('users') // if true, the API call has not finished yet.
isFetchSuccess(store.getState()('users') // if true, the API call resultet in Promise.resolve()
isFetchError(store.getState()('users') // if true, the API call resultet in Promise.reject()

// Let's assume the API call has finished and we want to see the result. This works for both cases (error and success).
const users = selectPayload(store.getState())('users')
```

Assuming you are using redux together with React, you could write your connector like this:

```jsx
import React from 'react'
import { connect } from 'react-redux'
import {
  createRequestAction,
  createSagaFetcher,
  isFetchFailure,
  isFetching,
  isFetchSuccess,
  selectPayload
} from 'ory-redux-saga-fetch'

const Component = ({ getUsers, users, isFetchingUsers }) => (
  <div>
    <button onClick={getUsers()} />
    {isFetchingUsers ? 'still fetching...' : users}
  </div>
)


const mapStateToProps = (state) => ({
  isFetchingUsers: isFetching(state)('users')
  users: selectPayload(state)('users')
}

const mapDispatchToProps = (dispatch) => ({
  getUsers: createRequestAction('users')
})

export default connect(mapStateToProps, mapDispatchToProps)(Component)
```