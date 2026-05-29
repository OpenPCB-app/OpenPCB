export type SettingsTab =
  | "general"
  | "account"
  | "libraries"
  | "assistant"
  | "privacy"
  | "about";

export type AppRoute =
  | { kind: "home" }
  | {
      kind: "module";
      moduleId: string;
      designId?: string;
      params?: Record<string, string>;
    }
  | { kind: "settings"; tab: SettingsTab };
