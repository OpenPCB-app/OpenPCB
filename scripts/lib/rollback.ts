/**
 * Rollback utilities for error recovery
 */

import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";

export class RollbackManager {
    private createdPaths: string[] = [];
    private cargoTomlBackup: string | null = null;

    trackPath(path: string): void {
        this.createdPaths.push(path);
    }

    trackCargoTomlBackup(backup: string): void {
        this.cargoTomlBackup = backup;
    }

    async rollback(): Promise<void> {
        console.log("\n⚠️  Error occurred during scaffolding. Rolling back changes...\n");

        let rollbackErrors = 0;

        // Delete created files/directories in reverse order
        for (const path of this.createdPaths.reverse()) {
            try {
                if (existsSync(path)) {
                    await rm(path, { recursive: true, force: true });
                    console.log(`  ✓ Removed: ${path}`);
                }
            } catch (error) {
                console.error(`  ✗ Failed to remove ${path}:`, (error as Error).message);
                rollbackErrors++;
            }
        }

        // Restore Cargo.toml backup if exists
        if (this.cargoTomlBackup) {
            try {
                const { writeFile } = await import("node:fs/promises");
                const path = await import("node:path");
                const cargoPath = path.default.join(process.cwd(), "Cargo.toml");
                await writeFile(cargoPath, this.cargoTomlBackup, "utf8");
                console.log("  ✓ Restored Cargo.toml");
            } catch (error) {
                console.error("  ✗ Failed to restore Cargo.toml:", (error as Error).message);
                rollbackErrors++;
            }
        }

        if (rollbackErrors === 0) {
            console.log("\n✅ Rollback complete. No changes were made.\n");
        } else {
            console.log(
                `\n⚠️  Rollback completed with ${rollbackErrors} error(s). Manual cleanup may be required.\n`,
            );
        }
    }
}
