/**
 * SDK Generation Command
 * Generates TypeScript SDKs for module HTTP/Bridge interfaces
 */

import { performance } from "node:perf_hooks";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

export async function generateSDKCommand(): Promise<void> {
    console.log("\n🔌 SDK Generation\n");

    const start = performance.now();

    // Run gen-sdk.ts
    const genSDKPath = path.join(repoRoot, "scripts", "gen-sdk.ts");

    try {
        const proc = Bun.spawn(["bun", genSDKPath], {
            cwd: repoRoot,
            stdout: "inherit",
            stderr: "inherit",
        });

        const exitCode = await proc.exited;

        if (exitCode !== 0) {
            throw new Error(`SDK generation failed with exit code ${exitCode}`);
        }

        const duration = (performance.now() - start).toFixed(0);
        console.log(`\n✅ SDKs generated in ${duration}ms\n`);
    } catch (error) {
        console.error("\n❌ SDK generation failed:\n");
        throw error;
    }
}
