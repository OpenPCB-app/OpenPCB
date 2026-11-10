/**
 * H19 / OPENPCB-67 S5 — the DRC provenance stamp (§3.5).
 *
 * A stored DRC result is only evidence for a manufacturing export when it can
 * be bound to the design it was computed over. This file pins the binding:
 * the migration that adds the stamp column, the stamp a real run writes (its
 * digests are those of what the WORKER received), the self-check that turns a
 * row last written by a binary that does not stamp into "no provenance", the
 * evidence counts the export gate reads, the run join key, the locale-free
 * content digest and the engine-table snapshot that forces a version bump.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { copyFile, mkdtemp, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type {
  DesignerCommandEnvelope,
  DesignerPcbProjection,
  DesignerSDK,
  DrcReport,
  DrcViolation,
} from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import type { LibrarySDK } from "../../../sdks/library";
import type { CoreBackendModuleContext } from "../../contracts/modules/backend-module";
import {
  getSharedDb,
  getSharedSqlite,
  resetSharedSqliteForTesting,
} from "../db/sqlite-client";
import { applyModuleMigrations } from "../migrations/module-migrator";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import { runDrc } from "../../../shared/drc/drc-engine";
import {
  DRC_ENGINE_VERSION,
  drcEngineVersion,
} from "../../../shared/drc/engine-version";
import {
  DEFAULT_SEVERITY_BY_CODE,
  NON_OVERRIDABLE,
  RULE_CLASS_BY_CODE,
} from "../../../shared/drc/severity";
import {
  disposeDrcWorker,
  setDrcWorkerEntry,
  setDrcWorkerFactoryForTesting,
  type DrcWorkerLike,
} from "../../../shared/drc/worker/drc-worker-client";
import type {
  DrcWorkerRequest,
  DrcWorkerResponse,
} from "../../../shared/drc/worker/protocol";
import {
  getDrcGateEvidence,
  saveDrcResult,
  type DrcResultProvenance,
} from "../../../modules/designer/backend/drc-results";
import {
  computeDrcOptionsDigest,
  drcSeveritySettings,
} from "../../../modules/designer/backend/drc/run-digest";
import { drcOptionsFromProjection } from "../../../modules/designer/backend/drc/drc-engine";
import {
  resolveDrcRunService,
  type DrcRunService,
} from "../../../modules/designer/backend/drc/run-service";
import { computeBoardContentDigest } from "../../../modules/designer/backend/pcb/board-content-digest";
import {
  buildRawFootprintEntries,
  digestRawFootprintEntries,
} from "../../../modules/designer/backend/pcb/raw-footprint-lookup";
import { createDefaultPcbBoardSettings } from "../../../modules/designer/backend/pcb/pcb-defaults";
import { createDesignerStore } from "../../../modules/designer/backend/store";

const MIGRATIONS_DIR = path.resolve(
  import.meta.dir,
  "../../../modules/designer/backend/migrations",
);
const PROVENANCE_MIGRATION = "0023_drc_result_provenance.sql";
const ENGINE_TABLES_FIXTURE = path.join(
  import.meta.dir,
  "fixtures/drc/engine-tables.json",
);
const TS = "2026-10-15T10:00:00.000Z";
const SESSION = "drc-provenance";

function freshDbPath(label: string): void {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
}

function insertHead(id: string, revision: number): void {
  getSharedSqlite()
    .query(
      "insert into designer_design_heads (id, name, revision, created_at, updated_at) values (?, 'D', ?, ?, ?)",
    )
    .run(id, revision, TS, TS);
}

function violation(
  id: string,
  code: DrcViolation["code"],
  waived = false,
): DrcViolation {
  return {
    id,
    code,
    ruleClass: RULE_CLASS_BY_CODE[code],
    severity: DEFAULT_SEVERITY_BY_CODE[code],
    message: id,
    anchors: [{ kind: "boardEdge" }],
    ...(waived ? { waived: true } : {}),
  };
}

function report(
  designId: string,
  revision: number,
  violations: DrcViolation[],
): DrcReport {
  const active = violations.filter((v) => !v.waived);
  const count = (s: DrcViolation["severity"]) =>
    active.filter((v) => v.severity === s).length;
  return {
    designId,
    revision,
    violations,
    summary: { errors: count("error"), warnings: count("warning"), infos: count("info") },
    countsByCode: {},
  };
}

const STAMP: Omit<DrcResultProvenance, "v" | "ranAt" | "ranAtRevision"> = {
  contentDigest: "c".repeat(64),
  optionsDigest: "o".repeat(40),
  engineVersion: "1+dev",
  rawFootprintDigest: "r".repeat(64),
};

// ── migration ──────────────────────────────────────────────────────────────

describe("0023 adds the provenance column", () => {
  test("a legacy row survives the migration and reads back WITHOUT provenance", async () => {
    freshDbPath("drc-provenance-migration");
    const dir = await mkdtemp(path.join(os.tmpdir(), "designer-migrations-"));
    const earlier = (await readdir(MIGRATIONS_DIR)).filter(
      (name) => name.endsWith(".sql") && name < PROVENANCE_MIGRATION,
    );
    for (const name of earlier) {
      await copyFile(path.join(MIGRATIONS_DIR, name), path.join(dir, name));
    }
    expect((await applyModuleMigrations("designer", dir)).failed).toBeNull();

    insertHead("d1", 4);
    // Exactly the row a pre-H19 binary writes: no stamp column exists yet.
    getSharedSqlite()
      .query(
        `insert into designer_drc_results (design_id, ran_at_revision, ran_at, error_count,
           warning_count, info_count, violations_json, options_json, created_at, updated_at)
         values ('d1', 4, ?, 0, 0, 0, '[]', '{"ignoredRuleClasses":[],"waivedIds":[]}', ?, ?)`,
      )
      .run(TS, TS, TS);

    await copyFile(
      path.join(MIGRATIONS_DIR, PROVENANCE_MIGRATION),
      path.join(dir, PROVENANCE_MIGRATION),
    );
    const applied = await applyModuleMigrations("designer", dir);
    expect(applied.failed).toBeNull();
    expect(applied.applied).toEqual([PROVENANCE_MIGRATION]);

    const raw = getSharedSqlite()
      .query<{ provenance_json: string | null }, []>(
        "select provenance_json from designer_drc_results where design_id = 'd1'",
      )
      .get();
    expect(raw).toEqual({ provenance_json: null });

    // A clean legacy result is still NOT evidence for export: the gate maps
    // `provenance: null` to STALE `legacy-result` (S6b, §3.5 step 3).
    const evidence = getDrcGateEvidence(getSharedDb(), "d1");
    expect(evidence).not.toBeNull();
    expect(evidence!.provenance).toBeNull();
    expect(evidence!.ranAtRevision).toBe(4);
    expect(evidence!.errors).toBe(0);
  });
});

// ── the stamp and its self-check ───────────────────────────────────────────

async function migratedDb(label: string): Promise<void> {
  freshDbPath(label);
  expect((await applyModuleMigrations("designer", MIGRATIONS_DIR)).failed).toBeNull();
}

describe("saveDrcResult / getDrcGateEvidence", () => {
  test("a stamped save reads back the stamp with the row's own ranAt and revision", async () => {
    await migratedDb("drc-provenance-stamp");
    insertHead("d1", 7);
    saveDrcResult(
      getSharedDb(),
      "d1",
      report("d1", 7, []),
      { ignoredRuleClasses: [], waivedIds: [] },
      TS,
      STAMP,
    );
    const evidence = getDrcGateEvidence(getSharedDb(), "d1")!;
    expect(evidence.provenance).toEqual({
      v: 1,
      ranAt: TS,
      ranAtRevision: 7,
      ...STAMP,
    });
    expect(evidence.engineVersion).toBe("1+dev");
    expect(evidence.ranAt).toBe(TS);
  });

  test("evidence counts waived, unchecked, ignored classes, overrides and rule severities", async () => {
    await migratedDb("drc-provenance-counts");
    insertHead("d1", 3);
    const violations = [
      violation("v-err", "TRACE_TO_TRACE_CLEARANCE"),
      violation("v-err-waived", "TRACE_WIDTH_MIN", true),
      violation("v-warn", "HOLE_TO_HOLE"),
      violation("v-unchecked", "COPPER_SHAPE_UNCHECKED"),
      violation("v-unchecked-2", "OUTLINE_WEB_UNCHECKED"),
      // A waived "did not answer" is a user decision, not an incomplete run.
      violation("v-unchecked-waived", "OUTLINE_WEB_UNCHECKED", true),
    ];
    const settings = {
      severityOverrides: [
        { code: "FAB_DRILL" as const, severity: "ignore" as const, defaultSeverity: "warning" as const },
      ],
      ruleSeverities: [{ ruleId: "r1", severity: "warning" as const }],
    };
    saveDrcResult(
      getSharedDb(),
      "d1",
      report("d1", 3, violations),
      {
        ignoredRuleClasses: ["dfm", "signal-integrity"],
        waivedIds: ["v-err-waived", "v-unchecked-waived"],
        ...settings,
      },
      TS,
      STAMP,
    );
    const evidence = getDrcGateEvidence(getSharedDb(), "d1")!;
    expect(evidence.errors).toBe(1);
    expect(evidence.warnings).toBe(1);
    expect(evidence.infos).toBe(2);
    expect(evidence.waived).toBe(2);
    expect(evidence.unchecked).toBe(2);
    expect(evidence.ignoredRuleClasses).toEqual(["dfm", "signal-integrity"]);
    expect(evidence.severityOverrides).toEqual(settings.severityOverrides);
    expect(evidence.ruleSeverities).toEqual(settings.ruleSeverities);
  });

  test("a row an older binary rewrote (counts + ran_at, stamp untouched) has NO provenance", async () => {
    await migratedDb("drc-provenance-old-binary");
    insertHead("d1", 5);
    saveDrcResult(
      getSharedDb(),
      "d1",
      report("d1", 5, []),
      { ignoredRuleClasses: [], waivedIds: [] },
      TS,
      STAMP,
    );
    expect(getDrcGateEvidence(getSharedDb(), "d1")!.provenance).not.toBeNull();

    // The pre-H19 upsert: `.set(next)` over the columns it knows.
    const later = "2026-10-15T11:00:00.000Z";
    getSharedSqlite()
      .query(
        `update designer_drc_results set ran_at_revision = 6, ran_at = ?, error_count = 2,
           violations_json = '[]', updated_at = ? where design_id = 'd1'`,
      )
      .run(later, later);
    const evidence = getDrcGateEvidence(getSharedDb(), "d1")!;
    expect(evidence.provenance).toBeNull();
    expect(evidence.errors).toBe(2);

    // Same revision, new run time (an old binary re-ran DRC on the same head).
    getSharedSqlite()
      .query(
        "update designer_drc_results set ran_at_revision = 5, ran_at = ? where design_id = 'd1'",
      )
      .run(later);
    expect(getDrcGateEvidence(getSharedDb(), "d1")!.provenance).toBeNull();
  });

  test("an unstamped save by THIS binary clears an earlier stamp", async () => {
    await migratedDb("drc-provenance-clear");
    insertHead("d1", 2);
    const db = getSharedDb();
    saveDrcResult(db, "d1", report("d1", 2, []), { ignoredRuleClasses: [], waivedIds: [] }, TS, STAMP);
    // Same ran_at and revision: only an explicit null write can clear it.
    saveDrcResult(db, "d1", report("d1", 2, []), { ignoredRuleClasses: [], waivedIds: [] }, TS);
    const raw = getSharedSqlite()
      .query<{ provenance_json: string | null }, []>(
        "select provenance_json from designer_drc_results where design_id = 'd1'",
      )
      .get();
    expect(raw).toEqual({ provenance_json: null });
    expect(getDrcGateEvidence(db, "d1")!.provenance).toBeNull();
  });

  test("corrupt or foreign persisted JSON never yields evidence with a stamp", async () => {
    await migratedDb("drc-provenance-corrupt");
    insertHead("d1", 1);
    const db = getSharedDb();
    const sqlite = getSharedSqlite();
    const reset = () =>
      saveDrcResult(db, "d1", report("d1", 1, []), { ignoredRuleClasses: [], waivedIds: [] }, TS, STAMP);
    const set = (column: string, value: string) =>
      sqlite
        .query(`update designer_drc_results set ${column} = ? where design_id = 'd1'`)
        .run(value);

    reset();
    set("violations_json", "{ not json");
    expect(getDrcGateEvidence(db, "d1")).toBeNull();

    reset();
    set("options_json", "{ not json");
    expect(getDrcGateEvidence(db, "d1")).toBeNull();

    reset();
    set("provenance_json", "{ not json");
    expect(getDrcGateEvidence(db, "d1")!.provenance).toBeNull();

    for (const forged of [
      { v: 2, ranAt: TS, ranAtRevision: 1, ...STAMP },
      { v: 1, ranAt: TS, ranAtRevision: 1, ...STAMP, contentDigest: 7 },
      { v: 1, ranAt: TS, ranAtRevision: "1", ...STAMP },
      { v: 1, ranAt: TS, ranAtRevision: 1, contentDigest: STAMP.contentDigest },
      [],
      null,
    ]) {
      reset();
      set("provenance_json", JSON.stringify(forged));
      expect(getDrcGateEvidence(db, "d1")!.provenance).toBeNull();
    }
    expect(getDrcGateEvidence(db, "missing")).toBeNull();
  });
});

// ── digests ────────────────────────────────────────────────────────────────

function projection(
  overrides: Partial<DesignerPcbProjection> = {},
): DesignerPcbProjection {
  return {
    designId: "d",
    revision: 1,
    board: createDefaultPcbBoardSettings(TS),
    placements: [],
    traces: [],
    vias: [],
    ratsnest: [],
    netNames: {},
    padNets: {},
    ...overrides,
  } as DesignerPcbProjection;
}

describe("digests", () => {
  test("computeDrcOptionsDigest is byte-identical to the pre-H19 join-key digest", () => {
    const p = projection();
    p.board = {
      ...p.board,
      viewState: {
        ...p.board.viewState!,
        drcIgnoredRuleClasses: ["dfm"],
        drcWaivedViolationIds: ["w1"],
      },
      drcSeverityOverrides: { FAB_DRILL: "ignore" },
    };
    // The algorithm `run-service.ts` carried privately before S5.
    const legacy = createHash("sha1")
      .update(
        JSON.stringify({
          ...drcOptionsFromProjection(p),
          severityOverrides: p.board.drcSeverityOverrides ?? null,
        }),
      )
      .digest("hex");
    expect(computeDrcOptionsDigest(p)).toBe(legacy);
  });

  test("drcSeveritySettings lists overrides and explicit rule severities in code-unit order", () => {
    const p = projection();
    p.board = {
      ...p.board,
      drcSeverityOverrides: {
        TRACE_WIDTH_MIN: "warning",
        FAB_DRILL: "ignore",
        // A persisted code the table no longer knows suppresses nothing.
        ["toString" as "FAB_PAD"]: "ignore",
      },
      drcRules: [
        { id: "b", name: "B", enabled: true, priority: 1, scopes: [], constraint: { kind: "clearance", mm: 0.2 }, severity: "info" },
        { id: "a", name: "A", enabled: true, priority: 2, scopes: [], constraint: { kind: "clearance", mm: 0.3 } },
        { id: "B", name: "B2", enabled: false, priority: 3, scopes: [], constraint: { kind: "clearance", mm: 0.3 }, severity: "error" },
      ],
    };
    expect(drcSeveritySettings(p)).toEqual({
      severityOverrides: [
        { code: "FAB_DRILL", severity: "ignore", defaultSeverity: "warning" },
        { code: "TRACE_WIDTH_MIN", severity: "warning", defaultSeverity: "error" },
      ],
      ruleSeverities: [
        { ruleId: "B", severity: "error" },
        { ruleId: "b", severity: "info" },
      ],
    });
  });

  test("the raw-footprint digest is order-free, distinguishes 'no lookup', and follows library rows", async () => {
    const a: [string, Record<string, unknown>] = ["fp-a", { pads: [1], name: "A" }];
    const b: [string, Record<string, unknown>] = ["fp-B", { name: "B", pads: [] }];
    expect(digestRawFootprintEntries([a, b])).toBe(digestRawFootprintEntries([b, a]));
    // Key order inside a row is not content.
    expect(digestRawFootprintEntries([["fp-a", { name: "A", pads: [1] }], b])).toBe(
      digestRawFootprintEntries([a, b]),
    );
    expect(digestRawFootprintEntries(null)).not.toBe(digestRawFootprintEntries([]));
    expect(digestRawFootprintEntries(null)).toBe(
      createHash("sha256").update("none").digest("hex"),
    );

    // A library row edited after DRC: the same placements now read different
    // data, so the digest the export recomputes no longer matches the stamp.
    const rows = new Map<string, Record<string, unknown>>([
      ["fp-a", { courtyard: [[0, 0], [1, 0], [1, 1]] }],
    ]);
    const library = {
      getFootprint: async (id: string) => {
        const data = rows.get(id);
        return data ? { data } : null;
      },
    } as unknown as LibrarySDK;
    const ctx = {
      sdk: { get: (token: string) => (token === MODULE_SDK_TOKENS.LIBRARY ? library : null) },
    } as unknown as CoreBackendModuleContext;
    const placed = projection({
      placements: [
        { id: "U1", footprint: { footprintId: "fp-a", sourceHash: "h1", preview: null } },
      ] as never,
    });
    const before = digestRawFootprintEntries(await buildRawFootprintEntries(ctx, placed));
    rows.set("fp-a", { courtyard: [[0, 0], [2, 0], [2, 2]] });
    const after = digestRawFootprintEntries(await buildRawFootprintEntries(ctx, placed));
    expect(after).not.toBe(before);
  });

  test("the board content digest does not depend on the locale's collation", () => {
    // Ids whose localeCompare order ("_x" < "a" < "B" under ICU) differs from
    // code-unit order ("B" < "_x" < "a").
    const ids = ["a", "B", "_x"];
    const placements = ids.map((id) => ({
      id,
      partId: id,
      componentId: "c",
      reference: id,
      positionMm: { x: 1, y: 2 },
      rotationDeg: 0,
      mirrored: false,
      layer: "F.Cu",
      footprint: null,
    }));
    const p = projection({ placements: placements as never });
    const baseline = computeBoardContentDigest(p);
    const original = String.prototype.localeCompare;
    try {
      // A host whose collation reverses everything must not move the digest.
      String.prototype.localeCompare = function (this: string, that: string) {
        return -original.call(this, that);
      } as typeof original;
      expect(computeBoardContentDigest(p)).toBe(baseline);
    } finally {
      String.prototype.localeCompare = original;
    }
  });
});

// ── the engine-table snapshot ──────────────────────────────────────────────

describe("DRC engine version", () => {
  test("the severity / class / non-overridable tables match the committed snapshot", async () => {
    const actual = {
      engineVersion: DRC_ENGINE_VERSION,
      defaultSeverityByCode: Object.fromEntries(
        Object.entries(DEFAULT_SEVERITY_BY_CODE).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      ),
      ruleClassByCode: Object.fromEntries(
        Object.entries(RULE_CLASS_BY_CODE).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      ),
      nonOverridable: [...NON_OVERRIDABLE].sort(),
    };
    const expected: unknown = await Bun.file(ENGINE_TABLES_FIXTURE).json();
    // On failure: a table changed. Bump DRC_ENGINE_VERSION in
    // src/shared/drc/engine-version.ts (old DRC evidence must not certify an
    // export under new rules) and update fixtures/drc/engine-tables.json.
    expect(actual).toEqual(expected as typeof actual);
    expect(drcEngineVersion("0.4.2")).toBe(`${DRC_ENGINE_VERSION}+0.4.2`);
  });
});

// ── the run service writes the stamp ───────────────────────────────────────

interface FakeWorkerEvents {
  message: DrcWorkerResponse;
  error: Error;
  exit: number;
}

/** A worker that answers only when the test says so (see drc-run-service.test.ts). */
class HeldWorker implements DrcWorkerLike {
  readonly received: DrcWorkerRequest[] = [];

