import { Recovery } from "./Recovery";

/** Bootstrap failed before any view exists, so there is no navigation to offer. */
export function BootstrapFailure({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Recovery
      error={message}
      reset={onRetry}
      title="OpenPCB could not start"
      navigationAvailable={false}
      description={message}
      retryLabel="Retry"
    />
  );
}
