#!/usr/bin/env bun

import { performance } from "node:perf_hooks";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { ErrorObject, ValidateFunction } from "ajv";

// =============================================================================
// Type Definitions (matching src-react/src/types/module.ts)
// =============================================================================

type ModuleKind = "space" | "tool" | "service" | "integration" | "widget" | "system";
type ServiceExportKind = "http" | "bridge" | "local";
type ModuleCoreCapability = "projects" | "contentEditor" | "toolRegistry";

interface ModuleDependency {
  id: string;
  minVersion?: string;
  optional?: boolean;
}

interface ResolvedDependency extends ModuleDependency {
  version?: string;
  missing: boolean;
  satisfied: boolean;
}

interface ModuleServiceExport {
  id: string;
  kind: ServiceExportKind;
  description?: string;
}

interface ModuleExports {
  services?: ModuleServiceExport[];
  widgets?: string[];
}

interface ManifestWidgetDef {
  id: string;
  slot: string;
  entry: string;
}

interface ModuleManifestFile {
  id: string;
  label?: string;
  namespace: string;
  version: string;
  apiVersion?: number;
  kind?: ModuleKind;
  tags?: string[];
  coreCapabilities?: ModuleCoreCapability[];
  db?: {
    rawAccess?: boolean;
  };
  ui?: {
    moduleEntry?: string;
    primarySpace?: string;
    widgets?: ManifestWidgetDef[];
    registerAsSpaceInTopBar?: boolean;
    sidebarLabel?: string;
  };
  runtime?: {
    frontendEntry?: string;
    backendEntry?: string;
  };
  sidebar?: {
    label?: string;
    icon?: string;
    order?: number;
    group?: string;
  };
  enabled?: boolean;
  dependsOn?: ModuleDependency[];
  dependencies?: string[]; // V1 legacy
  exports?: ModuleExports;
  defaultPinned?: boolean;
}

interface GeneratedModuleManifest {
  id: string;
  label: string;
  sidebarLabel?: string;
  namespace: string;
  version: string;
  moduleEntry: string;
  kind: ModuleKind;
  apiVersion: number;
  tags: string[];
  coreCapabilities: ModuleCoreCapability[];
  dependsOn: ModuleDependency[];
  exports: ModuleExports;
  registerAsSpaceInTopBar: boolean;
  defaultPinned: boolean;
  resolvedDependencies: ResolvedDependency[];
  loadOrder: number;
}

interface ResolvedManifest extends GeneratedModuleManifest {
  manifestPath: string;
}

type RunMode = "generate" | "validate-only";

// =============================================================================
// Constants & Configuration
// =============================================================================

//@ts-ignore
const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const modulesDir = path.join(repoRoot, "src", "modules");
const outputFile = path.join(
  repoRoot,
  "src",
  "core",
  "frontend",
  "src",
  "generated",
  "modules.ts",
);
const schemaPath = path.join(
  repoRoot,
  "src",
  "modules",
  "_kit",
  "module.manifest.schema.json",
);
const namespacePattern = /^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+$/;
const DEFAULT_CORE_CAPABILITIES: ModuleCoreCapability[] = [
  "projects",
  "contentEditor",
  "toolRegistry",
];

// =============================================================================
// Utilities
// =============================================================================

function resolveRunMode(): RunMode {
  return process.argv.includes("--validate-only")
    ? "validate-only"
    : "generate";
}

function log(message: string): void {
  console.log(`[gen-modules] ${message}`);
}

function logError(message: string): void {
  console.error(`[gen-modules] ERROR: ${message}`);
}

function logWarn(message: string): void {
  console.warn(`[gen-modules] WARN: ${message}`);
}

// =============================================================================
// Errors
// =============================================================================

class ManifestValidationError extends Error {
  constructor(
    readonly manifestPath: string,
    readonly details: string,
  ) {
    super(`${manifestPath}: ${details}`);
  }
}

class DependencyCycleError extends Error {
  constructor(readonly cycles: string[][]) {
    const cycleStrings = cycles.map((c) => c.join(" -> ")).join("; ");
    super(`Dependency cycles detected: ${cycleStrings}`);
  }
}

class ServiceExportConflictError extends Error {
  constructor(
    readonly serviceId: string,
    readonly moduleA: string,
    readonly moduleB: string,
  ) {
    super(
      `Service '${serviceId}' exported by both '${moduleA}' and '${moduleB}'`,
    );
  }
}