  private readonly listeners: {
    [K in keyof FakeWorkerEvents]: Array<(payload: FakeWorkerEvents[K]) => void>;
  } = { message: [], error: [], exit: [] };

  constructor() {
    setTimeout(() => this.emit("message", { type: "ready" }), 0);
  }

  postMessage(message: DrcWorkerRequest): void {
    this.received.push(message);
  }

  on<K extends keyof FakeWorkerEvents>(
    event: K,
    listener: (payload: FakeWorkerEvents[K]) => void,
  ): void {
    this.listeners[event].push(listener);
  }

  off<K extends keyof FakeWorkerEvents>(
    event: K,
    listener: (payload: FakeWorkerEvents[K]) => void,
  ): void {
    const list = this.listeners[event];
    const index = list.indexOf(listener);
    if (index >= 0) list.splice(index, 1);
  }

  terminate(): Promise<number> {
    return Promise.resolve(0);
  }

  emit<K extends keyof FakeWorkerEvents>(
    event: K,
    payload: FakeWorkerEvents[K],
  ): void {
    for (const listener of [...this.listeners[event]]) listener(payload);
  }

  release(): DrcReport {
    const request = this.received.at(-1)!;
    const entries = request.rawFootprints;
    const byId = entries === null ? null : new Map(entries);
    const report = runDrc(request.projection, {
      lookupRawFootprint: byId === null ? undefined : (id) => byId.get(id) ?? null,
    });
    this.emit("message", { type: "done", runId: request.runId, report });
    return report;
  }

