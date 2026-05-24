export type AppRoute =
  | { kind: "home" }
  | {
      kind: "module";
      moduleId: string;
      designId?: string;
      params?: Record<string, string>;
    };
