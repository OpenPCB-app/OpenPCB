#!/usr/bin/env bun

/**
 * OpenPCB Module CLI
 * Unified command-line interface for all module operations
 *
 * Usage:
 *   npm run module
 *   bun scripts/module-cli.ts
 *   bun scripts/module-cli.ts --create
 *   bun scripts/module-cli.ts --codegen
 */

import { select } from "@inquirer/prompts";
import process from "node:process";
import { createModuleCommand } from "./lib/commands/create.js";
import { generateRegistryCommand } from "./lib/commands/generate-registry.js";
import { generateSDKCommand } from "./lib/commands/generate-sdk.js";

// =============================================================================
// CLI Commands
// =============================================================================

type Command =
    | "create"
    | "validate"
    | "codegen"
    | "codegen-registry"
    | "codegen-sdk"
    | "exit";

interface CommandDefinition {
    name: string;
    value: Command;
    description?: string;
}

const COMMANDS: CommandDefinition[] = [
    {
        name: "Create new module",
        value: "create",
        description: "Interactive module scaffolding with validation",
    },
    {
        name: "Validate modules",
        value: "validate",
        description: "Validate all module manifests without generating files",
    },
    {
        name: "Run all codegen",
        value: "codegen",
        description: "Generate registry + SDK",
    },
    {
        name: "Generate module registry",
        value: "codegen-registry",
        description: "Generate React module catalog",
    },
    {
        name: "Generate module SDKs",
        value: "codegen-sdk",
        description: "Generate HTTP/Bridge client SDKs",
    },
    {
        name: "Exit",
        value: "exit",
    },
];

// =============================================================================
// Command Execution
// =============================================================================

async function executeCommand(command: Command): Promise<void> {
    switch (command) {
        case "create":
            await createModuleCommand();
            break;

        case "validate":
            await generateRegistryCommand({ validateOnly: true });
            break;

        case "codegen":
            console.log("\n🔄 Running full codegen pipeline...\n");
            console.log("═".repeat(60));
            await generateRegistryCommand();
            console.log("═".repeat(60));
            await generateSDKCommand();
            console.log("═".repeat(60));
            console.log("\n✅ Full codegen complete!\n");
            break;

        case "codegen-registry":
            await generateRegistryCommand();
            break;

        case "codegen-sdk":
            await generateSDKCommand();
            break;

        case "exit":
            console.log("\n👋 Goodbye!\n");
            process.exit(0);
            break;

        default:
            console.error(`Unknown command: ${command}`);
            process.exit(1);
    }
}

// =============================================================================
// CLI Argument Parsing
// =============================================================================

function parseCliArgs(): Command | null {
    const args = process.argv.slice(2);

    // Direct command flags
    if (args.includes("--create")) return "create";
    if (args.includes("--validate")) return "validate";
    if (args.includes("--codegen")) return "codegen";
    if (args.includes("--codegen-registry")) return "codegen-registry";
    if (args.includes("--codegen-sdk")) return "codegen-sdk";

    // Help flag
    if (args.includes("--help") || args.includes("-h")) {
        printHelp();
        process.exit(0);
    }

    return null;
}

function printHelp(): void {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║              OpenPCB Module CLI                           ║
╚════════════════════════════════════════════════════════════╝

Interactive module management and code generation.

Usage:
  npm run module                  Interactive menu
  npm run module -- --create      Create new module
  npm run module -- --validate    Validate manifests
  npm run module -- --codegen     Run all codegen

Commands:
  --create              Create new module interactively
  --validate            Validate all module manifests
  --codegen             Run full codegen (registry + SDK)
  --codegen-registry    Generate module registry only
  --codegen-sdk         Generate module SDKs only
  --help, -h            Show this help message

Examples:
  npm run module
  npm run module -- --create
  npm run module -- --codegen
  bun scripts/module-cli.ts --validate

`);
}

// =============================================================================
// Interactive Menu
// =============================================================================

async function showInteractiveMenu(): Promise<void> {
    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║              OpenPCB Module CLI                           ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");

    const command = await select({
        message: "What would you like to do?",
        choices: COMMANDS,
    });

    await executeCommand(command);

    // After command completes, ask if user wants to do something else
    if (command !== "exit") {
        console.log();
        const again = await select({
            message: "Continue?",
            choices: [
                { name: "Yes - show menu again", value: true },
                { name: "No - exit", value: false },
            ],
        });

        if (again) {
            await showInteractiveMenu();
        } else {
            console.log("\n👋 Goodbye!\n");
        }
    }
}

// =============================================================================
// Main Entry Point
// =============================================================================

async function main(): Promise<void> {
    try {
        // Check for CLI arguments
        const directCommand = parseCliArgs();

        if (directCommand) {
            // Execute direct command
            await executeCommand(directCommand);
        } else {
            // Show interactive menu
            await showInteractiveMenu();
        }
    } catch (error) {
        console.error("\n❌ CLI Error:\n");
        console.error(error);
        process.exit(1);
    }
}

main();
