#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
// scripts/gen-bridge.ts -> root
const ROOT = path.resolve(path.dirname(__filename), "..");
const OUTDIR = path.join(ROOT, "src-ts", "core", "generated", "bridge");
const INTROSPECT_BIN = path.join(ROOT, "target", "debug", "bridge-introspect");
// On Windows, add .exe extension
const INTROSPECT_BIN_EXE = process.platform === "win32" ? `${INTROSPECT_BIN}.exe` : INTROSPECT_BIN;

interface Manifest {
    modules: Array<{
        namespace: string;
        commands: Array<{
            name: string;
            args_rust: string;
            result_rust: string;
            stream: boolean;
            long?: boolean;
            item_rust?: string | null;
            event_name?: string | null;
            cancel_name?: string | null;
        }>;
        events: Array<{
            name: string;
            payload_rust: string;
        }>;
    }>;
}

function readManifest(): Manifest {
    const binPath = process.platform === "win32" ? `${INTROSPECT_BIN}.exe` : INTROSPECT_BIN;
    const run = spawnSync(binPath, [], {
        encoding: "utf8",
        cwd: ROOT,
    });

    if (run.status !== 0) {
        console.error("Failed to run bridge-introspect:");
        console.error("Status:", run.status);
        console.error("Stderr:", run.stderr);
        console.error("Stdout:", run.stdout);
        console.error("Error:", run.error);
        process.exit(1);
    }

    try {
        return JSON.parse(run.stdout);
    } catch (e) {
        console.error("Failed to parse manifest JSON:");
        console.error(run.stdout);
        throw e;
    }
}

function typeFromRust(rustName: string): string {
    // Extract the last segment of the Rust type path
    // This expects Specta to export a TS type with the same name
    const parts = rustName.split("::");
    const last = (parts.length > 0 ? parts[parts.length - 1] : rustName) || rustName;

    // Handle common Rust types
    if (last && last.startsWith("Vec<")) {
        const inner = last.slice(4, -1);
        return `${typeFromRust(inner)}[]`;
    }
    if (last && last.startsWith("Option<")) {
        const inner = last.slice(7, -1);
        return `${typeFromRust(inner)} | null`;
    }
    if (last && last.startsWith("Result<")) {
        // Result<T, E> -> T (we handle errors separately)
        const resultParts = last.slice(7, -1).split(",");
        const firstPart = resultParts[0]?.trim();
        return firstPart ? typeFromRust(firstPart) : last;
    }

    // Special handling for BridgeResult - use BridgeResponse from tauri-bindings
    if (last === "BridgeResult") {
        return "BridgeResponse";
    }

    // For types that might not be exported, use 'any' as fallback
    // The generator will try to use Types.{last} but if it doesn't exist, TypeScript will error
    // We'll use 'any' for now to avoid type errors - these are typically internal types
    return last || "any";
}

function sanitizeNamespace(ns: string): string {
    return ns.replace(/[^a-zA-Z0-9_]/g, "_");
}

