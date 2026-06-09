import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";
import { readCloudConfig } from "./config";

type Tier = "pro" | null;

interface AuthContextValue {
  enabled: boolean; // false when VITE_* env vars are unset
  user: User | null;
  session: Session | null;
  tier: Tier;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  // Set by AcceptInvite flow (via openpcb://invite?token=...).
  acceptInviteToken: (token: string, newPassword: string) => Promise<void>;
  // Update the current user's password (signed-in change + recovery completion).
  updatePassword: (newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const cfg = readCloudConfig();
  const sb = getSupabase();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(cfg.enabled);

  useEffect(() => {
    if (!sb) {
      setLoading(false);
      return;
    }
    let mounted = true;
    sb.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session);
        setLoading(false);
      }
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, s) => {
      if (mounted) setSession(s);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [sb]);

  // Bridge: Electron deep-link → invite-token handler.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const api = (
      window as unknown as {
        electronAPI?: {
          onDeepLink?: (cb: (url: string) => void) => void;
          flushPendingDeepLink?: () => Promise<string | null>;
        };
      }
    ).electronAPI;
    if (!api?.onDeepLink) return;
    const handleUrl = (raw: string) => {
      try {
        const url = new URL(raw);
        // openpcb://invite?token=... or openpcb://auth-callback?code=...
        if (url.host === "invite" || url.pathname.includes("invite")) {
          const token = url.searchParams.get("token");
          if (token)
            window.dispatchEvent(
              new CustomEvent("openpcb:invite", { detail: { token } }),
            );
        } else if (url.host === "auth-callback") {
          const code = url.searchParams.get("code");
          if (code && sb) void sb.auth.exchangeCodeForSession(code);
        }
      } catch {
        /* ignore malformed */
      }
    };
    api.onDeepLink(handleUrl);
    api.flushPendingDeepLink?.().then((u) => u && handleUrl(u));
  }, [sb]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!sb) throw new Error("Cloud not configured");
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    [sb],
  );

  const signOut = useCallback(async () => {
    if (!sb) return;
    await sb.auth.signOut();
  }, [sb]);

  const acceptInviteToken = useCallback(
    async (token: string, newPassword: string) => {
      if (!sb) throw new Error("Cloud not configured");
      // GoTrue invite tokens are verified by exchanging for a session,
      // then setting the password on the resulting user.
      const { error: verifyErr } = await sb.auth.verifyOtp({
        token_hash: token,
        type: "invite",
      });
      if (verifyErr) throw verifyErr;
      const { error: updateErr } = await sb.auth.updateUser({
        password: newPassword,
      });
      if (updateErr) throw updateErr;
    },
    [sb],
  );

  const updatePassword = useCallback(
    async (newPassword: string) => {
      if (!sb) throw new Error("Cloud not configured");
      const { error } = await sb.auth.updateUser({ password: newPassword });
      if (error) throw error;
    },
    [sb],
  );

  const user = session?.user ?? null;
  const tier: Tier =
    (user?.app_metadata as { tier?: string } | undefined)?.tier === "pro"
      ? "pro"
      : null;

  const value = useMemo<AuthContextValue>(
    () => ({
      enabled: cfg.enabled,
      user,
      session,
      tier,
      loading,
      signIn,
      signOut,
      acceptInviteToken,
      updatePassword,
    }),
    [
      cfg.enabled,
      user,
      session,
      tier,
      loading,
      signIn,
      signOut,
      acceptInviteToken,
      updatePassword,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
