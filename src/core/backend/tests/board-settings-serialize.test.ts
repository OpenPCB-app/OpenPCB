/**
 * Board-settings persistence must stop ERASING what it cannot parse. Every
 * writer now goes through `serializeBoardSettings`, which carries the stored
 * blob's unknown keys forward and stamps `schemaVersion` — while the TYPED
 * projection `parseBoardSettings` returns stays exactly what it was.
 *
 * The cases run against an in-memory `designer_pcb_entities`, so each one drives
 * the real store function and then reads the RAW payload back.
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { computeBoardContentDigest } from "../../../modules/designer/backend/pcb/board-content-digest";
import {
  BOARD_SETTINGS_SCHEMA_VERSION,
  serializeBoardSettings,
  type BoardSettingsRowParsers,
} from "../../../modules/designer/backend/pcb/board-settings-serialize";
import {
  createDefaultPcbBoardSettings,
  createDefaultPcbViewState,
} from "../../../modules/designer/backend/pcb/pcb-defaults";
import {
  ensurePcbBoardSettings,
  migrateLegacyBoardFill,
  readRawBoardSettingsRow,
  replacePcbBoardSettings,
  serializePcbBoardSettings,
  updatePcbActiveLayer,
  updatePcbBoardOutline,
  updatePcbBoardSize,
  updatePcbDesignRules,
  updatePcbViewState,
  updatePcbVisibleLayers,
} from "../../../modules/designer/backend/pcb/pcb-store";
import { pcbEntities } from "../../../modules/designer/backend/schema";
import type {
  DesignerPcbProjection,
  PcbBoardSettings,
  PcbDrcRule,
} from "../../../sdks/designer";

type PcbDb = Parameters<typeof migrateLegacyBoardFill>[0];

const TS = "2026-01-01T00:00:00.000Z";
const TS2 = "2026-02-02T00:00:00.000Z";
const NO_NETS = new Map<string, string>();

function makeDb(): PcbDb {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE designer_pcb_entities (
      id TEXT PRIMARY KEY NOT NULL,
      design_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return drizzle(sqlite) as unknown as PcbDb;
}

/** Write a raw `board_settings` payload, bypassing every parser. */
function seedRaw(
  db: PcbDb,
  designId: string,
  raw: Record<string, unknown>,
): void {
  db.insert(pcbEntities)
    .values({
      id: crypto.randomUUID(),
      designId,
      kind: "board_settings",
      payloadJson: JSON.stringify(raw),
      createdAt: TS,
      updatedAt: TS,
    })
    .run();
}

/** Seed a payload that cannot be written as an object literal (`__proto__`). */
function seedRawJson(db: PcbDb, designId: string, payloadJson: string): void {
  db.insert(pcbEntities)
    .values({
      id: crypto.randomUUID(),
      designId,
      kind: "board_settings",
      payloadJson,
      createdAt: TS,
      updatedAt: TS,
    })
    .run();
}

function readRaw(db: PcbDb, designId: string): Record<string, unknown> {
  const row = readRawBoardSettingsRow(db, designId);
  if (!row) throw new Error("no board_settings row");
  return row.raw;
}

function asRec(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`expected a record, got ${JSON.stringify(value)}`);
  }
  return value as Record<string, unknown>;
}

function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error("expected an array");
  return value.map(asRec);
}

function rowById(value: unknown, id: string): Record<string, unknown> {
  const found = rows(value).find((row) => row.id === id);
  if (!found) throw new Error(`no row ${id}`);
  return found;
}

/**
 * A stored blob from a NEWER build: a top-level key, a `designRules` key, a key
 * inside a known sub-block, and one on every id-keyed row type.
 */
