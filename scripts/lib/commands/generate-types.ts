/**
 * Type Generation Command
 * Generates TypeScript types from Rust Specta exports
 */

import { performance } from "node:perf_hooks";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

export async function generateTypesCommand(): Promise<void> {
    console.log("\n🦀 Rust Type Generation\n");

    const start = performance.now();

    // Run gen-types.ts
    const genTypesPath = path.join(repoRoot, "scripts", "gen-types.ts");

    try {
        const proc = Bun.spawn(["bun", genTypesPath], {
            cwd: repoRoot,
            stdout: "inherit",
            stderr: "inherit",
        });

        const exitCode = await proc.exited;

        if (exitCode !== 0) {
            throw new Error(`Type generation failed with exit code ${exitCode}`);
        }

        const duration = (performance.now() - start).toFixed(0);
        console.log(`\n✅ Types generated in ${duration}ms\n`);
    } catch (error) {
        console.error("\n❌ Type generation failed:\n");
        throw error;
    }
}
