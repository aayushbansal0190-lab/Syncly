import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Catches render-time errors anywhere below it so one thrown component can't
 * blank the whole app. React only supports error boundaries as class components
 * (there's no hook equivalent for componentDidCatch yet), hence the class.
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  // Flip into the fallback UI on the next render after a child throws.
  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  // Side-effect hook for logging. In a real product this would report to an
  // error-tracking service (e.g. Sentry); here we just log to the console.
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Uncaught UI error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen gap-4 p-4 text-center">
          <h1 className="text-2xl font-bold">Something went wrong</h1>
          <p className="text-base-content/70">
            An unexpected error occurred. Reloading usually fixes it.
          </p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
