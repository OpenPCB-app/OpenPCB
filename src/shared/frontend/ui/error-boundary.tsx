import * as React from "react";
import { OctagonAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export interface ErrorReportContext {
  scope: string;
  componentStack?: string;
}

export type ErrorReporter = (error: unknown, context: ErrorReportContext) => void;

let reporter: ErrorReporter | null = null;

/** Install the crash reporter (e.g. Sentry) every boundary forwards to. */
export function setErrorReporter(fn: ErrorReporter | null): void {
  reporter = fn;
}

/** Text for "Copy details": name, message, stack. */
export function errorDetails(error: unknown): string {
  if (error instanceof Error) {
    return [`${error.name}: ${error.message}`, error.stack ?? ""].filter(Boolean).join("\n");
  }
  try {
    return typeof error === "string" ? error : JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export interface ErrorFallbackProps {
  error: unknown;
  reset: () => void;
  /** Default "Something went wrong". */
  title?: string;
  /** Small inline form for panels / docks. */
  compact?: boolean;
}

/** Default boundary fallback: Try again · Copy details · Reload. */
export function ErrorFallback({ error, reset, title, compact = false }: ErrorFallbackProps) {
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(errorDetails(error)).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => setCopied(false),
    );
  };
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col text-xs text-text",
        compact ? "items-start gap-1.5 p-3" : "h-full w-full items-center justify-center gap-2 p-6 text-center",
      )}
    >
      <OctagonAlert
        aria-hidden="true"
        strokeWidth={1.5}
        className={cn("text-status-danger", compact ? "h-4 w-4" : "h-6 w-6")}
      />
      <p className={cn("m-0 font-medium text-text-strong", compact ? "text-xs" : "text-sm")}>
        {title ?? "Something went wrong"}
      </p>
      <p className="m-0 max-w-[360px] text-text-secondary">
        This part of the app hit an unexpected error. Your saved work is not affected.
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Button size={compact ? "sm" : "md"} variant="primary" onClick={reset}>
          Try again
        </Button>
        <Button size={compact ? "sm" : "md"} variant="secondary" onClick={copy}>
          {copied ? "Copied" : "Copy details"}
        </Button>
        <Button size={compact ? "sm" : "md"} variant="ghost" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    </div>
  );
}

export interface ErrorBoundaryProps {
  /** Names the area in reports ("designer", "settings/libraries"). */
  scope: string;
  /** Any change (shallow, by index) clears the error — e.g. [designId]. */
  resetKeys?: readonly unknown[];
  fallback?: (props: { error: unknown; reset: () => void }) => React.ReactNode;
  onError?: (error: unknown, info: React.ErrorInfo) => void;
  children?: React.ReactNode;
}

interface ErrorBoundaryState {
  error: unknown;
  failed: boolean;
}

function keysChanged(a: readonly unknown[] = [], b: readonly unknown[] = []): boolean {
  return a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]));
}

/** Catches render errors below it; reports once, renders a recoverable fallback. */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, failed: false };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error, failed: true };
  }

  override componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    this.props.onError?.(error, info);
    reporter?.(error, {
      scope: this.props.scope,
      componentStack: info.componentStack ?? undefined,
    });
  }

  override componentDidUpdate(previous: ErrorBoundaryProps): void {
    if (this.state.failed && keysChanged(previous.resetKeys, this.props.resetKeys)) {
      this.reset();
    }
  }

  reset = (): void => {
    this.setState({ error: null, failed: false });
  };

  override render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;
    const { error } = this.state;
    if (this.props.fallback) return this.props.fallback({ error, reset: this.reset });
    return <ErrorFallback error={error} reset={this.reset} />;
  }
}