  cancelled(): void {
    this.emit("message", { type: "cancelled", runId: this.received.at(-1)!.runId });
  }
}

async function useHeldWorker(): Promise<HeldWorker[]> {
  await disposeDrcWorker();
  const workers: HeldWorker[] = [];
  setDrcWorkerFactoryForTesting(() => {
    const worker = new HeldWorker();
    workers.push(worker);
    return worker;
  });
  return workers;
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function createHarness(label: string): Promise<{
  sdk: DesignerSDK;
  service: DrcRunService;
  ctx: CoreBackendModuleContext;
}> {
  freshDbPath(label);
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry: new ModuleRouterRegistry(),
    workspaceRoot: path.resolve(import.meta.dir, "../../.."),
  });
  await moduleRuntime.bootstrap();
  const sdk = moduleRuntime
    .getSdkRegistry()
    .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
  const ctx = (
    moduleRuntime as unknown as {
      loaded: Map<string, { context: CoreBackendModuleContext }>;
    }
  ).loaded.get("designer")!.context;
  return { sdk, service: resolveDrcRunService(ctx, createDesignerStore(ctx)), ctx };
}

function envelope(
  designId: string,
  commandId: string,
  command: DesignerCommandEnvelope["command"],
): DesignerCommandEnvelope {
  return {
    commandId,
    sessionId: SESSION,
    aggregateId: designId,
    baseRevision: null,
    issuedAt: Date.now(),
    command,
  };
}