function futureBlob(): Record<string, unknown> {
  const base = createDefaultPcbBoardSettings(TS) as unknown as Record<
    string,
    unknown
  >;
  const designRules = asRec(base.designRules);
  return {
    ...base,
    stackup: { layers: ["F.Cu", "B.Cu"], dielectricMm: 1.5 },
    designRules: {
      ...designRules,
      thermal: { maxJunctionC: 125 },
      electrical: { tempRiseC: 8, futureElectricalKey: "keep" },
      clearance: { ...asRec(designRules.clearance), futureClearanceKey: 9 },
    },
    netClasses: [
      {
        id: "power",
        name: "Power",
        traceWidthMm: 0.5,
        clearanceMm: 0.3,
        viaDiameterMm: 0.8,
        viaDrillMm: 0.4,
        color: "#ff0000",
        defaultViaProtection: "tented",
        impedanceOhm: 50,
      },
    ],
    diffPairs: [
      { id: "dp1", name: "USB", pNetId: "n1", nNetId: "n2", futureDpKey: true },
    ],
    lengthMatchGroups: [
      {
        id: "lg1",
        name: "DDR",
        netIds: ["n1"],
        target: { kind: "absolute", mm: 40, futureTargetKey: 1 },
        toleranceMm: 0.1,
        futureGroupKey: "keep",
      },
    ],
    drcRules: [
      {
        id: "r1",
        name: "Tight",
        enabled: true,
        priority: 5,
        scopes: [{ kind: "net", netIds: ["n1"], futureScopeKey: 2 }],
        constraint: { kind: "clearance", mm: 0.4, futureConstraintKey: 3 },
        futureRuleKey: "keep",
      },
    ],
  };
}

describe("unknown data survives a board-settings write", () => {
  test("every unknown position is carried through an ordinary rules edit", () => {
    const db = makeDb();
    seedRaw(db, "d1", futureBlob());

    const stored = ensurePcbBoardSettings(db, "d1", TS);
    updatePcbDesignRules({
      db,
      designId: "d1",
      designRules: {
        ...stored.designRules,
        clearance: { ...stored.designRules.clearance, traceToTraceMm: 0.33 },
      },
      timestamp: TS2,
    });

    const raw = readRaw(db, "d1");
    expect(raw.stackup).toEqual({
      layers: ["F.Cu", "B.Cu"],
      dielectricMm: 1.5,
    });
    const designRules = asRec(raw.designRules);
    expect(designRules.thermal).toEqual({ maxJunctionC: 125 });
    expect(asRec(designRules.electrical).futureElectricalKey).toBe("keep");
    expect(asRec(designRules.clearance).futureClearanceKey).toBe(9);
    expect(rowById(raw.netClasses, "power").impedanceOhm).toBe(50);
    expect(rowById(raw.diffPairs, "dp1").futureDpKey).toBe(true);
    const group = rowById(raw.lengthMatchGroups, "lg1");
    expect(group.futureGroupKey).toBe("keep");
    expect(asRec(group.target).futureTargetKey).toBe(1);
    const rule = rowById(raw.drcRules, "r1");
    expect(rule.futureRuleKey).toBe("keep");
    expect(asRec(rule.constraint).futureConstraintKey).toBe(3);
    expect(asRec(rows(rule.scopes)[0]).futureScopeKey).toBe(2);

    // …and the edit itself landed.
    expect(asRec(designRules.clearance).traceToTraceMm).toBe(0.33);
    expect(asRec(designRules.electrical).tempRiseC).toBe(8);
  });

  test("an unparseable row is rescued, a deleted one is not resurrected", () => {
    const db = makeDb();
    const blob = futureBlob();
    blob.lengthMatchGroups = [
      ...rows(blob.lengthMatchGroups),
      // A target variant only a NEWER build understands.
      { id: "lg2", name: "Delayed", netIds: ["n3"], target: { kind: "delay", ps: 120 }, toleranceMm: 0 },
    ];
    seedRaw(db, "d1", blob);

    const stored = ensurePcbBoardSettings(db, "d1", TS);
    // The unknown variant never reaches the typed projection.
    expect(stored.lengthMatchGroups?.map((g) => g.id)).toEqual(["lg1"]);

    // The user deletes the one group they CAN see, and clears the diff pairs.
    updatePcbDesignRules({
      db,
      designId: "d1",
      lengthMatchGroups: [],
      diffPairs: [],
      timestamp: TS2,
    });

    const raw = readRaw(db, "d1");
    const groups = rows(raw.lengthMatchGroups);
    expect(groups.map((g) => g.id)).toEqual(["lg2"]);
    expect(asRec(groups[0]?.target).ps).toBe(120);
    // A known optional key the user emptied stays empty.
    expect(raw.diffPairs).toBeUndefined();
    expect(ensurePcbBoardSettings(db, "d1", TS2).lengthMatchGroups).toBeUndefined();

    // A rescued row is carried, never re-appended: further writes must not grow
    // the array.
    updatePcbActiveLayer({ db, designId: "d1", layer: "B.Cu", timestamp: TS2 });
    updatePcbActiveLayer({ db, designId: "d1", layer: "F.Cu", timestamp: TS2 });
    expect(rows(readRaw(db, "d1").lengthMatchGroups).map((g) => g.id)).toEqual([
      "lg2",
    ]);
  });
});

