/**
 * Simple Dependency Injection Container
 * Supports singleton and transient scopes
 */

type Factory<T> = (container: Container) => T;

interface ServiceRegistration<T> {
  factory: Factory<T>;
  scope: "singleton" | "transient";
  instance?: T;
}

export class Container {
  private services = new Map<symbol, ServiceRegistration<any>>();

  /**
   * Register transient service (new instance per resolve)
   */
  register<T>(token: symbol, factory: Factory<T>): void {
    this.services.set(token, { factory, scope: "transient" });
  }

  /**
   * Register singleton service (one instance, cached)
   */
  registerSingleton<T>(token: symbol, factory: Factory<T>): void {
    this.services.set(token, { factory, scope: "singleton" });
  }

  /**
   * Resolve service by token
   * @throws Error if service not registered
   */
  resolve<T>(token: symbol): T {
    const registration = this.services.get(token);
    if (!registration) {
      throw new Error(`Service not registered: ${String(token)}`);
    }

    // Singleton: return cached instance or create
    if (registration.scope === "singleton") {
      if (!registration.instance) {
        registration.instance = registration.factory(this);
      }
      return registration.instance;
    }

    // Transient: always create new
    return registration.factory(this);
  }

  /**
   * Check if service registered
   */
  has(token: symbol): boolean {
    return this.services.has(token);
  }

  /**
   * Clear all registrations (for testing)
   */
  clear(): void {
    this.services.clear();
  }
}

/**
 * Service Tokens (symbols for type-safe DI)
 */
export const TOKENS = {
  // Infrastructure
  DatabaseAccess: Symbol("DatabaseAccess"),
  ProviderRegistry: Symbol("ProviderRegistry"),
  ProviderResolver: Symbol("ProviderResolver"),
  ProviderApiKeyStore: Symbol("ProviderApiKeyStore"),
  TaskManager: Symbol("TaskManager"),
  TaskOrchestrator: Symbol("TaskOrchestrator"),
  UsageTracker: Symbol("UsageTracker"),
  MetricsCollector: Symbol("MetricsCollector"),

  // Services
  ChatService: Symbol("ChatService"),
  MessageService: Symbol("MessageService"),
  ProjectService: Symbol("ProjectService"),
  DesignService: Symbol("DesignService"),
  WorkspaceService: Symbol("WorkspaceService"),
  TaskService: Symbol("TaskService"),
  ProviderService: Symbol("ProviderService"),
  McpService: Symbol("McpService"),
  StreamService: Symbol("StreamService"),
  FolderService: Symbol("FolderService"),
  FavoriteService: Symbol("FavoriteService"),
  TagService: Symbol("TagService"),
  BookmarkService: Symbol("BookmarkService"),
  BranchService: Symbol("BranchService"),
  UsageService: Symbol("UsageService"),
  FileService: Symbol("FileService"),
  FileStorage: Symbol("FileStorage"),

  // Controllers

  ChatController: Symbol("ChatController"),
  ProjectController: Symbol("ProjectController"),
  DesignController: Symbol("DesignController"),
  WorkspaceController: Symbol("WorkspaceController"),
  TaskController: Symbol("TaskController"),
  ProviderController: Symbol("ProviderController"),
  McpController: Symbol("McpController"),
  StreamController: Symbol("StreamController"),
  HealthController: Symbol("HealthController"),
  FolderController: Symbol("FolderController"),
  FavoriteController: Symbol("FavoriteController"),
  TagController: Symbol("TagController"),
  BookmarkController: Symbol("BookmarkController"),
  BranchController: Symbol("BranchController"),
  UsageController: Symbol("UsageController"),
  FileController: Symbol("FileController"),
  MentionController: Symbol("MentionController"),
  ContentEditorController: Symbol("ContentEditorController"),
  MessageActionController: Symbol("MessageActionController"),

  // Component Library
  ComponentFamilyController: Symbol("ComponentFamilyController"),
  ComponentDraftController: Symbol("ComponentDraftController"),
  ComponentImportController: Symbol("ComponentImportController"),
  ComponentZipImportController: Symbol("ComponentZipImportController"),
  ComponentPresetController: Symbol("ComponentPresetController"),
  ComponentValidationService: Symbol("ComponentValidationService"),
  PackageSwitchService: Symbol("PackageSwitchService"),
  ComponentImportService: Symbol("ComponentImportService"),

  // Content Editor
  ContentEditorService: Symbol("ContentEditorService"),
  ContentTargetRegistry: Symbol("ContentTargetRegistry"),
  ToolRegistry: Symbol("ToolRegistry"),
} as const;
