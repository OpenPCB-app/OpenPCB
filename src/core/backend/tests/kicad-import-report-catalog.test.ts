import { describe, expect, test } from "bun:test";
import {
  KICAD_IMPORT_WARNING_ENTRIES,
  isAcknowledgeableImportBlocker,
  kicadImportWarning,
  kicadImportWarningEntry,
  type KicadImportCatalogEntry,
} from "../../../modules/designer/backend/import/kicad-project/report";
import {
  IMPORT_WARNING_COPY_CODES,
  importWarningCopy,
} from "../../../modules/designer/frontend/components/kicad-import/warning-copy";
import type {
  KicadImportLossPredicate,
  KicadImportSubjectKind,
  KicadImportWarningGroup,
} from "../../../sdks/designer";

const ENTRIES: readonly KicadImportCatalogEntry[] = KICAD_IMPORT_WARNING_ENTRIES;
const CODES = ENTRIES.map((entry) => entry.code);

const GROUPS: readonly KicadImportWarningGroup[] = [
  "components", "nets", "rules", "geometry", "graphics", "schematic", "library", "source",
];

/** The subject each live predicate reads (H14 §3.14.2); `null` = any / none. */
const SUBJECT_BY_PREDICATE: Record<KicadImportLossPredicate, KicadImportSubjectKind | null> = {
  permanent: null,
  subject_deleted: null,
  footprint_changed: "placement",
  zone_deleted: "zone",
  outline_changed: "board",
  netclass_assigned: "net",
  copper_reassigned: "copper",
  delegated: null,
};

const SAMPLE_DETAILS = {
  items: ["U1", "GND", "J1", "R1", "R2", "R3", "C1"],
  tokens: ["solder_mask_margin", "zone_connect", "thermal_bridge_angle"],
  count: 3,
};

const SNAKE_CASE = /\b[a-z0-9]+_[a-z0-9_]+\b/;

describe("KiCad import warning catalog", () => {
  test("codes are unique snake_case identifiers", () => {
    expect(new Set(CODES).size).toBe(CODES.length);
    for (const code of CODES) expect(code).toMatch(/^[a-z0-9]+(?:_[a-z0-9]+)*$/);
  });

  test("every entry has a known group and severity", () => {
    for (const entry of ENTRIES) {
      expect(GROUPS).toContain(entry.group);
      expect(["info", "warning"]).toContain(entry.severity);
    }
  });

  test("blocker class and predicate are valid, with the subject the predicate reads", () => {
    for (const entry of ENTRIES) {
      const blocker = entry.blocker;
      if (!blocker) continue;
      expect([entry.code, entry.severity]).toEqual([entry.code, "warning"]);
      expect(Object.keys(SUBJECT_BY_PREDICATE)).toContain(blocker.predicate);
      if (blocker.class === "cosmetic") {
        expect([entry.code, blocker.predicate]).toEqual([entry.code, "permanent"]);
        continue;
      }
      expect(blocker.class).toBe("capability");
      if (blocker.predicate !== "permanent") {
        expect([entry.code, blocker.subject !== undefined]).toEqual([entry.code, true]);
      }
      const required = SUBJECT_BY_PREDICATE[blocker.predicate];
      if (required) expect([entry.code, blocker.subject]).toEqual([entry.code, required]);
    }
  });

  test("a capability blocker is never acknowledgeable; a cosmetic one is", () => {
    let capability = 0;
    let cosmetic = 0;
    for (const entry of ENTRIES) {
      if (!entry.blocker) continue;
      const ack = isAcknowledgeableImportBlocker(entry.blocker);
      if (entry.blocker.class === "capability") {
        capability += 1;
        expect([entry.code, ack]).toEqual([entry.code, false]);
      } else {
        cosmetic += 1;
        expect([entry.code, ack]).toEqual([entry.code, true]);
      }
    }
    expect(capability).toBeGreaterThan(0);
    expect(cosmetic).toBeGreaterThan(0);
  });

  test("no message contains a raw code, with or without details", () => {
    for (const entry of ENTRIES) {
      for (const details of [{}, SAMPLE_DETAILS]) {
        const message = entry.render(details);
        expect(message.length).toBeGreaterThan(10);
        expect(message).toMatch(/\.$/);
        expect([entry.code, SNAKE_CASE.test(message)]).toEqual([entry.code, false]);
        for (const code of CODES) expect(message.includes(code)).toBe(false);
      }
    }
  });

  test("every P0 wizard copy code is mapped with the same group and blocker class", () => {
    expect(IMPORT_WARNING_COPY_CODES.length).toBeGreaterThan(30);
    for (const code of IMPORT_WARNING_COPY_CODES) {
      const entry = kicadImportWarningEntry(code);
      expect([code, entry !== null]).toEqual([code, true]);
      const copy = importWarningCopy(code);
      expect([code, entry?.group]).toEqual([code, copy.group]);
      expect([code, entry?.blocker?.class]).toEqual([code, copy.blocker]);
    }
  });

  test("suffixed codes of the current pipeline resolve; unknown codes do not", () => {
    expect(kicadImportWarningEntry("wire_anchor_synthesized_label")?.code).toBe(
      "wire_anchor_synthesized",
    );
    expect(kicadImportWarningEntry("wire_anchor_synthesized_wire-joint")?.severity).toBe("info");
    expect(kicadImportWarningEntry("wire_anchor_synthesized_floating")?.severity).toBe("warning");
    expect(kicadImportWarningEntry("not_a_catalog_code")).toBeNull();
  });
});

describe("kicadImportWarning", () => {
  test("carries group, blocker, subject and a humanised message", () => {
    const warning = kicadImportWarning("footprint_manufacturing_token_unsupported", {
      subjectKeys: ["placement-1"],
      details: { items: ["D5"], tokens: ["solder_mask_margin"] },
    });
    expect(warning).toMatchObject({
      code: "footprint_manufacturing_token_unsupported",
      severity: "warning",
      group: "components",
      blocker: { class: "capability", predicate: "footprint_changed" },
      subject: { kind: "placement", keys: ["placement-1"] },
      details: { items: ["D5"], tokens: ["solder_mask_margin"] },
    });
    expect(warning.message).toContain("solder mask margin");
    expect(warning.message).toContain("D5");
  });

  test("a keyed predicate without subject keys fails closed to permanent", () => {
    const warning = kicadImportWarning("zone_hatched_fill_as_solid");
    expect(warning.blocker).toEqual({ class: "capability", predicate: "permanent" });
    expect(warning.subject).toBeUndefined();
    expect(warning.details).toBeUndefined();
  });

  test("a board subject needs no keys; info codes carry no blocker", () => {
    expect(kicadImportWarning("board_outline_approximated")).toMatchObject({
      blocker: { class: "capability", predicate: "outline_changed" },
      subject: { kind: "board", keys: [] },
    });
    const note = kicadImportWarning("arc_tessellated", { details: { count: 4 } });
    expect(note.blocker).toBeUndefined();
    expect(note.severity).toBe("info");
  });

  test("lists are capped so a message stays one readable sentence", () => {
    const warning = kicadImportWarning("component_unresolved", {
      details: { items: SAMPLE_DETAILS.items },
    });
    expect(warning.message).toBe(
      "Some parts couldn't be imported and are missing from the design: U1, GND, J1, R1, R2 and 2 more.",
    );
  });
});
