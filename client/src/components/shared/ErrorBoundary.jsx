import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen bg-navy-950 flex items-center justify-center p-4">
        <div className="card max-w-md w-full p-8 text-center space-y-4">
          <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto">
            <AlertTriangle className="text-red-400" size={32} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-100">Something went wrong</h2>
            <p className="text-slate-400 text-sm mt-2">
              An unexpected error occurred. Reload the page to try again.
            </p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="btn btn-secondary btn-md w-full gap-2"
          >
            <RefreshCw size={16} />
            Reload Page
          </button>
        </div>
      </div>
    );
  }
}
