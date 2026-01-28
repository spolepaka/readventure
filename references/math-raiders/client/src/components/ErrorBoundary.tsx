import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class GameErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Game error:', error, errorInfo);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
    // Reload the page for a fresh start
    window.location.reload();
  };

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error!, this.reset);
      }

      // Default kid-friendly error UI
      return (
        <div className="min-h-screen bg-gradient-to-b from-purple-900 to-blue-900 flex items-center justify-center p-4">
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-8 max-w-md text-center">
            <div className="text-6xl mb-4">😅</div>
            <h1 className="text-2xl font-bold text-white mb-4">
              Oops! Something went wrong!
            </h1>
            <p className="text-white/80 mb-6">
              Don't worry, even the best raiders need a break sometimes.
            </p>
            <button
              onClick={this.reset}
              className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-6 py-3 rounded-lg"
            >
              Try Again! ⚔️
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Network-specific error boundary for multiplayer issues
export function NetworkErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <GameErrorBoundary
      fallback={(error, reset) => {
        const isNetworkError = error.message.includes('network') || 
                              error.message.includes('connection') ||
                              error.message.includes('SpacetimeDB');
        
        if (isNetworkError) {
          return (
            <div className="min-h-screen bg-gradient-to-b from-purple-900 to-blue-900 flex items-center justify-center p-4">
              <div className="bg-white/10 backdrop-blur-md rounded-2xl p-8 max-w-md text-center">
                <div className="text-6xl mb-4">🌐</div>
                <h1 className="text-2xl font-bold text-white mb-4">
                  Connection Lost!
                </h1>
                <p className="text-white/80 mb-6">
                  Check your internet and let's get back to raiding!
                </p>
                <button
                  onClick={reset}
                  className="bg-green-600 hover:bg-green-700 text-white font-bold px-6 py-3 rounded-lg"
                >
                  Reconnect! 🔄
                </button>
              </div>
            </div>
          );
        }
        
        // Fall back to default error UI
        return null;
      }}
    >
      {children}
    </GameErrorBoundary>
  );
} 