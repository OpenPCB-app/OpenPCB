/**
 * Module Creation Command
 * Scaffolds new modules with interactive prompts
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ScaffoldOptions } from "../types.js";
import { promptForModuleOptions, confirmScaffold } from "../prompts.js";
import { validateScaffoldOptions, ValidationError } from "../validation.js";
import { RollbackManager } from "../rollback.js";
import {
    generateManifest,
    generateReactComponent,
    generateModuleEntry,
} from "../templates.js";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
const modulesDir = path.join(repoRoot, "modules");

async function writeJsonFile(filePath: string, content: unknown, rollback: RollbackManager): Promise<void> {
    const json = `${JSON.stringify(content, null, 2)}\n`;
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, json, "utf8");
    rollback.trackPath(filePath);
}

async function writeTextFile(filePath: string, content: string, rollback: RollbackManager): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
    rollback.trackPath(filePath);
}

async function scaffoldModule(opts: ScaffoldOptions, rollback: RollbackManager): Promise<void> {
    const moduleDir = path.join(modulesDir, opts.id);

    console.log(`\n🔨 Creating ${opts.kind} module: ${opts.id}\n`);

    rollback.trackPath(moduleDir);
    await mkdir(moduleDir, { recursive: true });

    console.log("  📝 Creating manifest.json...");
    const manifest = generateManifest(opts);
    await writeJsonFile(path.join(moduleDir, "manifest.json"), manifest, rollback);

    if (opts.hasReactUI || opts.kind === "space") {
        console.log("  ⚛️  Creating React component...");
        const reactCode = generateReactComponent(opts);
        await writeTextFile(path.join(moduleDir, "react", "Space.tsx"), reactCode, rollback);
    }

    console.log("  📦 Creating TypeScript module entry...");
    const moduleCode = generateModuleEntry(opts);
    await writeTextFile(path.join(moduleDir, "ts", "module.ts"), moduleCode, rollback);

    console.log("\n✅ Module scaffolded successfully!\n");
}

function printSuccessSummary(opts: ScaffoldOptions): void {
    console.log("═".repeat(60));
    console.log("✅ Module created successfully!");
    console.log("═".repeat(60));
    console.log();
    console.log(`📦 Module ID:     ${opts.id}`);
    console.log(`📝 Label:         ${opts.label}`);
    console.log(`🏷️  Kind:          ${opts.kind}`);
    console.log(`🔖 Namespace:     ${opts.namespace}`);
    console.log(`📁 Location:      modules/${opts.id}/`);
    console.log();
    console.log("📂 Files created:");
    console.log(`   - modules/${opts.id}/manifest.json`);
    console.log(`   - modules/${opts.id}/ts/module.ts`);

    if (opts.hasReactUI || opts.kind === "space") {
        console.log(`   - modules/${opts.id}/react/Space.tsx`);
    }

    console.log();
    console.log("🔧 Next steps:");
    console.log();

    let step = 1;

    if (!opts.runCodegen) {
        console.log(`   ${step}. Run codegen:`);
        console.log("      npm run module -- --codegen");
        console.log();
        step++;
    }

    if (opts.hasHttpEndpoints) {
        console.log(`   ${step}. Implement HTTP endpoints:`);
        console.log(`      Edit: modules/${opts.id}/ts/module.ts`);
        console.log(`      Test: curl http://localhost:3000/api/modules/${opts.id}/example`);
        console.log();
        step++;
    }

    if (opts.hasReactUI || opts.kind === "space") {
        console.log(`   ${step}. Implement React UI:`);
        console.log(`      Edit: modules/${opts.id}/react/Space.tsx`);
        console.log();
        step++;
    }

    console.log("🚀 Start development:");
    console.log("   npm run dev");
    console.log();
    console.log("═".repeat(60));
}

export async function createModuleCommand(): Promise<void> {
    const rollback = new RollbackManager();

    try {
        const opts = await promptForModuleOptions();

        const confirmed = await confirmScaffold(opts);
        if (!confirmed) {
            console.log("\n❌ Module creation cancelled.\n");
            return;
        }

        console.log("\n🔍 Validating configuration...\n");
        await validateScaffoldOptions(opts, repoRoot);
        console.log("✅ Validation passed!\n");

        await scaffoldModule(opts, rollback);

        printSuccessSummary(opts);

        // Return opts so CLI can run codegen if requested
        if (opts.runCodegen) {
            return opts as any;
        }
    } catch (error) {
        if (error instanceof ValidationError) {
            console.error(`\n❌ Validation Error: ${error.message}\n`);
            throw error;
        }

        console.error("\n❌ Error during module creation:\n");
        console.error(error);
        console.log();

        await rollback.rollback();
        throw error;
    }
}
