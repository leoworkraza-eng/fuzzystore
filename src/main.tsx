import { StrictMode, Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

/* Catch-all error boundary: any unexpected crash shows a recoverable
   screen instead of a blank page. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ maxWidth: 560, margin: '15vh auto', padding: 24, textAlign: 'center', color: '#f6efe9' }}>
          <h1>😵 Something went wrong</h1>
          <p style={{ opacity: 0.7 }}>{this.state.error.message}</p>
          <button
            type="button"
            onClick={() => {
              this.setState({ error: null })
              window.location.reload()
            }}
            style={{ padding: '12px 24px', borderRadius: 12, border: 'none', background: '#d95c45', color: '#fff', fontWeight: 700, cursor: 'pointer', marginTop: 12 }}
          >
            Reload the app
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
