#!/usr/bin/env bun
// Read-only diagnostic for the PCB pin/pad correlation pipeline.
// Replicates net-pad-correlation.ts matcher logic and reports mismatches per design,
// distinguishing: empty pad numbers, scheme divergence, missing footprint preview.
//
// Usage:
//   bun run scripts/diagnose-pcb-correlation.ts [path-to-sqlite]
// Defaults to src/core/backend/dev-data/openpcb.sqlite (the dev runtime location).

import path from "node:path";
import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";

interface SchemaPart {
  id: string;
  designId: string;
  componentId: string;
  reference: string;
}

interface SchemaPin {
  id: string;
  partId: string;
  number: string | null;
  name: string;
}

interface PcbPlacementPayload {
  id: string;
  partId: string;
  componentId?: string;
  reference?: string;
  footprint?: {
    preview?: {
      pads?: Array<{ number?: string }>;
    };
  };
}

const DEFAULT_DB = "src/core/backend/dev-data/openpcb.sqlite";

function resolveDb(): string {
  const arg = process.argv[2];
  if (arg && arg.length > 0) return path.resolve(arg);
  return path.resolve(process.cwd(), DEFAULT_DB);
}

function main(): void {
  const dbPath = resolveDb();
  if (!existsSync(dbPath)) {
    console.error(`[diagnose] no sqlite at ${dbPath}`);
    process.exit(1);
  }
  console.log(`[diagnose] opening ${dbPath} (read-only)`);
  const db = new Database(dbPath, { readonly: true });

  const designs = db
    .query<
      { id: string; name: string; revision: number },
      []
    >("SELECT id, name, revision FROM designer_design_heads ORDER BY name")
    .all();
  console.log(`[diagnose] ${designs.length} design(s)`);

  for (const design of designs) {
    console.log(
      `\n=== design ${design.id}  name="${design.name}"  rev=${design.revision} ===`,
    );

    const parts = db
      .query<
        SchemaPart,
        [string]
      >("SELECT id, design_id AS designId, component_id AS componentId, reference FROM designer_schematic_parts WHERE design_id = ?")
      .all(design.id);
    const pins = db
      .query<
        SchemaPin,
        [string]
      >("SELECT id, part_id AS partId, number, name FROM designer_schematic_pins WHERE design_id = ?")
      .all(design.id);
    const pcbRows = db
      .query<
        { id: string; payloadJson: string },
        [string]
      >("SELECT id, payload_json AS payloadJson FROM designer_pcb_entities WHERE design_id = ? AND kind = 'placement'")
      .all(design.id);

    const pinsByPart = new Map<string, SchemaPin[]>();
    for (const p of pins) {
      const arr = pinsByPart.get(p.partId) ?? [];
      arr.push(p);
      pinsByPart.set(p.partId, arr);
    }

    const placements: PcbPlacementPayload[] = pcbRows.map((row) => ({
      ...(JSON.parse(row.payloadJson) as PcbPlacementPayload),
    }));
    const placementByPartId = new Map<string, PcbPlacementPayload>();
    for (const pl of placements) placementByPartId.set(pl.partId, pl);

    console.log(
      `  parts=${parts.length}  pins=${pins.length}  placements=${placements.length}`,
    );

    let okCount = 0;
    let mismatchCount = 0;
    let emptyPadsCount = 0;
    let nullPinNumberCount = 0;
    let missingPlacementCount = 0;

    for (const part of parts) {
      const partPins = pinsByPart.get(part.id) ?? [];
      const placement = placementByPartId.get(part.id);
      const pinNums = partPins.map((p) => p.number);

      if (!placement) {
        missingPlacementCount += partPins.length;
        console.log(
          `  PART ${part.reference} (${part.id.slice(0, 8)}…) has no PCB placement; pins=[${pinNums.join(",")}]`,
        );
        continue;
      }

      const pads = placement.footprint?.preview?.pads ?? [];
      const padNums = pads.map((p) => (p.number ?? "").trim());

      if (pads.length === 0) {
        emptyPadsCount += partPins.length;
        console.log(
          `  PART ${part.reference} (${part.id.slice(0, 8)}…) placement has zero pads in footprint.preview.pads; pins=[${pinNums.join(",")}]  componentId=${part.componentId.slice(0, 8)}…`,
        );
        continue;
      }

      const partOk: string[] = [];
      const partBad: string[] = [];
      for (const pin of partPins) {
        if (pin.number === null || pin.number.trim() === "") {
          nullPinNumberCount += 1;
          partBad.push(
            `(pin ${pin.id.slice(0, 8)}… "${pin.name}" has no number)`,
          );
          continue;
        }
        const want = pin.number.trim();
        const found = padNums.find((pn) => pn === want);
        if (found !== undefined) {
          okCount += 1;
          partOk.push(want);
        } else {
          mismatchCount += 1;
          partBad.push(want);
        }
      }

      if (partBad.length > 0) {
        console.log(
          `  PART ${part.reference} (${part.id.slice(0, 8)}…) MISMATCH  pins_requested=[${pinNums.join(",")}]  pads_available=[${padNums.join(",")}]  matched=[${partOk.join(",")}]  unmatched=[${partBad.join(",")}]`,
        );
      }
    }

    console.log(
      `  totals  ok=${okCount}  mismatched=${mismatchCount}  null_pin_number=${nullPinNumberCount}  empty_pad_set=${emptyPadsCount}  no_placement=${missingPlacementCount}`,
    );

    // Failure-mode classification
    if (
      mismatchCount === 0 &&
      emptyPadsCount === 0 &&
      nullPinNumberCount === 0
    ) {
      console.log(`  classification: HEALTHY`);
    } else if (emptyPadsCount > 0 && mismatchCount === 0) {
      console.log(
        `  classification: footprint preview missing pads (likely import skipped pads or footprint has no pads at all)`,
      );
    } else if (mismatchCount > 0) {
      console.log(
        `  classification: pin/pad numbering scheme divergence (likely symbol pins vs footprint pads use different numbers — variant pairing or KiCad pad name vs number)`,
      );
    } else if (nullPinNumberCount > 0) {
      console.log(
        `  classification: symbol pins missing numbers (likely symbol parser failure or hand-drawn symbol without pin numbers)`,
      );
    }
  }

  db.close();
}

main();