// =============================================================================
// Schema Validation
// =============================================================================

async function loadValidator(): Promise<ValidateFunction<ModuleManifestFile>> {
  try {
    const rawSchema = await fs.readFile(schemaPath, "utf8");
    const schema = JSON.parse(rawSchema);
    const AjvModule = (await import("ajv/dist/2020.js")) as unknown as {
      default: new (...args: unknown[]) => {
        compile<T>(schema: unknown): ValidateFunction<T>;
      };
    };
    const ajv = new AjvModule.default({ allErrors: true, strict: "log" });
    return ajv.compile<ModuleManifestFile>(schema);
  } catch {
    logWarn(
      `Manifest schema not found at ${path.relative(repoRoot, schemaPath)}; running structural validation only.`,
    );
    const fallback = ((_: unknown): _ is ModuleManifestFile => true) as ValidateFunction<ModuleManifestFile>;
    fallback.errors = null;
    return fallback;
  }
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) {
    return "Unknown schema error";
  }

  return errors
    .map((error) => {
      const pathLabel = error.instancePath || "/";
      const base = `${pathLabel.replace(/^\/+/, "/")}: ${error.message ?? "validation failed"}`;
      if (error.params && "allowedValues" in error.params) {
        return `${base} (allowed: ${(error.params.allowedValues as unknown[]).join(", ")})`;
      }
      return base;
    })
    .join("; ");
}

// =============================================================================
// File System Validation
// =============================================================================

async function ensureModuleEntryExists(
  manifestPath: string,
  moduleName: string,
  relativeEntry: string,
): Promise<void> {
  const absoluteEntry = path.join(modulesDir, moduleName, relativeEntry);
  try {
    await fs.access(absoluteEntry);
  } catch {
    const message = `UI moduleEntry '${relativeEntry}' does not exist for ${moduleName} (resolved path: ${absoluteEntry})`;
    throw new ManifestValidationError(manifestPath, message);
  }
}

// =============================================================================
// Manifest Reading & Normalization
// =============================================================================

function normalizeToV2(
  parsed: ModuleManifestFile,
  moduleName: string,
): Omit<
  ResolvedManifest,
  "manifestPath" | "resolvedDependencies" | "loadOrder"
> {
  const apiVersion = parsed.apiVersion ?? 2;
  const isV2 = apiVersion === 2;

  const frontendEntry =
    parsed.runtime?.frontendEntry ?? parsed.ui?.moduleEntry ?? "module.frontend.ts";
  const sidebarLabel = parsed.sidebar?.label ?? parsed.ui?.sidebarLabel;

  // Normalize dependsOn from V1 dependencies or V2 dependsOn
  let dependsOn: ModuleDependency[] = [];
  if (isV2 && parsed.dependsOn) {
    dependsOn = parsed.dependsOn;
  } else if (parsed.dependencies && parsed.dependencies.length > 0) {
    // V1 compatibility: convert string array to ModuleDependency array
    dependsOn = parsed.dependencies.map((id) => ({ id, optional: false }));
  }

  return {
    id: parsed.id,
    label: parsed.label ?? parsed.id,
    sidebarLabel,
    namespace: parsed.namespace,
    version: parsed.version,
    moduleEntry: toPosixPath(
      path.join("src", "modules", moduleName, frontendEntry),
    ),
    kind: parsed.kind ?? "space",
    apiVersion,
    tags: parsed.tags ?? [],
    coreCapabilities: parsed.coreCapabilities ?? DEFAULT_CORE_CAPABILITIES,
    dependsOn,
    exports: {
      services: parsed.exports?.services ?? [],
      widgets: parsed.exports?.widgets ?? [],
    },
    registerAsSpaceInTopBar:
      parsed.ui?.registerAsSpaceInTopBar ?? (parsed.kind ?? "space") === "space",
    defaultPinned: Boolean(parsed.defaultPinned),
  };
}

