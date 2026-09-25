import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ImportValidationError,
  buildInspectResponse,
} from "../../../modules/library/backend/import/inspect-kicad";
import type { InspectKicadRequest } from "../../../modules/library/backend/import/types";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

const tempRoots: string[] = [];

const ORIGINAL_DB_PATH = process.env.OPENPCB_DB_PATH;

afterEach(async () => {
  resetSharedSqliteForTesting();
  if (ORIGINAL_DB_PATH === undefined) delete process.env.OPENPCB_DB_PATH;
  else process.env.OPENPCB_DB_PATH = ORIGINAL_DB_PATH;
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

const INVALID_INPUTS: Array<[string, InspectKicadRequest, RegExp]> = [
  [
    "a STEP file as the symbol library",
    {
      symbolLibrary: { fileName: "garbage.step", content: "ISO-10303-21; not kicad" },
      footprints: [],
    },
    /Not a valid KiCad symbol library file/,
  ],
  [
    "a truncated s-expression",
    {
      symbolLibrary: { fileName: "x.kicad_sym", content: "(kicad_symbol_lib (version 1" },
      footprints: [],
    },
    /unclosed parenthesis/,
  ],
  [
    "a footprint file without a footprint root",
    { symbolLibrary: null, footprints: [{ fileName: "a.kicad_mod", content: "nope" }] },
    /Not a valid KiCad footprint file/,
  ],
];

describe("KiCad library inspect rejects invalid user files as bad input", () => {
  for (const [label, input, message] of INVALID_INPUTS) {
    test(`${label} → ImportValidationError (400)`, () => {
      let caught: unknown;
      try {
        buildInspectResponse(input);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ImportValidationError);
      expect((caught as ImportValidationError).status).toBe(400);
      expect((caught as Error).message).toMatch(message);
    });
  }

  test("POST /imports/kicad/inspect answers 400 problem+json, not 500", async () => {
    resetSharedSqliteForTesting();
    const root = mkdtempSync(path.join(os.tmpdir(), "openpcb-inspect-invalid-"));
    tempRoots.push(root);
    process.env.OPENPCB_DB_PATH = path.join(root, "openpcb.sqlite");
    const moduleRegistry = new ModuleRouterRegistry();
    const moduleRuntime = new ModuleRuntime({
      moduleRegistry,
      workspaceRoot: path.resolve(import.meta.dir, "../../.."),
    });
    await moduleRuntime.bootstrap();
    const server = createHttpServer({
      diagnosticsStore: new DiagnosticsStore(),
      moduleRegistry,
      moduleRuntime,
    });

    const res = await server.fetch(
      new Request("http://localhost/api/modules/library/imports/kicad/inspect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbolLibrary: { fileName: "garbage.step", content: "this is not a STEP file" },
          footprints: [],
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type") ?? "").toContain("application/problem+json");
    const body = (await res.json()) as { type?: string; detail?: string };
    expect(body.type).toBe("https://openpcb.dev/problems/validation");
    expect(body.detail).toMatch(/Not a valid KiCad symbol library file/);
  });
});