describe("schemaVersion", () => {
  test("a blob with no version is stamped with this build's", () => {
    const db = makeDb();
    seedRaw(db, "d1", futureBlob());
    updatePcbActiveLayer({ db, designId: "d1", layer: "B.Cu", timestamp: TS2 });
    expect(readRaw(db, "d1").schemaVersion).toBe(BOARD_SETTINGS_SCHEMA_VERSION);
  });

  test("a version AHEAD of this build loads and is preserved", () => {
    const db = makeDb();
    seedRaw(db, "d1", { ...futureBlob(), schemaVersion: 7 });
    // No refusal on read.
    expect(ensurePcbBoardSettings(db, "d1", TS).layerCount).toBe(2);
    updatePcbActiveLayer({ db, designId: "d1", layer: "B.Cu", timestamp: TS2 });
    expect(readRaw(db, "d1").schemaVersion).toBe(7);
  });
});

/** Board settings exercising every optional key, built to be a parser fixed point. */
function fullSettings(): PcbBoardSettings {
  const base = createDefaultPcbBoardSettings(TS);
  return {
    ...base,
    cutouts: [
      {
        id: "c1",
        shape: {
          kind: "circle",
          widthMm: 3,
          heightMm: 3,
          centerMm: { x: 1, y: 2 },
        },
      },
    ],
    // `parseViewState` always emits the key, so the parser's fixed point has it.
    viewState: { ...createDefaultPcbViewState(), autoLayoutConfig: undefined },
    designRules: {
      clearance: { ...base.designRules.clearance, holeToBoardEdgeMm: 0.4, pourToCopperMm: 0.5, copperToHoleMm: 0.3 },
      minimums: { ...base.designRules.minimums, holeToHoleMm: 0.3, clearanceMm: 0.1 },
      electrical: { tempRiseC: 8, copperWeightOz: 2, innerCopperWeightOz: 1, outerConductors: "coated" },
      silkscreen: { silkToMaskClearanceMm: 0.1, silkToBoardEdgeMm: 0.2 },
      solderMask: { minBridgeMm: 0.1 },
      dfm: { sliverWidthMm: 0.1, sliverMinLengthMm: 0.2, acuteAngleDeg: 80, courtyardFallbackMm: 0.25 },
      outline: { minWebMm: 0.8 },
    },
    netClasses: [
      {
        id: "power",
        name: "Power",
        traceWidthMm: 0.5,
        clearanceMm: 0.3,
        viaDiameterMm: 0.8,
        viaDrillMm: 0.4,
        color: "#ff0000",
        defaultViaProtection: "plugged",
        diffPairGapMm: 0.2,
        voltageV: 12,
        voltageMinV: -300,
        voltageMaxV: 300,
        currentA: 1.5,
      },
    ],
    perNetClassAssignments: { n1: "power" },
    drcSeverityOverrides: { TRACE_WIDTH_MIN: "warning" },
    drcRules: [
      {
        id: "r1",
        name: "Tight",
        enabled: false,
        priority: 5,
        scopes: [{ kind: "net", netIds: ["n1"] }, { kind: "layer", layers: ["F.Cu"] }],
        constraint: { kind: "clearance", mm: 0.4 },
        severity: "error",
        comment: "keep",
      },
    ],
    diffPairs: [
      {
        id: "dp1",
        name: "USB",
        pNetId: "n1",
        nNetId: "n2",
        gapMm: 0.2,
        gapTolMm: 0.05,
        maxUncoupledMm: 10,
        maxSkewMm: 0.5,
        couplingMaxGapMm: 0.9,
      },
    ],
    lengthMatchGroups: [
      { id: "lg1", name: "DDR", netIds: ["n1"], target: { kind: "absolute", mm: 40 }, toleranceMm: 0.1 },
    ],
    boardThicknessMm: 0.8,
    layerCount: 4,
    updatedAt: TS,
  };
}

