/**
 * Bridge Generation Command
 * Generates TypeScript bindings from Rust bridge introspection
 */

import { performance } from "node:perf_hooks";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

export async function generateBridgeCommand(): Promise<void> {
    console.log("\n🌉 Bridge Generation\n");

    const start = performance.now();

    // Run gen-bridge.ts
    const genBridgePath = path.join(repoRoot, "scripts", "gen-bridge.ts");

    try {
        // First build bridge-introspect
        console.log("Building bridge-introspect...");
        const buildProc = Bun.spawn(["cargo", "build", "-p", "bridge-introspect"], {
            cwd: repoRoot,
            stdout: "inherit",
            stderr: "inherit",
        });

        const buildExit = await buildProc.exited;
        if (buildExit !== 0) {
            throw new Error(`Bridge introspect build failed with exit code ${buildExit}`);
        }

        // Then run gen-bridge
        const proc = Bun.spawn(["bun", genBridgePath], {
            cwd: repoRoot,
            stdout: "inherit",
            stderr: "inherit",
        });

        const exitCode = await proc.exited;

        if (exitCode !== 0) {
            throw new Error(`Bridge generation failed with exit code ${exitCode}`);
        }

        const duration = (performance.now() - start).toFixed(0);
        console.log(`\n✅ Bridge bindings generated in ${duration}ms\n`);
    } catch (error) {
        console.error("\n❌ Bridge generation failed:\n");
        throw error;
    }
}
