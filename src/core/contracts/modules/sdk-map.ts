/**
 * SDK tokens are string identifiers used by modules to register or consume
 * cross-module SDKs via `ctx.sdk`. Kept minimal — only currently-live
 * modules get a token. Add new entries as new modules arrive.
 */
export const MODULE_SDK_TOKENS = {
  COMPONENT_LIBRARY: "ComponentLibrarySDK",
} as const;

export type ModuleSdkToken =
  (typeof MODULE_SDK_TOKENS)[keyof typeof MODULE_SDK_TOKENS];