describe("the typed projection does not move", () => {
  test("a settings object with every optional field round-trips unchanged", () => {
    const db = makeDb();
    const next = fullSettings();
    db.insert(pcbEntities)
      .values({
        id: crypto.randomUUID(),
        designId: "d1",
        kind: "board_settings",
        payloadJson: serializePcbBoardSettings(undefined, next),
        createdAt: TS,
        updatedAt: TS,
      })
      .run();

    expect(ensurePcbBoardSettings(db, "d1", TS)).toEqual(next);
  });

  test("carried unknown keys never reach the projection", () => {
    const db = makeDb();
    seedRaw(db, "d1", futureBlob());
    const settings = ensurePcbBoardSettings(db, "d1", TS) as unknown as Record<
      string,
      unknown
    >;
    expect(settings.stackup).toBeUndefined();
    expect(settings.schemaVersion).toBeUndefined();
    expect(asRec(settings.designRules).thermal).toBeUndefined();
    expect(
      asRec(asRec(settings.designRules).electrical).futureElectricalKey,
    ).toBeUndefined();
    const netClass = rows(settings.netClasses)[0];
    expect(netClass && netClass.impedanceOhm).toBeUndefined();
  });
});

const ALWAYS_PARSES: BoardSettingsRowParsers = {
  netClasses: () => true,
  diffPairs: () => true,
  lengthMatchGroups: () => true,
  drcRules: () => true,
};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

describe("serializeBoardSettings is deterministic and pure", () => {
  test("same inputs give the identical string and mutate neither argument", () => {
    const stored = deepFreeze(futureBlob());
    const next = deepFreeze(fullSettings());
    const first = serializeBoardSettings(stored, next, ALWAYS_PARSES);
    const second = serializeBoardSettings(stored, next, ALWAYS_PARSES);
    expect(first).toBe(second);
    expect(stored).toEqual(futureBlob());
    expect(next).toEqual(fullSettings());
    // Carried keys come first, then the typed keys, then the version.
    expect(Object.keys(JSON.parse(first) as Record<string, unknown>)[0]).toBe(
      "stackup",
    );
    expect(first.endsWith(`"schemaVersion":1}`)).toBe(true);
  });
});

