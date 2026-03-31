import React from "react";

// Shim React 18 internals for libraries that still access __SECRET_INTERNALS in React 19.

type ReactClientInternals = {
  H?: unknown;
  A?: unknown;
  T?: unknown;
  S?: unknown;
  getCurrentStack?: (() => string) | null;
};

type ReactSecretInternals = {
  ReactCurrentDispatcher?: { current: unknown };
  ReactCurrentOwner?: { current: unknown };
  ReactCurrentBatchConfig?: { transition?: unknown };
  ReactDebugCurrentFrame?: {
    getStackAddendum?: () => string;
    setExtraStackFrame?: (stack: string | null) => void;
  };
};

type ReactWithInternals = typeof React & {
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?: ReactSecretInternals;
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: ReactClientInternals;
};

const reactWithInternals = React as ReactWithInternals;

if (!reactWithInternals.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED) {
  const client = reactWithInternals.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

  if (client) {
    let currentOwner: unknown = null;
    let extraStackFrame: string | null = null;

    const ReactCurrentDispatcher = {} as { current: unknown };
    Object.defineProperty(ReactCurrentDispatcher, "current", {
      get() {
        return client.H ?? null;
      },
      set(value) {
        client.H = value;
      },
    });

    const ReactCurrentOwner = {} as { current: unknown };
    Object.defineProperty(ReactCurrentOwner, "current", {
      get() {
        return currentOwner;
      },
      set(value) {
        currentOwner = value;
      },
    });

    const ReactCurrentBatchConfig: { transition?: unknown } = {};
    Object.defineProperty(ReactCurrentBatchConfig, "transition", {
      get() {
        return client.T ?? null;
      },
      set(value) {
        client.T = value;
      },
    });

    const ReactDebugCurrentFrame = {
      getStackAddendum() {
        if (extraStackFrame) {
          return extraStackFrame;
        }
        if (typeof client.getCurrentStack === "function") {
          const stack = client.getCurrentStack();
          return typeof stack === "string" ? stack : "";
        }
        return "";
      },
      setExtraStackFrame(stack: string | null) {
        extraStackFrame = stack;
      },
    };

    reactWithInternals.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = {
      ReactCurrentDispatcher,
      ReactCurrentOwner,
      ReactCurrentBatchConfig,
      ReactDebugCurrentFrame,
    };
  }
}
