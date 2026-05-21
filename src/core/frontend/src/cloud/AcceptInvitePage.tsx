import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

type InviteEvent = CustomEvent<{ token: string }>;

export function AcceptInvitePage() {
  const { acceptInviteToken } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as InviteEvent).detail;
      if (detail?.token) {
        setToken(detail.token);
        setPassword("");
        setConfirm("");
        setError(null);
        setSuccess(false);
      }
    };
    window.addEventListener("openpcb:invite", handler);
    return () => window.removeEventListener("openpcb:invite", handler);
  }, []);

  const open = token !== null;

  const handleClose = () => {
    setToken(null);
    setPassword("");
    setConfirm("");
    setError(null);
    setSuccess(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !token) return;
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setError(null);
    setSubmitting(true);
    acceptInviteToken(token, password)
      .then(() => {
        setSuccess(true);
        setSubmitting(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setSubmitting(false);
      });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) handleClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Accept invite — set your password
        </DialogTitle>

        {success ? (
          <div className="space-y-4 py-2">
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
              Password set successfully. You are now signed in.
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
              >
                Continue
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            {error ? (
              <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                {error}
              </div>
            ) : null}

            <label className="block space-y-2 text-sm">
              <span className="text-slate-500 dark:text-slate-400">
                New password
              </span>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
              />
            </label>

            <label className="block space-y-2 text-sm">
              <span className="text-slate-500 dark:text-slate-400">
                Confirm password
              </span>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
              />
            </label>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Accepting…" : "Accept"}
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
