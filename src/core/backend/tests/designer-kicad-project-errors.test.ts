import { describe, expect, test } from "bun:test";
import { packZip } from "../../../modules/designer/backend/export/zip";
import { bootDesignerRuntime, type TestServer } from "./helpers/designer-runtime";

function zipOf(files: Record<string, string>): Uint8Array {
  return packZip(
    Object.entries(files).map(([fileName, text]) => ({
      kind: "csv.bom" as const,
      fileName,
      text,
    })),
  );
}

async function upload(
  server: TestServer,
  endpoint: "inspect" | "commit",
  bytes: Uint8Array,
  fileName = "project.zip",
): Promise<{ status: number; contentType: string; problem: Record<string, unknown> }> {
  const form = new FormData();
  form.append("file", new File([bytes], fileName, { type: "application/zip" }));
  const path =
    endpoint === "inspect"
      ? "/api/modules/designer/imports/kicad-project/inspect"
      : "/api/modules/designer/imports/kicad-project";
  const response = await server.fetch(
    new Request(`http://localhost${path}`, { method: "POST", body: form }),
  );
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    problem: (await response.json()) as Record<string, unknown>,
  };
}

const KICAD6_PRO = '{"meta":{"filename":"blinky.kicad_pro","version":1}}';
const KICAD6_SCH = "(kicad_sch (version 20231120) (generator eeschema))";
const KICAD5_PCB = "(kicad_pcb (version 20171130) (host pcbnew 5.1.9))";

describe("KiCad project import: bad user files are 4xx problems, not 500s (T-251)", () => {
  test("each kind of invalid archive gets its own 422 reason and message", async () => {
    const { server } = await bootDesignerRuntime("kicad-project-errors");
    const cases: Array<{
      files: Record<string, string>;
      reason: string;
      type: string;
      detail: RegExp;
    }> = [
      {
        // KiCad 5: .pro + .sch, no .kicad_pro.
        files: {
          "geckonator.pro": "update=22/05/2020\n",
          "geckonator.sch": "EESchema Schematic File Version 4\n",
          "geckonator.kicad_pcb": KICAD5_PCB,
        },
        reason: "legacy_kicad",
        type: "https://openpcb.dev/problems/kicad-legacy-project",
        detail: /KiCad 6 or newer/,
      },
      {
        // A KiCad 6 project file around a board saved by KiCad 5.
        files: {
          "blinky.kicad_pro": KICAD6_PRO,
          "blinky.kicad_sch": KICAD6_SCH,
          "blinky.kicad_pcb": KICAD5_PCB,
        },
        reason: "legacy_kicad",
        type: "https://openpcb.dev/problems/kicad-legacy-project",
        detail: /KiCad 5/,
      },
      {
        files: {
          "LM324N.kicad_sym": "(kicad_symbol_lib (version 20211014))",
          "DIP-14.kicad_mod": "(footprint DIP-14)",
        },
        reason: "library_archive",
        type: "https://openpcb.dev/problems/kicad-project-incomplete",
        detail: /Library/,
      },
      {
        files: { "readme.txt": "hello" },
        reason: "missing_project",
        type: "https://openpcb.dev/problems/kicad-project-incomplete",
        detail: /\.kicad_pro/,
      },
      {
        files: {
          "blinky.kicad_pro": "{ not json",
          "blinky.kicad_sch": KICAD6_SCH,
          "blinky.kicad_pcb": "(kicad_pcb (version 20221018))",
        },
        reason: "unreadable_file",
        type: "https://openpcb.dev/problems/kicad-project-unreadable",
        detail: /blinky\.kicad_pro/,
      },
      {
        files: {
          "blinky.kicad_pro": KICAD6_PRO,
          "blinky.kicad_sch": "this is not a schematic",
          "blinky.kicad_pcb": "(kicad_pcb (version 20221018))",
        },
        reason: "unreadable_file",
        type: "https://openpcb.dev/problems/kicad-project-unreadable",
        detail: /blinky\.kicad_sch/,
      },
    ];
    for (const { files, reason, type, detail } of cases) {
      for (const endpoint of ["inspect", "commit"] as const) {
        const { status, contentType, problem } = await upload(
          server,
          endpoint,
          zipOf(files),
        );
        expect(status).toBe(422);
        expect(contentType).toContain("application/problem+json");
        expect(problem.reason).toBe(reason);
        expect(problem.type).toBe(type);
        expect(String(problem.detail)).toMatch(detail);
      }
    }
  });

  test("a file that is not a ZIP at all is a 400", async () => {
    const { server } = await bootDesignerRuntime("kicad-project-not-zip");
    const { status, contentType } = await upload(
      server,
      "inspect",
      new TextEncoder().encode("this is not a zip archive"),
    );
    expect(status).toBe(400);
    expect(contentType).toContain("application/problem+json");
  });
});
