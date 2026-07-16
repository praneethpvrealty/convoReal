'use client'

import { useEffect } from 'react'

/**
 * Last-resort fallback when the root layout itself throws. Must render
 * its own <html>/<body> (Next.js replaces the entire tree here) and is
 * deliberately self-contained — no shared components/utilities — so a
 * problem elsewhere in the app can't also take this page down.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[global error boundary]', error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1.5rem',
          padding: '1.5rem',
          textAlign: 'center',
          background: '#020617',
          color: '#e2e8f0',
          fontFamily: 'ui-sans-serif, -apple-system, sans-serif',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, color: '#fff', margin: '0 0 8px' }}>
            Everyone&apos;s Out Showing Properties
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#94a3b8', maxWidth: '24rem', margin: '0 auto' }}>
            The whole team&apos;s gone quiet. Please try again in a moment.
          </p>
        </div>
        <button
          onClick={reset}
          style={{
            background: '#7c3aed',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            padding: '8px 20px',
            fontSize: '0.875rem',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </body>
    </html>
  )
}
