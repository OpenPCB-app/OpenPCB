interface QuitEvent {
  preventDefault(): void;
}

interface QuitHooks {
  stop(): Promise<void>;
  quit(): void;
  reportFailure(): void;
}

/** Electron does not await event listeners; defer its final quit explicitly. */
export function createGracefulQuitHandler(hooks: QuitHooks): (event: QuitEvent) => void {
  let shutdown: Promise<void> | null = null;
  let readyToQuit = false;
  return (event) => {
    if (readyToQuit) return;
    event.preventDefault();
    shutdown ??= Promise.resolve().then(hooks.stop).catch(() => {
      try { hooks.reportFailure(); } catch { /* Logging must not prevent exit. */ }
    }).then(() => {
      readyToQuit = true;
      hooks.quit();
    });
  };
}

/** A failed close must not strand the remaining shell resources. */
export async function settleShutdownSteps(steps: readonly (() => void | Promise<void>)[]): Promise<void> {
  const errors: unknown[] = [];
  for (const step of steps) {
    try { await step(); } catch (error) { errors.push(error); }
  }
  if (errors.length > 0) throw new AggregateError(errors, "Backend shutdown failed");
}
