import type {
  DesignerPcbProjection,
  PcbBoardOutline,
} from "../../../../../sdks/designer/types";
import { flattenOutline } from "../../../../../shared/rendering/pcb/outline-geometry";

/**
 * One entry in the Gerber Job File's `FilesAttributes` array — a manufacturing
 * file plus its FileFunction / FilePolarity, mirroring the file's own X2 header.
 */
export interface GerberJobFileAttr {
  Path: string;
  FileFunction: string;
  FilePolarity: "Positive" | "Negative";
}

const SOFTWARE = {
  Vendor: "OpenPCB",
  Application: "OpenPCB Manufacturing Export",
  Version: "0.1",
} as const;

// Default 2-layer FR4 finished thickness; no per-design thickness field yet.
const DEFAULT_BOARD_THICKNESS_MM = 1.6;

/**
 * Build the Ucamco Gerber Job File (`.gbrjob`) — a JSON sidecar describing the
 * layer set, board size/stackup, and every file's FileFunction/FilePolarity.
 * Fabs (Eurocircuits explicitly) use it to validate stackup completeness and to
 * detect truncated uploads. Pure/deterministic: same design + date → same bytes.
 */
export function buildGerberJobFile(params: {
  pcb: DesignerPcbProjection;
  files: readonly GerberJobFileAttr[];
  createdAt: string;
}): string {
  const { pcb, files, createdAt } = params;
  const size = outlineSizeMm(pcb.board.outline);
  const job = {
    Header: { GenerationSoftware: SOFTWARE, CreationDate: createdAt },
    GeneralSpecs: {
      ProjectId: {
        Name: pcb.designId,
        GUID: deterministicGuid(pcb.designId),
        Revision: String(pcb.revision),
      },
      Size: { X: round3(size.x), Y: round3(size.y) },
      LayerNumber: pcb.board.layerCount,
      BoardThickness: DEFAULT_BOARD_THICKNESS_MM,
    },
    FilesAttributes: files.map((file) => ({ ...file })),
  };
  return JSON.stringify(job, null, 1) + "\n";
}

function outlineSizeMm(outline: PcbBoardOutline | null): {
  x: number;
  y: number;
} {
  if (!outline) return { x: 0, y: 0 };
  const pts = flattenOutline(outline);
  if (pts.length === 0) return { x: 0, y: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: maxX - minX, y: maxY - minY };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Stable RFC-4122-shaped id derived from the design id (FNV-1a, no randomness)
 * so the same design always emits the same ProjectId GUID — keeps bundles
 * reproducible without a persisted project GUID.
 */
function deterministicGuid(seed: string): string {
  const words: number[] = [];
  let h = 0x811c9dc5;
  for (let w = 0; w < 4; w++) {
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i) + w * 0x01000193;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    words.push(h >>> 0);
  }
  const hex = words.map((x) => x.toString(16).padStart(8, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