describe("every writer preserves an unknown top-level key", () => {
  const writers: Array<[string, (db: PcbDb) => void]> = [
    [
      "updatePcbBoardSize",
      (db) =>
        void updatePcbBoardSize({
          db,
          designId: "d1",
          widthMm: 50,
          heightMm: 40,
          timestamp: TS2,
        }),
    ],
    [
      "updatePcbBoardOutline",
      (db) =>
        void updatePcbBoardOutline({
          db,
          designId: "d1",
          outline: {
            ...ensurePcbBoardSettings(db, "d1", TS).outline,
            widthMm: 60,
          },
          timestamp: TS2,
        }),
    ],
    [
      "updatePcbActiveLayer",
      (db) =>
        void updatePcbActiveLayer({
          db,
          designId: "d1",
          layer: "B.Cu",
          timestamp: TS2,
        }),
    ],
    [
      "updatePcbVisibleLayers",
      (db) =>
        void updatePcbVisibleLayers({
          db,
          designId: "d1",
          visibleLayers: ["F.Cu", "B.Cu"],
          timestamp: TS2,
        }),
    ],
    [
      "updatePcbViewState",
      (db) =>
        void updatePcbViewState({
          db,
          designId: "d1",
          patch: { viewSide: "bottom" },
          timestamp: TS2,
        }),
    ],
    [
      "updatePcbDesignRules",
      (db) =>
        void updatePcbDesignRules({
          db,
          designId: "d1",
          boardThicknessMm: 1.2,
          timestamp: TS2,
        }),
    ],
    [
      "replacePcbBoardSettings",
      (db) =>
        replacePcbBoardSettings(
          db,
          "d1",
          { ...ensurePcbBoardSettings(db, "d1", TS), displayMode: "dim" },
          TS2,
        ),
    ],
  ];

  for (const [name, write] of writers) {
    test(`${name} carries it forward`, () => {
      const db = makeDb();
      seedRaw(db, "d1", futureBlob());
      write(db);
      const raw = readRaw(db, "d1");
      expect(raw.stackup).toEqual({
        layers: ["F.Cu", "B.Cu"],
        dielectricMm: 1.5,
      });
      expect(raw.schemaVersion).toBe(BOARD_SETTINGS_SCHEMA_VERSION);
    });
  }

  test("ensurePcbBoardSettings repairing an unparsable row carries it forward", () => {
    const db = makeDb();
    // No `activeLayer` → `parseBoardSettings` rejects the whole payload.
    const { activeLayer: _dropped, ...broken } = futureBlob();
    seedRaw(db, "d1", broken);
    ensurePcbBoardSettings(db, "d1", TS2);
    expect(readRaw(db, "d1").stackup).toEqual({
      layers: ["F.Cu", "B.Cu"],
      dielectricMm: 1.5,
    });
  });

  test("the legacy fill→zone migration carries it forward", () => {
    const db = makeDb();
    const blob = futureBlob();
    seedRaw(db, "d1", {
      ...blob,
      viewState: {
        ...asRec(blob.viewState),
        copperFillLayers: ["F.Cu"],
        futureViewField: 42,
      },
    });

    expect(migrateLegacyBoardFill(db, "d1", NO_NETS, TS2)).toBe(true);

    const raw = readRaw(db, "d1");
    expect(raw.stackup).toEqual({
      layers: ["F.Cu", "B.Cu"],
      dielectricMm: 1.5,
    });
    expect(raw.schemaVersion).toBe(BOARD_SETTINGS_SCHEMA_VERSION);
    // The raw write keeps what is INSIDE viewState too.
    expect(asRec(raw.viewState).futureViewField).toBe(42);
    expect(asRec(raw.viewState).copperFillLayers).toBeUndefined();
  });
});

function projectionOf(board: PcbBoardSettings): DesignerPcbProjection {
  return {
    designId: "d1",
    revision: 1,
    board,
    placements: [],
    traces: [],
    vias: [],
    freeHoles: [],
    freePads: [],
    overlayTexts: [],
    overlayShapes: [],
    zones: [],
    keepouts: [],
    ratsnest: [],
    netNames: {},
    warnings: [],
  };
}

describe("the content digest does not move", () => {
  test("a save that only carries unknown keys leaves the digest alone", () => {
    const db = makeDb();
    seedRaw(db, "d1", futureBlob());
    const before = computeBoardContentDigest(
      projectionOf(ensurePcbBoardSettings(db, "d1", TS)),
    );

    // A view-state write: excluded from the digest, and it is the write that
    // re-serialises the whole blob and so carries every unknown key forward.
    updatePcbViewState({
      db,
      designId: "d1",
      patch: { viewSide: "bottom" },
      timestamp: TS2,
    });

    expect(readRaw(db, "d1").stackup).toBeDefined();
    expect(readRaw(db, "d1").schemaVersion).toBe(BOARD_SETTINGS_SCHEMA_VERSION);
    expect(
      computeBoardContentDigest(
        projectionOf(ensurePcbBoardSettings(db, "d1", TS2)),
      ),
    ).toBe(before);
  });
});

// ───────────────── scopes are paired by CONTENT, never by index ─────────────

function withScopes(scopes: unknown[]): Record<string, unknown> {
  const base = createDefaultPcbBoardSettings(TS) as unknown as Record<
    string,
    unknown
  >;
  return {
    ...base,
    drcRules: [
      {
        id: "r1",
        name: "R",
        enabled: true,
        priority: 10,
        scopes,
        constraint: { kind: "clearance", mm: 0.2 },
      },
    ],
  };
}

