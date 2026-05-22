import { useEffect, useState } from "react";

export function PrivacyPanel() {
  const prefs =
    typeof window !== "undefined" ? window.electronAPI?.preferences : undefined;
  const [optIn, setOptIn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!prefs) {
      setOptIn(false);
      return;
    }
    prefs
      .getTelemetryOptIn()
      .then(setOptIn)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setOptIn(false);
      });
  }, [prefs]);

  const toggle = async () => {
    if (optIn === null || !prefs) return;
    const next = !optIn;
    setSaving(true);
    setError(null);
    try {
      await prefs.setTelemetryOptIn(next);
      setOptIn(next);
      setTouched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const available = Boolean(prefs);

  return (
    <div className="space-y-8 pb-24">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Privacy
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Control what OpenPCB sends outside your machine. OpenPCB runs fully
          offline by default — no project data, no schematics, and no design
          files ever leave your computer.
        </p>
      </div>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/40">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <label
              htmlFor="telemetry-opt-in"
              className="text-sm font-medium text-slate-900 dark:text-slate-100"
            >
              Crash and error reporting
            </label>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Send anonymous crash reports and uncaught errors to the OpenPCB
              team via Sentry. Helps us find and fix bugs faster. No project
              files, schematic content, or personally identifying information is
              included.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-500">
              Changes take effect on next launch.
            </p>
          </div>
          <input
            id="telemetry-opt-in"
            type="checkbox"
            checked={optIn ?? false}
            disabled={!available || optIn === null || saving}
            onChange={() => void toggle()}
            className="mt-1 h-5 w-5 cursor-pointer rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600"
          />
        </div>

        {!available ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
            Telemetry settings are only available in the desktop app.
          </p>
        ) : null}

        {touched && available ? (
          <p className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:bg-blue-900/30 dark:text-blue-200">
            Restart OpenPCB to apply this change.
          </p>
        ) : null}

        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-900 dark:bg-red-900/30 dark:text-red-200">
            {error}
          </p>
        ) : null}
      </section>

      <p className="text-xs text-slate-500 dark:text-slate-500">
        See{" "}
        <a
          href="https://github.com/OpenPCB-app/OpenPCB/blob/main/SECURITY.md"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-slate-900 dark:hover:text-slate-200"
        >
          SECURITY.md
        </a>{" "}
        for details on what is reported when this is enabled.
      </p>
    </div>
  );
}
