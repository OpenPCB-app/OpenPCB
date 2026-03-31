/**
 * Interactive prompts for module scaffolding
 */

import { input, select, confirm } from "@inquirer/prompts";
import type { ModuleKind, ScaffoldOptions } from "./types.js";
import { VALID_KINDS, MODULE_ID_PATTERN } from "./types.js";
import { titleCase, getDefaultNamespace } from "./utils.js";

export async function promptForModuleOptions(): Promise<ScaffoldOptions> {
    console.log("\n🔨 OpenPCB Module Creator\n");

    // Module ID
    const id = await input({
        message: "Module ID (kebab-case):",
        validate: (value) => {
            if (!value) return "Module ID is required";
            if (!MODULE_ID_PATTERN.test(value)) {
                return "Invalid format. Must start with a letter and contain only lowercase letters, numbers, and hyphens.";
            }
            return true;
        },
    });

    // Module label
    const label = await input({
        message: "Module label:",
        default: titleCase(id),
        validate: (value) => (value ? true : "Label is required"),
    });

    // Module kind
    const kind = (await select({
        message: "Module kind:",
        choices: [
            { name: "Space (full-screen app)", value: "space" },
            { name: "Service (headless logic)", value: "service" },
            { name: "Widget (embeddable UI)", value: "widget" },
            { name: "Integration (external API)", value: "integration" },
            { name: "System (infrastructure)", value: "system" },
        ],
    })) as ModuleKind;

    // HTTP endpoints
    const defaultHttpEndpoints = kind === "space" || kind === "service" || kind === "integration";
    const hasHttpEndpoints = await confirm({
        message: "Add HTTP endpoints?",
        default: defaultHttpEndpoints,
    });

    // Rust commands
    const hasRustCommands = await confirm({
        message: "Add Rust Tauri commands?",
        default: false,
    });

    // React UI (only ask for non-space kinds)
    let hasReactUI = kind === "space"; // Space always has UI
    if (kind !== "space") {
        hasReactUI = await confirm({
            message: "Add React UI component?",
            default: kind === "widget",
        });
    }

    // Namespace (with smart default)
    const defaultNamespace = getDefaultNamespace(id, kind);
    const namespace = await input({
        message: "Module namespace:",
        default: defaultNamespace,
        validate: (value) => {
            if (!value) return "Namespace is required";
            if (!/^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+$/.test(value)) {
                return "Invalid format. Must be dot-separated lowercase identifiers (e.g., space.mymodule)";
            }
            return true;
        },
    });

    // Version
    const version = await input({
        message: "Version:",
        default: "0.1.0",
        validate: (value) => {
            if (!value) return "Version is required";
            if (!/^\d+\.\d+\.\d+$/.test(value)) {
                return "Invalid format. Must be semver (e.g., 0.1.0)";
            }
            return true;
        },
    });

    // Tags
    const tagsInput = await input({
        message: "Tags (comma-separated, optional):",
        default: "",
    });
    const tags = tagsInput
        ? tagsInput.split(",").map((t) => t.trim()).filter(Boolean)
        : [];

    // Run codegen
    const runCodegen = await confirm({
        message: "Run codegen after creation (npm run gen)?",
        default: true,
    });

    console.log(); // Blank line for readability

    return {
        id,
        label,
        namespace,
        version,
        kind,
        tags,
        hasHttpEndpoints,
        hasRustCommands,
        hasReactUI,
        runCodegen,
    };
}

export async function confirmScaffold(opts: ScaffoldOptions): Promise<boolean> {
    console.log("📋 Module Configuration:\n");
    console.log(`  ID:              ${opts.id}`);
    console.log(`  Label:           ${opts.label}`);
    console.log(`  Kind:            ${opts.kind}`);
    console.log(`  Namespace:       ${opts.namespace}`);
    console.log(`  Version:         ${opts.version}`);
    if (opts.tags.length > 0) {
        console.log(`  Tags:            ${opts.tags.join(", ")}`);
    }
    console.log();
    console.log("📦 Features:");
    console.log(`  HTTP Endpoints:  ${opts.hasHttpEndpoints ? "✅ Yes" : "❌ No"}`);
    console.log(`  Rust Commands:   ${opts.hasRustCommands ? "✅ Yes" : "❌ No"}`);
    console.log(`  React UI:        ${opts.hasReactUI ? "✅ Yes" : "❌ No"}`);
    console.log(`  Run Codegen:     ${opts.runCodegen ? "✅ Yes" : "❌ No"}`);
    console.log();

    return await confirm({
        message: "Create module with this configuration?",
        default: true,
    });
}
