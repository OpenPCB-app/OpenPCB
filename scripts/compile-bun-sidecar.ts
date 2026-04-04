#!/usr/bin/env bun

/**
 * Compile Bun TypeScript sidecar to platform-specific binary
 *
 * This script compiles src-ts/src/main.ts using Bun and names it according to Tauri conventions:
 * bin/bun-backend-{TARGET_TRIPLE}[.exe]
 *
 * Shared by both Tauri and Electron desktop targets.
 *
 * Examples:
 *   - macOS ARM: bun-backend-aarch64-apple-darwin
 *   - macOS Intel: bun-backend-x86_64-apple-darwin
 *   - Windows: bun-backend-x86_64-pc-windows-msvc.exe
 *   - Linux: bun-backend-x86_64-unknown-linux-gnu
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

// Get Rust target triple for current platform
function getTargetTriple(): string {
  try {
    const rustInfo = execSync("rustc -vV", { encoding: "utf8" });
    const match = /host: (\S+)/g.exec(rustInfo);

    if (!match || !match[1]) {
      throw new Error("Failed to determine platform target triple from rustc");
    }

    return match[1];
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error("Error getting Rust target triple:", error.message);
    }
    console.error("Make sure Rust is installed and rustc is in your PATH");
    process.exit(1);
  }
}

// Compile Bun sidecar
function compileBunSidecar(): void {
  const targetTriple = getTargetTriple();
  const extension = process.platform === "win32" ? ".exe" : "";
  const outputName = `bun-backend-${targetTriple}${extension}`;

  const entrypoint = join(projectRoot, "src-ts", "src", "main.ts");
  const binariesDir = join(projectRoot, "bin");
  const outputPath = join(binariesDir, outputName);

  console.log("🔨 Compiling Bun sidecar...");
  console.log(`  Target triple: ${targetTriple}`);
  console.log(`  Entrypoint: ${entrypoint}`);
  console.log(`  Output: ${outputPath}`);

  // Ensure binaries directory exists
  if (!existsSync(binariesDir)) {
    console.log(`  Creating binaries directory: ${binariesDir}`);
    mkdirSync(binariesDir, { recursive: true });
  }

  // Check if entrypoint exists
  if (!existsSync(entrypoint)) {
    console.error(`❌ Error: Entrypoint not found: ${entrypoint}`);
    process.exit(1);
  }

  try {
    // Compile with Bun
    execSync(`bun build --compile --outfile="${outputPath}" "${entrypoint}"`, {
      stdio: "inherit",
      cwd: projectRoot,
    });

    console.log(`✅ Successfully compiled Bun sidecar: ${outputName}`);
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error("❌ Failed to compile Bun sidecar:", error.message);
    } else {
      console.error("❌ Failed to compile Bun sidecar");
    }
    process.exit(1);
  }
}

// Main execution
compileBunSidecar();