async function readManifest(
  moduleName: string,
  validate: ValidateFunction<ModuleManifestFile>,
): Promise<ResolvedManifest | null> {
  // Skip _kit directory
  if (moduleName.startsWith("_")) {
    return null;
  }

  const manifestPath = path.join(modulesDir, moduleName, "manifest.json");
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as ModuleManifestFile;

    if (!validate(parsed)) {
      throw new ManifestValidationError(
        manifestPath,
        formatAjvErrors(validate.errors),
      );
    }

    if (!namespacePattern.test(parsed.namespace)) {
      throw new ManifestValidationError(
        manifestPath,
        `namespace '${parsed.namespace}' must match ${namespacePattern}`,
      );
    }

    const frontendEntry =
      parsed.runtime?.frontendEntry ?? parsed.ui?.moduleEntry ?? "module.frontend.ts";
    await ensureModuleEntryExists(manifestPath, moduleName, frontendEntry);

    const normalized = normalizeToV2(parsed, moduleName);

    return {
      ...normalized,
      manifestPath,
      resolvedDependencies: [], // Will be computed later
      loadOrder: 0, // Will be computed later
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      log(`Skipping module ${moduleName} – manifest not found`);
      return null;
    }

    if (error instanceof ManifestValidationError) {
      throw error;
    }

    throw new ManifestValidationError(manifestPath, (error as Error).message);
  }
}

// =============================================================================
// Uniqueness Validation
// =============================================================================

function assertUnique(manifests: ResolvedManifest[]): void {
  const seenIds = new Map<string, string>();
  const seenNamespaces = new Map<string, string>();

  for (const manifest of manifests) {
    const existingId = seenIds.get(manifest.id);
    if (existingId) {
      throw new ManifestValidationError(
        manifest.manifestPath,
        `module id '${manifest.id}' already declared in ${existingId}`,
      );
    }
    seenIds.set(manifest.id, manifest.manifestPath);

    const existingNamespace = seenNamespaces.get(manifest.namespace);
    if (existingNamespace) {
      throw new ManifestValidationError(
        manifest.manifestPath,
        `namespace '${manifest.namespace}' already declared in ${existingNamespace}`,
      );
    }
    seenNamespaces.set(manifest.namespace, manifest.manifestPath);
  }
}

// =============================================================================
// Service Export Validation
// =============================================================================

function validateServiceExports(manifests: ResolvedManifest[]): void {
  const serviceToModule = new Map<string, string>();

  for (const manifest of manifests) {
    for (const service of manifest.exports.services ?? []) {
      const existing = serviceToModule.get(service.id);
      if (existing) {
        throw new ServiceExportConflictError(service.id, existing, manifest.id);
      }
      serviceToModule.set(service.id, manifest.id);
    }
  }
}

// =============================================================================
// Dependency Graph & Cycle Detection
// =============================================================================

interface DependencyNode {
  id: string;
  deps: Set<string>;
  reverseDeps: Set<string>;
}

function buildDependencyGraph(
  manifests: ResolvedManifest[],
): Map<string, DependencyNode> {
  const graph = new Map<string, DependencyNode>();

  // Initialize nodes
  for (const manifest of manifests) {
    graph.set(manifest.id, {
      id: manifest.id,
      deps: new Set(),
      reverseDeps: new Set(),
    });
  }

  // Build edges
  for (const manifest of manifests) {
    const node = graph.get(manifest.id)!;
    for (const dep of manifest.dependsOn) {
      node.deps.add(dep.id);
      const depNode = graph.get(dep.id);
      if (depNode) {
        depNode.reverseDeps.add(manifest.id);
      }
    }
  }

  return graph;
}

function detectCycles(graph: Map<string, DependencyNode>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  function dfs(nodeId: string): void {
    if (recursionStack.has(nodeId)) {
      // Found a cycle
      const cycleStart = path.indexOf(nodeId);
      if (cycleStart !== -1) {
        cycles.push([...path.slice(cycleStart), nodeId]);
      }
      return;
    }

    if (visited.has(nodeId)) {
      return;
    }

    visited.add(nodeId);
    recursionStack.add(nodeId);
    path.push(nodeId);

    const node = graph.get(nodeId);
    if (node) {
      for (const depId of node.deps) {
        if (graph.has(depId)) {
          dfs(depId);
        }
      }
    }

    path.pop();
    recursionStack.delete(nodeId);
  }

  for (const nodeId of graph.keys()) {
    if (!visited.has(nodeId)) {
      dfs(nodeId);
    }
  }

  return cycles;
}

function topologicalSort(graph: Map<string, DependencyNode>): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  const temp = new Set<string>();

  function visit(nodeId: string): void {
    if (temp.has(nodeId)) {
      return; // Cycle, skip
    }
    if (visited.has(nodeId)) {
      return;
    }

    temp.add(nodeId);

    const node = graph.get(nodeId);
    if (node) {
      for (const depId of node.deps) {
        if (graph.has(depId)) {
          visit(depId);
        }
      }
    }

    temp.delete(nodeId);
    visited.add(nodeId);
    result.push(nodeId);
  }

  for (const nodeId of graph.keys()) {
    visit(nodeId);
  }

  return result;
}

