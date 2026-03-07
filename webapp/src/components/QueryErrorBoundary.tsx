import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  /** Short label shown in the error UI, e.g. "Leaderboard" */
  sectionName?: string;
  /** Optional custom fallback; overrides default mini error card */
  fallback?: ReactNode;
  /** Called when the boundary resets so the parent can re-fetch */
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * Lightweight error boundary designed to wrap individual page sections
 * (feed, leaderboard, notifications) so that one failing section does
 * not crash the entire screen.
 */
export class QueryErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(
      `[QueryErrorBoundary:${this.props.sectionName ?? "unknown"}] Caught error:`,
      error.message,
      errorInfo
    );
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
    this.props.onReset?.();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center text-zinc-400">
          <AlertCircle className="h-5 w-5 text-zinc-500" />
          <p className="text-sm">
            {this.props.sectionName
              ? `${this.props.sectionName} failed to load.`
              : "This section failed to load."}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={this.handleRetry}
            className="text-xs"
          >
            Try Again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
