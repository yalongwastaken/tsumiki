// ErrorBoundary.jsx — catches render errors and shows a friendly fallback.
import { Component } from "react";

/** Catches render-time errors and shows a friendly fallback (not a blank screen). */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    // surface for debugging; in prod this is the only breadcrumb
    console.error("Render error:", error, info?.componentStack);
  }
  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        this.props.fallback?.(this.state.error, this.reset) ?? (
          <div className="m-4 rounded-xl border border-rose-200 bg-rose-50 p-4" role="alert">
            <div className="text-sm font-semibold text-rose-700 mb-1">
              Something went wrong here.
            </div>
            <div className="text-xs text-rose-500 font-mono break-words mb-3">
              {String(this.state.error?.message || this.state.error)}
            </div>
            <div className="flex gap-2">
              <button
                onClick={this.reset}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg"
              >
                Try again
              </button>
              <button
                onClick={() => location.reload()}
                className="px-3 py-1.5 text-xs font-semibold text-rose-700 border border-rose-300 rounded-lg"
              >
                Reload
              </button>
            </div>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
