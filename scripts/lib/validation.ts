/**
 * Validation logic for module scaffolding
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ScaffoldOptions, ModuleManifest } from "./types.js";
import { MODULE_ID_PATTERN, NAMESPACE_PATTERN } from "./types.js";

export class ValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ValidationError";
    }
}

export async function validateScaffoldOptions(
    opts: ScaffoldOptions,
    repoRoot: string,
): Promise<void> {
    // 1. Validate module ID format
    if (!MODULE_ID_PATTERN.test(opts.id)) {
        throw new ValidationError(
            `Invalid module ID "${opts.id}". Must start with a letter and contain only lowercase letters, numbers, and hyphens.`,
        );
    }

    // 2. Check if module already exists
    const moduleDir = path.join(repoRoot, "modules", opts.id);
    if (existsSync(moduleDir)) {
        throw new ValidationError(`Module "${opts.id}" already exists at ${moduleDir}`);
    }

    // 3. Validate namespace format
    if (!NAMESPACE_PATTERN.test(opts.namespace)) {
        throw new ValidationError(
            `Invalid namespace "${opts.namespace}". Must match pattern: ${NAMESPACE_PATTERN}`,
        );
    }

    // 4. Check for namespace conflicts
    const manifests = await loadAllManifests(repoRoot);
    const conflictingManifest = manifests.find((m) => m.namespace === opts.namespace);
    if (conflictingManifest) {
        throw new ValidationError(
            `Namespace "${opts.namespace}" is already used by module "${conflictingManifest.id}"`,
        );
    }

    // 5. Validate Cargo.toml exists if Rust commands enabled
    if (opts.hasRustCommands) {
        const cargoTomlPath = path.join(repoRoot, "Cargo.toml");
        if (!existsSync(cargoTomlPath)) {
            throw new ValidationError(
                "Cargo.toml not found in repository root. Rust workspace required for Rust commands.",
            );
        }
    }

    // 6. Check Bun version
    try {
        const bunVersion = await getBunVersion();
        const versionMatch = bunVersion.match(/^(\d+)\.(\d+)\.(\d+)/);
        if (versionMatch) {
            const major = Number.parseInt(versionMatch[1]!, 10);
            const minor = Number.parseInt(versionMatch[2]!, 10);
            if (major < 1 || (major === 1 && minor < 3)) {
                throw new ValidationError(
                    `Bun version ${bunVersion} is too old. Required: >=1.3.0`,
                );
            }
        }
    } catch (error) {
        throw new ValidationError(`Failed to check Bun version: ${(error as Error).message}`);
    }
}

async function loadAllManifests(repoRoot: string): Promise<ModuleManifest[]> {
    const modulesDir = path.join(repoRoot, "modules");

    if (!existsSync(modulesDir)) {
        return [];
    }

    // Use readdir from fs/promises
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(modulesDir, { withFileTypes: true });

    const manifests: ModuleManifest[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith("_")) continue; // Skip _kit and non-directories

        const manifestPath = path.join(modulesDir, entry.name, "manifest.json");
        if (existsSync(manifestPath)) {
            try {
                const content = await readFile(manifestPath, "utf8");
                const manifest = JSON.parse(content) as ModuleManifest;
                manifests.push(manifest);
            } catch {
                // Skip invalid manifests
            }
        }
    }

    return manifests;
}

async function getBunVersion(): Promise<string> {
    const proc = Bun.spawn(["bun", "--version"], { stdout: "pipe" });
    const output = await new Response(proc.stdout).text();
    return output.trim();
}
