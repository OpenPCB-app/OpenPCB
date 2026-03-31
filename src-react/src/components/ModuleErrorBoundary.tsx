/**
 * Module Error Boundary
 *
 * Catches React errors within module components and displays
 * user-friendly error UI with reload option.
 */
import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { globalEventBus } from "@/modules/EventBus";

// =============================================================================
// Types
// =============================================================================

export interface ModuleErrorBoundaryProps {
  /** Module ID for error attribution */
  moduleId: string;
  /** Optional: Component/widget name */
  componentName?: string;
  /** Children to render */
  children: ReactNode;
  /** Optional: Custom fallback renderer */
  fallback?: (props: ErrorFallbackProps) => ReactNode;
  /** Optional: Callback when error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

export interface ModuleErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export interface ErrorFallbackProps {
  error: Error;
  moduleId: string;
  componentName?: string;
  resetError: () => void;
}

// =============================================================================
// Default Error Fallback
// =============================================================================

function DefaultErrorFallback({
  error,
  moduleId,
  componentName,
  resetError,
}: ErrorFallbackProps) {
  const title = componentName
    ? `Error in ${componentName}`
    : `Error in module: ${moduleId}`;

  return (
    <div
      className="flex flex-col items-center justify-center gap-4 p-6 rounded-lg border border-destructive/20 bg-destructive/5"
      role="alert"
    >
      <div className="flex items-center gap-2 text-destructive">
        <AlertTriangle className="h-5 w-5" />
        <span className="font-medium">{title}</span>
      </div>

      <p className="text-sm text-muted-foreground text-center max-w-md">
        {error.message || "An unexpected error occurred"}
      </p>

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={resetError}
          className="gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          Try Again
        </Button>
      </div>

      {process.env.NODE_ENV === "development" && (
        <details className="mt-2 w-full max-w-md">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
            Error Details
          </summary>
          <pre className="mt-2 p-2 text-xs bg-muted rounded overflow-auto max-h-40">
            {error.stack}
          </pre>
        </details>
      )}
    </div>
  );
}

// =============================================================================
// Error Boundary Class Component
// =============================================================================

/**
 * Module Error Boundary
 *
 * Wraps module components to catch and handle React errors gracefully.
 * Emits events for error tracking and provides reload functionality.
 *
 * @example
 * ```tsx
 * <ModuleErrorBoundary moduleId="my-module">
 *   <MyModuleComponent />
 * </ModuleErrorBoundary>
 * ```
 */
export class ModuleErrorBoundary extends Component<
  ModuleErrorBoundaryProps,
  ModuleErrorBoundaryState
> {
  constructor(props: ModuleErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ModuleErrorBoundaryState> {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });

    // Log the error
    console.error(
      `[ModuleErrorBoundary] Error in module '${this.props.moduleId}':`,
      error,
      errorInfo
    );

    // Emit error event
    globalEventBus.emit("module.error", {
      moduleId: this.props.moduleId,
      componentName: this.props.componentName,
      error: error.message,
      stack: error.stack,
    });

    // Call optional error handler
    this.props.onError?.(error, errorInfo);
  }

  resetError = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });

    // Emit reset event
    globalEventBus.emit("module.errorReset", {
      moduleId: this.props.moduleId,
      componentName: this.props.componentName,
    });
  };

  override render(): ReactNode {
    const { hasError, error } = this.state;
    const { children, moduleId, componentName, fallback } = this.props;

    if (hasError && error) {
      if (fallback) {
        return fallback({
          error,
          moduleId,
          componentName,
          resetError: this.resetError,
        });
      }

      return (
        <DefaultErrorFallback
          error={error}
          moduleId={moduleId}
          componentName={componentName}
          resetError={this.resetError}
        />
      );
    }

    return children;
  }
}

// =============================================================================
// HOC for easier usage
// =============================================================================

/**
 * Higher-order component to wrap a component with error boundary
 */
export function withModuleErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  moduleId: string,
  componentName?: string
): React.FC<P> {
  const WithErrorBoundary: React.FC<P> = (props) => (
    <ModuleErrorBoundary moduleId={moduleId} componentName={componentName}>
      <WrappedComponent {...props} />
    </ModuleErrorBoundary>
  );

  WithErrorBoundary.displayName = `WithModuleErrorBoundary(${
    WrappedComponent.displayName || WrappedComponent.name || "Component"
  })`;

  return WithErrorBoundary;
}

export default ModuleErrorBoundary;