async function seedTraces(sdk: DesignerSDK, designId: string): Promise<void> {
  const projection = (await sdk.getPcbProjection(designId))!;
  const netClassId = projection.board.netClasses[0]!.id;
  for (let i = 0; i < 2; i += 1) {
    const y = i * 1_500_000;
    const result = await sdk.dispatchCommand(
      designId,
      envelope(designId, `seed-trace-${designId}-${i}`, {
        type: "pcb_add_trace",
        layer: "F.Cu",
        pointsNm: [
          { x: 0, y },
          { x: 4_000_000, y },
        ],
        widthMm: 0.2,
        netId: null,
        netClassId,
        segmentMode: "manhattan-90",
      }),
    );
    expect(result.ok).toBe(true);
  }
}

afterAll(async () => {
  setDrcWorkerFactoryForTesting(null);
  setDrcWorkerEntry(null);
  await disposeDrcWorker();
});

describe("DrcRunService stamps what the worker received", () => {
  test("the persisted stamp's digests are those of the worker's projection and footprints", async () => {
    const workers = await useHeldWorker();
    const savedAppVersion = process.env.OPENPCB_APP_VERSION;
    process.env.OPENPCB_APP_VERSION = "9.8.7-test";
    try {
      const { sdk, service, ctx } = await createHarness("drc-provenance-run");
      const design = await sdk.createDesign({ name: "stamp" });
      await seedTraces(sdk, design.id);
      const rules = await sdk.dispatchCommand(
        design.id,
        envelope(design.id, "rules", {
          type: "pcb_set_design_rules",
          drcSeverityOverrides: { HOLE_TO_HOLE: "ignore" },
        }),
      );
      expect(rules.ok).toBe(true);
      const view = await sdk.dispatchCommand(
        design.id,
        envelope(design.id, "ignore-dfm", {
          type: "pcb_set_view_state",
          patch: { drcIgnoredRuleClasses: ["dfm"] },
        }),
      );
      expect(view.ok).toBe(true);

      const run = await service.start(design.id);
      await waitFor(
        () => workers.length === 1 && workers[0]!.received.length === 1,
        "the run to reach the worker",
      );
      const sent = workers[0]!.received[0]!;
      workers[0]!.release();
      await waitFor(() => service.get(run.runId)!.status === "completed", "completion");

      const db = (ctx.db as unknown as { db: Parameters<typeof getDrcGateEvidence>[0] }).db;
      const evidence = getDrcGateEvidence(db, design.id)!;
      const row = ctx.db.rawSql<{ ran_at: string; ran_at_revision: number }>(
        "select ran_at, ran_at_revision from designer_drc_results where design_id = ?",
        [design.id],
      )[0]!;
      expect(evidence.provenance).toEqual({
        v: 1,
        ranAt: row.ran_at,
        ranAtRevision: sent.projection.revision,
        contentDigest: computeBoardContentDigest(sent.projection),
        optionsDigest: computeDrcOptionsDigest(sent.projection),
        engineVersion: drcEngineVersion("9.8.7-test"),
        rawFootprintDigest: digestRawFootprintEntries(sent.rawFootprints),
      });
      expect(row.ran_at_revision).toBe(sent.projection.revision);
      // The run records what it applied besides waivers, for the export evidence.
      expect(evidence.ignoredRuleClasses).toEqual(["dfm"]);
      expect(evidence.severityOverrides).toEqual([
        { code: "HOLE_TO_HOLE", severity: "ignore", defaultSeverity: "warning" },
      ]);
      expect(evidence.ruleSeverities).toEqual([]);
      // ...and the stamp matches the design as it is now.
      const now = (await sdk.getPcbProjection(design.id))!;
      expect(evidence.provenance!.contentDigest).toBe(computeBoardContentDigest(now));
      expect(evidence.provenance!.optionsDigest).toBe(computeDrcOptionsDigest(now));
    } finally {
      if (savedAppVersion === undefined) delete process.env.OPENPCB_APP_VERSION;
      else process.env.OPENPCB_APP_VERSION = savedAppVersion;
      setDrcWorkerFactoryForTesting(null);
      await disposeDrcWorker();
    }
  }, 20_000);

  test("same revision and options but different content is a NEW run, not a join", async () => {
    const workers = await useHeldWorker();
    try {
      const { sdk, service, ctx } = await createHarness("drc-provenance-join");
      const design = await sdk.createDesign({ name: "join" });
      await seedTraces(sdk, design.id);

      const first = await service.start(design.id);
      await waitFor(
        () => workers.length === 1 && workers[0]!.received.length === 1,
        "the first run to reach the worker",
      );

      // A non-revisioned write (what the lazy projection writes look like):
      // the content moves, the head revision does not.
      const before = (await sdk.getPcbProjection(design.id))!;
      const trace = ctx.db.rawSql<{ id: string; payload_json: string }>(
        "select id, payload_json from designer_pcb_entities where design_id = ? and kind = 'trace' order by id limit 1",
        [design.id],
      )[0]!;
      const payload = JSON.parse(trace.payload_json) as { widthMm: number };
      expect(payload.widthMm).toBe(0.2);
      ctx.db.rawSql("update designer_pcb_entities set payload_json = ? where id = ?", [
        JSON.stringify({ ...payload, widthMm: 0.25 }),
        trace.id,
      ]);
      const after = (await sdk.getPcbProjection(design.id))!;
      expect(after.revision).toBe(before.revision);
      expect(computeDrcOptionsDigest(after)).toBe(computeDrcOptionsDigest(before));
      expect(computeBoardContentDigest(after)).not.toBe(computeBoardContentDigest(before));

      const second = await service.start(design.id);
      expect(second.runId).not.toBe(first.runId);
      expect(service.get(first.runId)!.cancelReason).toBe("superseded");
      // A start over the unchanged content joins the new run.
      expect((await service.start(design.id)).runId).toBe(second.runId);

      workers[0]!.cancelled();
      await waitFor(
        () => workers[0]!.received.length === 2,
        "the superseding run to reach the worker",
      );
      workers[0]!.release();
      await waitFor(() => service.get(second.runId)!.status === "completed", "completion");
      const db = (ctx.db as unknown as { db: Parameters<typeof getDrcGateEvidence>[0] }).db;
      expect(getDrcGateEvidence(db, design.id)!.provenance!.contentDigest).toBe(
        computeBoardContentDigest(after),
      );
    } finally {
      setDrcWorkerFactoryForTesting(null);
      await disposeDrcWorker();
    }
  }, 20_000);
});