// =============================================================================
// Dependency Resolution
// =============================================================================

function resolveDependencies(
  manifests: ResolvedManifest[],
  graph: Map<string, DependencyNode>,
  loadOrder: string[],
): void {
  const manifestById = new Map(manifests.map((m) => [m.id, m]));

  // Compute load order index for each manifest
  const orderMap = new Map(loadOrder.map((id, idx) => [id, idx]));

  for (const manifest of manifests) {
    manifest.loadOrder = orderMap.get(manifest.id) ?? Number.MAX_SAFE_INTEGER;

    // Resolve dependencies
    manifest.resolvedDependencies = manifest.dependsOn.map((dep) => {
      const depManifest = manifestById.get(dep.id);
      const missing = !depManifest;
      const satisfied = !missing; // TODO: Version constraint checking

      if (missing && !dep.optional) {
        logWarn(
          `Module '${manifest.id}' depends on missing module '${dep.id}'`,
        );
      }

      return {
        ...dep,
        version: depManifest?.version,
        missing,
        satisfied,
      };
    });
  }
}

// =============================================================================
// Collection & Validation Pipeline
// =============================================================================

async function collectManifests(
  validate: ValidateFunction<ModuleManifestFile>,
): Promise<ResolvedManifest[]> {
  const entries = await fs
    .readdir(modulesDir, { withFileTypes: true })
    .catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        log("No modules directory found – skipping generation.");
        return [];
      }
      throw error;
    });

  const manifests: ResolvedManifest[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const manifest = await readManifest(entry.name, validate);
    if (manifest) {
      manifests.push(manifest);
    }
  }

  manifests.sort((a, b) => a.id.localeCompare(b.id));

  // Phase 1: Basic uniqueness
  assertUnique(manifests);

  // Phase 2: Service export uniqueness
  validateServiceExports(manifests);

  // Phase 3: Build dependency graph and detect cycles
  const graph = buildDependencyGraph(manifests);
  const cycles = detectCycles(graph);

  if (cycles.length > 0) {
    throw new DependencyCycleError(cycles);
  }

  // Phase 4: Topological sort for load order
  const loadOrder = topologicalSort(graph);

  // Phase 5: Resolve dependencies and assign load order
  resolveDependencies(manifests, graph, loadOrder);

  // Sort by load order for output
  manifests.sort((a, b) => a.loadOrder - b.loadOrder);

  return manifests;
}

// =============================================================================
// Output Generation
// =============================================================================

