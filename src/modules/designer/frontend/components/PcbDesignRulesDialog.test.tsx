// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PcbBoardSettings, PcbLengthMatchGroup } from "../../../../sdks";
import { PcbDesignRulesDialog } from "./PcbDesignRulesDialog";

const group: PcbLengthMatchGroup = {
  id: "length-group-1",
  name: "Clock pair",
  netIds: ["net-a", "net-b"],
  target: { kind: "absolute", mm: 42 },
  toleranceMm: 0.2,
};

const board: PcbBoardSettings = {
  outline: { kind: "rect", widthMm: 100, heightMm: 80, centerMm: { x: 0, y: 0 } },
  activeLayer: "F.Cu",
  visibleLayers: ["F.Cu", "B.Cu"],
  designRules: {
    clearance: {
      traceToTraceMm: 0.2,
      traceToPadMm: 0.25,
      padToPadMm: 0.25,
      traceToViaMm: 0.25,
      viaToViaMm: 0.3,
      copperToBoardEdgeMm: 0.5,
    },
    minimums: {
      traceWidthMm: 0.2,
      drillSizeMm: 0.4,
      annularRingMm: 0.2,
      viaDiameterMm: 0.8,
      viaDrillMm: 0.4,
    },
  },
  netClasses: [],
  lengthMatchGroups: [group],
  tracePresets: [0.25],
  fabricator: "custom",
  layerCount: 2,
  displayMode: "normal",
  solderMaskExpansionMm: 0.05,
  solderPasteExpansionMm: -0.05,
  updatedAt: "2026-10-22T00:00:00.000Z",
};

let host: HTMLDivElement;
let root: Root;
let onSave: ReturnType<typeof vi.fn>;
let onClose: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  onSave = vi.fn(async () => undefined);
  onClose = vi.fn();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

test("blank name blocks save; restoring name forwards full group unchanged", async () => {
  await act(async () =>
    root.render(
      <PcbDesignRulesDialog
        open
        board={board}
        onClose={onClose}
        onSave={onSave}
      />,
    ),
  );
  const nameInput = host.querySelector<HTMLInputElement>(
    'input[aria-label="Group name"]',
  );
  expect(nameInput).not.toBeNull();

  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
      ?.set?.call(nameInput, "");
    nameInput!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Save & re-run DRC"))
      ?.click();
  });

  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    "Length match group name cannot be blank.",
  );
  expect(onSave).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();

  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
      ?.set?.call(nameInput, group.name);
    nameInput!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Save & re-run DRC"))
      ?.click();
  });

  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave.mock.calls[0]?.[0].lengthMatchGroups).toEqual([group]);
  expect(onClose).toHaveBeenCalledTimes(1);
});
