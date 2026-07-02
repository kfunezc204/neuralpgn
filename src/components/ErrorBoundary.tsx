import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Last-resort catch for render-time errors anywhere in the tree: without it a
 * thrown render leaves a permanent white screen. Recovery is a full reload —
 * walk state is deliberately not persisted mid-walk (see WalkCore's
 * persistence boundary), so reloading can't corrupt SRS data.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uncaught render error', error, info.componentStack)
  }

  render() {
    if (this.state.error === null) return this.props.children
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-surface-0 p-6">
        <div className="max-w-md rounded-lg border border-line bg-surface-1 p-6 text-center">
          <h1 className="text-lg font-semibold text-ink">Algo salió mal</h1>
          <p className="mt-2 text-sm text-ink-muted">
            La aplicación encontró un error inesperado. Tu progreso guardado no
            se ve afectado.
          </p>
          <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2 text-left text-xs text-ink-faint">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast transition-colors duration-150 hover:bg-accent-hover"
          >
            Recargar la aplicación
          </button>
        </div>
      </div>
    )
  }
}