async function main() {
    console.log("[gen-bridge] Reading manifest...");
    const manifest = readManifest();

    await fs.mkdir(OUTDIR, { recursive: true });

    const imports: string[] = [
        `import { bridgeInvoke, on, type InvokeOptions } from '../RustBridge';`,
        `import { toAsyncIterable } from '../toAsyncIterable';`,
        `import type * as Types from '@shared/generated/tauri-bindings';`,
        ``,
    ];

    const namespaceInterfaces: string[] = [];
    const namespaceObjects: string[] = [];

    for (const m of manifest.modules) {
        const nsName = sanitizeNamespace(m.namespace);
        const ifaceName = `${nsName}NS`;

        // Build interface members
        const members: string[] = [];

        // Commands
        for (const c of m.commands) {
            if (c.long) {
                // Long-running command: generate start, stream, cancel
                const argsT = typeFromRust(c.args_rust);
                const itemT = c.item_rust ? typeFromRust(c.item_rust) : "any";
                // For args, use 'any' if it's not a known type (not exported via Specta)
                const argsType = argsT === "()" ? "null" : (argsT === "any" ? "any" : `Types.${argsT}`);
                members.push(
                    `  ${c.name}_start(args${argsT === "()" ? "?" : ""}: ${argsType}, opts?: InvokeOptions): Promise<{ started: true; correlationId: string }>;`
                );
                const itemType = itemT === "any" ? "any" : `Types.${itemT}`;
                members.push(
                    `  ${c.name}_stream(correlationId: string, opts?: { signal?: AbortSignal }): AsyncIterable<${itemType}>;`
                );
                if (c.cancel_name) {
                    members.push(
                        `  ${c.name}_cancel(correlationId: string): Promise<void>;`
                    );
                }
            } else {
                // Regular command
                const argsT = typeFromRust(c.args_rust);
                const resT = typeFromRust(c.result_rust);
                // Handle unit type () specially
                // For args, check if it's a simple type name (not a complex type like Vec<>, Option<>, etc.)
                // If it's a simple type name and not "()", "any", or "BridgeResponse", use 'any' as fallback
                // since these types might not be exported from tauri-bindings
                const isSimpleType = argsT && !argsT.includes("<") && !argsT.includes("[]") && !argsT.includes("|");
                const argsType = argsT === "()" ? "null" :
                    (argsT === "any" || (isSimpleType && argsT !== "BridgeResponse")) ? "any" :
                        `Types.${argsT}`;
                // For return type, use BridgeResponse if it's BridgeResult, otherwise try Types.{resT}
                const returnType = resT === "BridgeResponse" ? "Types.BridgeResponse" :
                    (resT === "any" ? "any" : `Types.${resT}`);
                members.push(
                    `  ${c.name}(args${argsT === "()" ? "?" : ""}: ${argsType}, opts?: InvokeOptions): Promise<${returnType}>;`
                );
            }
        }

        // Events - use 'any' for event payloads since types may not be exported via Specta
        for (const e of m.events) {
            members.push(
                `  on_${e.name.replace(/-/g, "_")}(cb: (p: any) => void): Promise<() => void>;`
            );
        }

        namespaceInterfaces.push(`export interface ${ifaceName} {\n${members.join("\n")}\n}`);

        // Build runtime object
        const objLines: string[] = [];

        // Commands
        for (const c of m.commands) {
            if (c.long) {
                // Long-running command: generate start, stream, cancel
                const argsT = typeFromRust(c.args_rust);
                const itemT = c.item_rust ? typeFromRust(c.item_rust) : "any";
                const argsType = argsT === "()" ? "null" : (argsT === "any" ? "any" : `Types.${argsT}`);
                const argsParam = argsT === "()" ? "_args?" : "args";
                const eventName = c.event_name || c.name;
                const itemType = itemT === "any" ? "any" : `Types.${itemT}`;

                objLines.push(
                    `  ${c.name}_start: async (${argsParam}: ${argsType}, opts?: InvokeOptions) => await bridgeInvoke<{ started: true; correlationId: string }>('${m.namespace}', '${c.name}', ${argsT === "()" ? "null" : "args"}, opts),`
                );
                objLines.push(
                    `  ${c.name}_stream: (correlationId: string, opts?: { signal?: AbortSignal }) => toAsyncIterable<${itemType}>('${m.namespace}', '${eventName}:data', { signal: opts?.signal, correlationId }),`
                );
                if (c.cancel_name) {
                    objLines.push(
                        `  ${c.name}_cancel: async (correlationId: string) => { await bridgeInvoke('${m.namespace}', '${c.cancel_name}', correlationId); },`
                    );
                }
            } else {
                // Regular command
                const argsT = typeFromRust(c.args_rust);
                const resT = typeFromRust(c.result_rust);
                // Handle unit type () specially
                // For args, check if it's a simple type name (not a complex type)
                const isSimpleType = argsT && !argsT.includes("<") && !argsT.includes("[]") && !argsT.includes("|");
                const argsType = argsT === "()" ? "null" :
                    (argsT === "any" || (isSimpleType && argsT !== "BridgeResponse")) ? "any" :
                        `Types.${argsT}`;
                const argsParam = argsT === "()" ? "_args?" : "args";
                const returnType = resT === "BridgeResponse" ? "Types.BridgeResponse" :
                    (resT === "any" ? "any" : `Types.${resT}`);
                objLines.push(
                    `  ${c.name}: async (${argsParam}: ${argsType}, opts?: InvokeOptions) => await bridgeInvoke<${returnType}>('${m.namespace}', '${c.name}', ${argsT === "()" ? "null" : "args"}, opts),`
                );
            }
        }

        // Events - use 'any' for event payloads
        for (const e of m.events) {
            objLines.push(
                `  on_${e.name.replace(/-/g, "_")}: async (cb: (p: any) => void) => await on<any>('${m.namespace}', '${e.name}', cb),`
            );
        }

        namespaceObjects.push(
            `export const ${nsName}: ${ifaceName} = {\n${objLines.join("\n")}\n};`
        );
    }

    // Build aggregate interface
    const aggregateMembers = manifest.modules
        .map((m, i) => {
            const nsName = sanitizeNamespace(m.namespace);
            const ifaceName = `${nsName}NS`;
            return `  ${nsName}: ${ifaceName};`;
        })
        .join("\n");

    const aggregateObject = manifest.modules
        .map((m) => {
            const nsName = sanitizeNamespace(m.namespace);
            return `  ${nsName}: ${nsName},`;
        })
        .join("\n");

    const content = [
        "// This file is auto-generated by scripts/gen-bridge.ts",
        "// Do not edit manually",
        "// @ts-nocheck",
        "",
        ...imports,
        "",
        ...namespaceInterfaces,
        "",
        ...namespaceObjects,
        "",
        `export interface BridgeInterface {`,
        aggregateMembers,
        `}`,
        "",
        `export const bridge: BridgeInterface = {`,
        aggregateObject,
        `};`,
        "",
    ].join("\n");

    const outputPath = path.join(OUTDIR, "BridgeInterface.ts");
    await fs.writeFile(outputPath, content, "utf8");

    console.log(`[gen-bridge] Generated ${outputPath}`);
}

main().catch((e) => {
    console.error("[gen-bridge] Error:", e);
    process.exit(1);
});

