/** A stalled vault must not hold host shutdown or admission forever. */
export function awaitProviderSnapshot<T>(
  operation: () => Promise<T>, signal?: AbortSignal, timeoutMessage = "Provider snapshot timed out",
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    signal?.throwIfAborted();
    let settled = false;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      complete();
    };
    const abort = () => finish(() => reject(signal?.reason));
    const timer = setTimeout(() => finish(() => reject(new Error(timeoutMessage))), 60_000);
    signal?.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(operation).then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}
