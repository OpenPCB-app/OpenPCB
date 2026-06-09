import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";
import { readCloudConfig } from "./config";
import { createPkcePair } from "./pkce";

type Tier = "pro" | null;

interface AuthContextValue {
  enabled: boolean; // false when VITE_* env vars are unset
  user: User | null;
  session: Session | null;
  tier: Tier;
  loading: boolean;
  // Start the browser-based login handoff (opens the Cloud login page; the
  // session is installed when the openpcb://auth-callback deep-link returns).
  beginCloudLogin: () => Promise<void>;
  // Last login-handoff error, surfaced in the Account panel (there is no longer
  // an in-app form to host inline errors).
  loginError: string | null;
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
  const [loginError, setLoginError] = useState<string | null>(null);
  // PKCE state for an in-flight browser login. In-memory only — survives the
  // openExternal → deep-link round trip because the renderer is not reloaded.
  const pkceRef = useRef<{ verifier: string; state: string } | null>(null);

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
        // openpcb://invite?token=... or openpcb://auth-callback?code=&state=
        if (url.host === "invite" || url.pathname.includes("invite")) {
          const token = url.searchParams.get("token");
          if (token)
            window.dispatchEvent(
              new CustomEvent("openpcb:invite", { detail: { token } }),
            );
        } else if (url.host === "auth-callback") {
          const code = url.searchParams.get("code");
          const returnedState = url.searchParams.get("state");
          const pending = pkceRef.current;
          // Ignore callbacks we didn't initiate or whose state doesn't match
          // (CSRF / cross-session guard). Clear immediately — single use.
          if (!code || !pending || returnedState !== pending.state) return;
          pkceRef.current = null;
          void completeCloudLogin(code, pending.verifier);
        }
      } catch {
        /* ignore malformed */
      }
    };
    api.onDeepLink(handleUrl);
    api.flushPendingDeepLink?.().then((u) => u && handleUrl(u));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sb]);

  // Redeem the auth code returned via openpcb://auth-callback for a magiclink
  // token at the cloud-api broker, then install an independent session.
  const completeCloudLogin = useCallback(
    async (code: string, verifier: string) => {
      if (!sb) return;
      setLoginError(null);
      try {
        const { apiUrl } = readCloudConfig();
        const res = await fetch(`${apiUrl}/v1/auth/desktop/token`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, verifier }),
        });
        if (!res.ok) throw new Error(`Sign-in failed (${res.status})`);
        const { token_hash } = (await res.json()) as { token_hash: string };
        const { error } = await sb.auth.verifyOtp({
          type: "magiclink",
          token_hash,
        });
        if (error) throw error;
        // onAuthStateChange installs the session; secure storage persists it.
      } catch (err) {
        setLoginError(
          err instanceof Error ? err.message : "Sign-in failed. Try again.",
        );
      }
    },
    [sb],
  );

  // Open the Cloud login page in the system browser to start the handoff.
  const beginCloudLogin = useCallback(async () => {
    if (!sb) throw new Error("Cloud not configured");
    const { webUrl } = readCloudConfig();
    if (!webUrl) {
      setLoginError(
        "Cloud login is not configured (missing VITE_CLOUD_WEB_URL).",
      );
      return;
    }
    setLoginError(null);
    const { verifier, challenge, state } = await createPkcePair();
    pkceRef.current = { verifier, state };
    const target = `${webUrl.replace(/\/$/, "")}/desktop-auth?challenge=${encodeURIComponent(
      challenge,
    )}&state=${encodeURIComponent(state)}`;
    const api = (
      window as unknown as {
        electronAPI?: { openExternal?: (url: string) => Promise<void> };
      }
    ).electronAPI;
    if (api?.openExternal) await api.openExternal(target);
    else window.open(target, "_blank", "noopener,noreferrer");
  }, [sb]);

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
      beginCloudLogin,
      loginError,
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
      beginCloudLogin,
      loginError,
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
