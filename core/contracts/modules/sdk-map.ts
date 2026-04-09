export const MODULE_SDK_TOKENS = {
  AI_SERVICE: "AIServiceSDK",
  COMPONENT_LIBRARY: "ComponentLibrarySDK",
  DESIGNER: "DesignerSDK",
  KNOWLEDGE: "KnowledgeSDK",
  CORE_PROJECTS: "core.projects",
} as const;

export type ModuleSdkToken = (typeof MODULE_SDK_TOKENS)[keyof typeof MODULE_SDK_TOKENS];

export interface ModuleSdkMigrationItem {
  moduleId: string;
  provides: ModuleSdkToken[];
  consumes: ModuleSdkToken[];
}

export const MODULE_SDK_MIGRATION_MAP: ModuleSdkMigrationItem[] = [
  {
    moduleId: "ai-service",
    provides: [MODULE_SDK_TOKENS.AI_SERVICE],
    consumes: [],
  },
  {
    moduleId: "component-library",
    provides: [MODULE_SDK_TOKENS.COMPONENT_LIBRARY],
    consumes: [MODULE_SDK_TOKENS.AI_SERVICE, MODULE_SDK_TOKENS.CORE_PROJECTS],
  },
  {
    moduleId: "designer",
    provides: [MODULE_SDK_TOKENS.DESIGNER],
    consumes: [
      MODULE_SDK_TOKENS.COMPONENT_LIBRARY,
      MODULE_SDK_TOKENS.AI_SERVICE,
      MODULE_SDK_TOKENS.CORE_PROJECTS,
    ],
  },
  {
    moduleId: "knowledge",
    provides: [MODULE_SDK_TOKENS.KNOWLEDGE],
    consumes: [MODULE_SDK_TOKENS.AI_SERVICE, MODULE_SDK_TOKENS.CORE_PROJECTS],
  },
];
