import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App.tsx'
import { RepositoryProvider } from './lib/RepositoryContext.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import './App.css'
import './chess.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <RepositoryProvider>
          <App />
        </RepositoryProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
