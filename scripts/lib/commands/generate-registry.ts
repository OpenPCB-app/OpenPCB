/**
 * Module Registry Generation Command
 * Validates manifests and generates React-side module catalog
 */

import { performance } from "node:perf_hooks";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ErrorObject, ValidateFunction } from "ajv";

// Re-export from gen-modules.ts - keeping all the complex logic
// This is a thin wrapper for the CLI

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
const modulesDir = path.join(repoRoot, "modules");
const outputFile = path.join(repoRoot, "src-react", "src", "generated", "modules.ts");
const schemaPath = path.join(repoRoot, "modules", "_kit", "module.manifest.schema.json");

interface GenerateRegistryOptions {
    validateOnly?: boolean;
}

export async function generateRegistryCommand(opts: GenerateRegistryOptions = {}): Promise<void> {
    console.log("\n📋 Module Registry Generation\n");

    const start = performance.now();

    // Import and run the original gen-modules logic
    // This avoids duplicating 700+ lines of complex code
    const genModulesPath = path.join(repoRoot, "scripts", "gen-modules.ts");

    try {
        // Run gen-modules.ts with appropriate flags
        const mode = opts.validateOnly ? "--validate-only" : "";
        const proc = Bun.spawn(["bun", genModulesPath, mode].filter(Boolean), {
            cwd: repoRoot,
            stdout: "inherit",
            stderr: "inherit",
        });

        const exitCode = await proc.exited;

        if (exitCode !== 0) {
            throw new Error(`Module registry generation failed with exit code ${exitCode}`);
        }

        const duration = (performance.now() - start).toFixed(0);
        if (!opts.validateOnly) {
            console.log(`\n✅ Module registry generated in ${duration}ms\n`);
        } else {
            console.log(`\n✅ Module validation completed in ${duration}ms\n`);
        }
    } catch (error) {
        console.error("\n❌ Module registry generation failed:\n");
        throw error;
    }
}