function nextWithScopes(scopes: PcbDrcRule["scopes"]): PcbBoardSettings {
  const base = createDefaultPcbBoardSettings(TS);
  return {
    ...base,
    drcRules: [
      {
        id: "r1",
        name: "R",
        enabled: true,
        priority: 10,
        scopes,
        constraint: { kind: "clearance", mm: 0.2 },
      },
    ],
  };
}

/** The merged `scopes` of rule `r1` after a save. */
function mergeScopesOf(
  storedScopes: unknown[],
  nextScopes: PcbDrcRule["scopes"],
): Record<string, unknown>[] {
  const out = JSON.parse(
    serializeBoardSettings(
      withScopes(storedScopes),
      nextWithScopes(nextScopes),
      ALWAYS_PARSES,
    ),
  ) as Record<string, unknown>;
  return rows(rowById(out.drcRules, "r1").scopes);
}

const NET_1 = { kind: "net", netIds: ["n1"], futureMode: "FIRST" };
const NET_2 = { kind: "net", netIds: ["n2"], futureMode: "SECOND" };

describe("per-scope unknown keys are never misattributed", () => {
  test("deleting the first scope leaves the survivor its OWN key", () => {
    const merged = mergeScopesOf(
      [NET_1, NET_2],
      [{ kind: "net", netIds: ["n2"] }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.futureMode).toBe("SECOND");
  });

  test("reordering the scopes carries each key with its own scope", () => {
    const merged = mergeScopesOf(
      [NET_1, NET_2],
      [
        { kind: "net", netIds: ["n2"] },
        { kind: "net", netIds: ["n1"] },
      ],
    );
    expect(merged.map((s) => s.futureMode)).toEqual(["SECOND", "FIRST"]);
  });

  test("an EDITED scope loses its unknown keys; an untouched one keeps them", () => {
    const merged = mergeScopesOf(
      [NET_1, NET_2],
      [
        { kind: "net", netIds: ["n1", "n3"] },
        { kind: "net", netIds: ["n2"] },
      ],
    );
    // No stored scope agrees with the edited one, so nothing is carried onto
    // it — losing a key beats moving it onto a rule that now means something
    // different.
    expect(merged[0]?.futureMode).toBeUndefined();
    expect(merged[1]?.futureMode).toBe("SECOND");
  });

  test("scopes identical on the next keys match first-unused, deterministically", () => {
    const stored = [
      { kind: "net", netIds: ["n1"], tag: "A" },
      { kind: "net", netIds: ["n1"], tag: "B" },
    ];
    const next: PcbDrcRule["scopes"] = [
      { kind: "net", netIds: ["n1"] },
      { kind: "net", netIds: ["n1"] },
    ];
    expect(mergeScopesOf(stored, next).map((s) => s.tag)).toEqual(["A", "B"]);
    expect(mergeScopesOf(stored, next).map((s) => s.tag)).toEqual(["A", "B"]);
  });

  test("a scope of a different kind never donates its keys", () => {
    const merged = mergeScopesOf(
      [{ kind: "layer", layers: ["F.Cu"], futureMode: "LAYER" }],
      [{ kind: "net", netIds: ["n1"] }],
    );
    expect(merged[0]?.futureMode).toBeUndefined();
  });
});

// ───────────────────────── the rescue rule ─────────────────────────

/** Only a `clearance` constraint parses — the variant this build understands. */
const CLEARANCE_ONLY: BoardSettingsRowParsers = {
  netClasses: () => true,
  diffPairs: () => true,
  lengthMatchGroups: () => true,
  drcRules: (row) =>
    asRec(row).constraint !== undefined &&
    asRec(asRec(row).constraint).kind === "clearance",
};

function serializeDrcRules(
  storedRules: unknown[],
  nextRules: PcbDrcRule[],
): unknown[] {
  const base = createDefaultPcbBoardSettings(TS) as unknown as Record<
    string,
    unknown
  >;
  const out = JSON.parse(
    serializeBoardSettings(
      { ...base, drcRules: storedRules },
      { ...createDefaultPcbBoardSettings(TS), drcRules: nextRules },
      CLEARANCE_ONLY,
    ),
  ) as Record<string, unknown>;
  return Array.isArray(out.drcRules) ? (out.drcRules as unknown[]) : [];
}

const FUTURE_RULE = {
  id: "x",
  name: "future variant",
  constraint: { kind: "future", mm: 0.3 },
  futureKey: 1,
};
const KEPT_RULE: PcbDrcRule = {
  id: "x",
  name: "known",
  enabled: true,
  priority: 0,
  scopes: [],
  constraint: { kind: "clearance", mm: 0.5 },
};

describe("every unparseable row is rescued", () => {
  test("a row sharing its id with a KEPT row is still rescued", () => {
    const merged = serializeDrcRules(
      [{ ...KEPT_RULE, constraint: { kind: "clearance", mm: 0.2 } }, FUTURE_RULE],
      [KEPT_RULE],
    );
    expect(merged).toHaveLength(2);
    expect(asRec(merged[0]).constraint).toEqual({ kind: "clearance", mm: 0.5 });
    expect(asRec(merged[1]).futureKey).toBe(1);
  });

  test("rows with no id, a non-string id or a duplicate id are all rescued", () => {
    const merged = serializeDrcRules(
      [
        { id: "x", name: "A", constraint: { kind: "future", mm: 1 } },
        { id: "x", name: "B", constraint: { kind: "future", mm: 2 } },
        { id: "", name: "C", constraint: { kind: "future", mm: 3 } },
        { name: "no id", constraint: { kind: "future", mm: 4 } },
        { id: 42, name: "numeric id", constraint: { kind: "future", mm: 5 } },
      ],
      [],
    );
    expect(merged.map((r) => asRec(r).name)).toEqual([
      "A",
      "B",
      "C",
      "no id",
      "numeric id",
    ]);
  });

  test("non-record array entries are not rescued", () => {
    expect(serializeDrcRules([1, "junk", null, []], [])).toEqual([]);
  });

  test("the carry-over index ignores UNPARSEABLE stored rows", () => {
    // The unparseable twin must not donate its keys to the kept row; only the
    // parseable stored row with that id may.
    const merged = serializeDrcRules(
      [
        { ...KEPT_RULE, constraint: { kind: "clearance", mm: 0.2 }, goodKey: 7 },
        FUTURE_RULE,
      ],
      [KEPT_RULE],
    );
    expect(asRec(merged[0]).goodKey).toBe(7);
    expect(asRec(merged[0]).futureKey).toBeUndefined();
  });

  test("rescued rows do not multiply across repeated saves", () => {
    const base = createDefaultPcbBoardSettings(TS) as unknown as Record<
      string,
      unknown
    >;
    let current: Record<string, unknown> = {
      ...base,
      drcRules: [FUTURE_RULE, { name: "no id", constraint: { kind: "f" } }],
    };
    for (let i = 0; i < 3; i += 1) {
      current = JSON.parse(
        serializeBoardSettings(
          current,
          createDefaultPcbBoardSettings(TS),
          CLEARANCE_ONLY,
        ),
      ) as Record<string, unknown>;
    }
    expect(rows(current.drcRules)).toHaveLength(2);
  });

  test("an assignment to a RESCUED net class survives with the class", () => {
    const db = makeDb();
    const base = createDefaultPcbBoardSettings(TS) as unknown as Record<
      string,
      unknown
    >;
    seedRaw(db, "d1", {
      ...base,
      // `name` is not a string, so `parseNetClass` rejects the whole row.
      netClasses: [...rows(base.netClasses), { id: "future", name: 123 }],
      perNetClassAssignments: { net7: "future", net8: "power" },
    });

    updatePcbActiveLayer({ db, designId: "d1", layer: "B.Cu", timestamp: TS2 });

    const raw = readRaw(db, "d1");
    expect(rows(raw.netClasses).map((c) => c.id)).toContain("future");
    expect(asRec(raw.perNetClassAssignments).net7).toBe("future");
    // An assignment to a class this build CAN read follows `next` as before.
    expect(asRec(raw.perNetClassAssignments).net8).toBe("power");
    // …and the invisible entry never reaches the typed projection.
    expect(
      ensurePcbBoardSettings(db, "d1", TS2).perNetClassAssignments?.net7,
    ).toBeUndefined();
  });
});

// ───────────────────────── viewState carry-over ─────────────────────────

describe("unknown viewState keys survive a typed write", () => {
  function seedViewState(db: PcbDb): void {
    const base = createDefaultPcbBoardSettings(TS) as unknown as Record<
      string,
      unknown
    >;
    seedRaw(db, "d1", {
      ...base,
      viewState: {
        ...asRec(base.viewState),
        futureViewKey: 7,
        autoLayoutConfig: {
          preset: "balanced",
          effort: "balanced",
          futureConfigKey: "cfg",
          place: {
            allowRotate: true,
            allowFlip: true,
            moveConnectors: false,
            respectExistingTraces: true,
            targetUtilization: 0.7,
            futurePlaceKey: "p",
          },
          route: {
            geometryMode: "manhattan-45",
            allowVias: true,
            futureRouteKey: "r",
          },
        },
      },
    });
  }

  test("updatePcbActiveLayer carries them", () => {
    const db = makeDb();
    seedViewState(db);
    updatePcbActiveLayer({ db, designId: "d1", layer: "B.Cu", timestamp: TS2 });
    const viewState = asRec(readRaw(db, "d1").viewState);
    expect(viewState.futureViewKey).toBe(7);
    const config = asRec(viewState.autoLayoutConfig);
    expect(config.futureConfigKey).toBe("cfg");
    expect(asRec(config.place).futurePlaceKey).toBe("p");
    expect(asRec(config.route).futureRouteKey).toBe("r");
  });

  test("updatePcbViewState carries them while applying the patch", () => {
    const db = makeDb();
    seedViewState(db);
    updatePcbViewState({
      db,
      designId: "d1",
      patch: { viewSide: "bottom" },
      timestamp: TS2,
    });
    const viewState = asRec(readRaw(db, "d1").viewState);
    expect(viewState.viewSide).toBe("bottom");
    expect(viewState.futureViewKey).toBe(7);
    expect(asRec(asRec(viewState.autoLayoutConfig).place).futurePlaceKey).toBe(
      "p",
    );
    // …and none of it reaches the typed projection.
    const typed = ensurePcbBoardSettings(db, "d1", TS2).viewState as unknown as
      | Record<string, unknown>
      | undefined;
    expect(typed?.futureViewKey).toBeUndefined();
  });

  test("the legacy fill keys are NOT resurrected by the viewState carry-over", () => {
    const db = makeDb();
    const base = createDefaultPcbBoardSettings(TS) as unknown as Record<
      string,
      unknown
    >;
    seedRaw(db, "d1", {
      ...base,
      viewState: { ...asRec(base.viewState), copperFillLayers: ["F.Cu"] },
    });
    migrateLegacyBoardFill(db, "d1", NO_NETS, TS2);
    updatePcbActiveLayer({ db, designId: "d1", layer: "B.Cu", timestamp: TS2 });
    expect(asRec(readRaw(db, "d1").viewState).copperFillLayers).toBeUndefined();
  });
});

// ───────────────────────── a `__proto__` key ─────────────────────────

describe("a stored key literally named __proto__", () => {
  test("is carried as an own data property and pollutes nothing", () => {
    const db = makeDb();
    const base = createDefaultPcbBoardSettings(TS) as unknown as Record<
      string,
      unknown
    >;
    // Only a hand-written JSON string can carry an OWN `__proto__`; an object
    // literal would set the prototype instead.
    const json = JSON.stringify(base).replace(
      /^\{/,
      `{"__proto__":{"polluted":true},`,
    );
    seedRawJson(db, "d1", json);

    updatePcbActiveLayer({ db, designId: "d1", layer: "B.Cu", timestamp: TS2 });

    const raw = readRaw(db, "d1");
    expect(Object.prototype.hasOwnProperty.call(raw, "__proto__")).toBe(true);
    expect(Object.keys(raw)).toContain("__proto__");
    expect(asRec(Object.getOwnPropertyDescriptor(raw, "__proto__")?.value)).toEqual({
      polluted: true,
    });
    expect((({} as Record<string, unknown>).polluted)).toBeUndefined();
    expect(Object.getPrototypeOf(raw)).toBe(Object.prototype);
  });
});
