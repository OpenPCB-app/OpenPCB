export const MODULE_SDK_TOKENS = {
  LIBRARY: "LibrarySDK",
} as const;

export type ModuleSdkToken =
  (typeof MODULE_SDK_TOKENS)[keyof typeof MODULE_SDK_TOKENS];
