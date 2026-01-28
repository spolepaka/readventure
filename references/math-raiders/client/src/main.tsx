import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { NetworkErrorBoundary } from './components/ErrorBoundary'
import { DamageProvider } from './contexts/DamageContext'
import './index.css'
import * as Sentry from "@sentry/react"

// Initialize Sentry for error tracking
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1, // 10% performance monitoring
    beforeSend(event) {
      // Strip PII for K-5 student privacy (COPPA/FERPA compliance)
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
      }
      return event;
    }
  });
}

// Analysis helper for adaptive system testing
(window as any).analyze = () => {
  const session = (window as any).sessionData || { attempts: [] };
  const recent = (window as any).recentProblems || [];
  
  // Calculate statistics
  const factCounts: Record<string, { correct: number, wrong: number, times: number[] }> = {};
  session.attempts.forEach((a: any) => {
    if (!factCounts[a.fact]) {
      factCounts[a.fact] = { correct: 0, wrong: 0, times: [] };
    }
    if (a.correct) {
      factCounts[a.fact].correct++;
    } else {
      factCounts[a.fact].wrong++;
    }
    factCounts[a.fact].times.push(a.time);
  });
  
  // Sort by frequency
  const sorted = Object.entries(factCounts)
    .sort((a, b) => (b[1].correct + b[1].wrong) - (a[1].correct + a[1].wrong));
  
  
  return { session, recent, factCounts };
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<div style={{ padding: '2rem', textAlign: 'center', color: 'white' }}>Oops! Something went wrong. Please refresh the page.</div>}>
      <NetworkErrorBoundary>
        <DamageProvider>
          <App />
        </DamageProvider>
      </NetworkErrorBoundary>
    </Sentry.ErrorBoundary>
  </React.StrictMode>,
)
