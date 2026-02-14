// Main entry — mounts the React app and loads global styles.
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// Simple error boundary to surface runtime errors instead of a blank page
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error?: any }>{
  constructor(props: any) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error }
  }
  componentDidCatch(error: any, info: any) {
    // eslint-disable-next-line no-console
    console.error('App crashed:', error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, fontFamily: 'ui-sans-serif, system-ui' }}>
          <h2>Something went wrong.</h2>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{String(this.state.error || '')}</pre>
          <p className="muted">Open the browser console and share the stack for a quick fix.</p>
        </div>
      )
    }
    return this.props.children as any
  }
}

const root = createRoot(document.getElementById('root')!)
root.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
)
