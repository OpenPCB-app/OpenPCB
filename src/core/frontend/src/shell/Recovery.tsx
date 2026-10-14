import { useState } from "react";
import { Button } from "@shared/frontend/ui/button";
import { errorDetails } from "@shared/frontend/ui/error-boundary";

export function Recovery({
  error,
  reset,
  title = "This view stopped working",
  navigationAvailable = true,
  description,
  retryLabel = "Try again",
}: {
  error: unknown;
  reset: () => void;
  title?: string;
  navigationAvailable?: boolean;
  /** Replaces the default body copy (e.g. a concrete failure message). */
  description?: string;
  retryLabel?: string;
}) {
  const [copyStatus, setCopyStatus] = useState("Copy details");
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(errorDetails(error));
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Copy failed — try again");
    }
  };
  return (
    <div
      role="alert"
      className="flex h-full flex-col items-center justify-center gap-3 bg-surface-app p-6 text-center text-sm text-text"
    >
      <h1 className="font-medium text-text-strong">{title}</h1>
      <p className="max-w-md text-text-secondary">
        {description ?? (<>Try again to reopen this view. Unsaved changes in this view may be lost.
        No reload happens automatically.{" "}
        {navigationAvailable && "You can use navigation to open another view."}</>)}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={reset}>{retryLabel}</Button>
        <Button variant="secondary" onClick={() => void copy()}>
          {copyStatus}
        </Button>
      </div>
    </div>
  );
}