function serializeModules(modules: GeneratedModuleManifest[]): string {
  const header = `// @generated by scripts/gen-modules.ts. DO NOT EDIT.
// Module System V2 - Generated Manifest Catalog

`;

  const interfaceBlock = `// V2 Types
export type ModuleKind = "space" | "tool" | "service" | "integration" | "widget" | "system";
export type ServiceExportKind = "http" | "bridge" | "local";
export type ModuleCoreCapability = "projects" | "contentEditor" | "toolRegistry";

export interface ModuleDependency {
    id: string;
    minVersion?: string;
    optional?: boolean;
}

export interface ResolvedDependency extends ModuleDependency {
    version?: string;
    missing: boolean;
    satisfied: boolean;
}

export interface ModuleServiceExport {
    id: string;
    kind: ServiceExportKind;
    description?: string;
}

export interface ModuleExports {
    services: ModuleServiceExport[];
    widgets: string[];
}

export interface GeneratedModuleManifest {
    id: string;
    label: string;
    sidebarLabel?: string;
    namespace: string;
    version: string;
    moduleEntry: string;
    kind: ModuleKind;
    apiVersion: number;
    tags: string[];
    coreCapabilities: ModuleCoreCapability[];
    dependsOn: ModuleDependency[];
    exports: ModuleExports;
    registerAsSpaceInTopBar: boolean;
    defaultPinned: boolean;
    resolvedDependencies: ResolvedDependency[];
    loadOrder: number;
}

`;

  const payload = modules
    .map((mod) => {
      const dependsOnStr = JSON.stringify(mod.dependsOn);
      const exportsStr = JSON.stringify(mod.exports);
      const tagsStr = JSON.stringify(mod.tags);
      const coreCapabilitiesStr = JSON.stringify(mod.coreCapabilities);
      const resolvedDepsStr = JSON.stringify(mod.resolvedDependencies);
      const sidebarLabelStr = JSON.stringify(mod.sidebarLabel);

      return `    {
        id: "${mod.id}",
        label: "${mod.label}",
        sidebarLabel: ${sidebarLabelStr},
        namespace: "${mod.namespace}",
        version: "${mod.version}",
        moduleEntry: "${mod.moduleEntry}",
        kind: "${mod.kind}",
        apiVersion: ${mod.apiVersion},
        tags: ${tagsStr},
        coreCapabilities: ${coreCapabilitiesStr},
        dependsOn: ${dependsOnStr},
        exports: ${exportsStr},
        registerAsSpaceInTopBar: ${mod.registerAsSpaceInTopBar},
        defaultPinned: ${mod.defaultPinned},
        resolvedDependencies: ${resolvedDepsStr},
        loadOrder: ${mod.loadOrder}
    }`;
    })
    .join(",\n");

  const arrayBody = modules.length ? `[\n${payload}\n]` : "[]";

  const body = `export const ALL_MODULE_MANIFESTS: GeneratedModuleManifest[] = ${arrayBody};

// Lookup helpers
export function getManifestById(id: string): GeneratedModuleManifest | undefined {
    return ALL_MODULE_MANIFESTS.find((m) => m.id === id);
}

export function getManifestsByKind(kind: ModuleKind): GeneratedModuleManifest[] {
    return ALL_MODULE_MANIFESTS.filter((m) => m.kind === kind);
}

export function getSpaceModules(): GeneratedModuleManifest[] {
    return ALL_MODULE_MANIFESTS.filter((m) => m.kind === "space" && m.registerAsSpaceInTopBar);
}

export function getServiceModules(): GeneratedModuleManifest[] {
    return ALL_MODULE_MANIFESTS.filter((m) => m.kind === "service");
}

// Dependency resolution helpers
export function getModuleDependencies(id: string): GeneratedModuleManifest[] {
    const manifest = getManifestById(id);
    if (!manifest) return [];
    return manifest.dependsOn
        .map((dep) => getManifestById(dep.id))
        .filter((m): m is GeneratedModuleManifest => m !== undefined);
}

export function getModuleDependents(id: string): GeneratedModuleManifest[] {
    return ALL_MODULE_MANIFESTS.filter((m) =>
        m.dependsOn.some((dep) => dep.id === id)
    );
}
`;

  return `${header}${interfaceBlock}${body}`;
}

async function writeOutput(manifests: ResolvedManifest[]): Promise<void> {
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  const payload = manifests.map(({ manifestPath: _skip, ...rest }) => rest);
  await fs.writeFile(outputFile, serializeModules(payload), "utf8");
}

// =============================================================================
// Main Entry Point
// =============================================================================

async function main(): Promise<void> {
  const start = performance.now();
  const mode = resolveRunMode();

  log("Starting module manifest generation (V2)...");

  const validate = await loadValidator();
  const manifests = await collectManifests(validate);

  // Log summary
  const v1Count = manifests.filter((m) => m.apiVersion === 1).length;
  const v2Count = manifests.filter((m) => m.apiVersion === 2).length;
  const serviceCount = manifests.reduce(
    (acc, m) => acc + (m.exports.services?.length ?? 0),
    0,
  );

  log(`Found ${manifests.length} module(s): ${v1Count} V1, ${v2Count} V2`);
  if (serviceCount > 0) {
    log(`Total service exports: ${serviceCount}`);
  }

  if (mode === "generate") {
    await writeOutput(manifests);
    const duration = (performance.now() - start).toFixed(0);
    log(
      `Generated ${manifests.length} manifest(s) -> ${path.relative(repoRoot, outputFile)} in ${duration}ms`,
    );
    return;
  }

  const duration = (performance.now() - start).toFixed(0);
  log(`Validated ${manifests.length} manifest(s) in ${duration}ms`);
}

main().catch((error) => {
  if (error instanceof ManifestValidationError) {
    logError(error.message);
  } else if (error instanceof DependencyCycleError) {
    logError(error.message);
  } else if (error instanceof ServiceExportConflictError) {
    logError(error.message);
  } else {
    console.error("[gen-modules] failed", error);
  }
  process.exitCode = 1;
});
