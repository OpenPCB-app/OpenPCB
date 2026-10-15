// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type {
  KicadProjectCommitResult,
  KicadProjectInspectReport,
} from "../../../../../sdks/designer";
import { KicadProjectImportWizard } from "./KicadProjectImportWizard";
import { MANUFACTURING_BLOCKED_COPY } from "./DoneStage";
import { PICK_FOOTNOTE } from "./PickStage";

const J1_REASON =
  'Footprint "USB_C_Receptacle" has non-plated or slotted holes this version can\'t represent yet.';

const report: KicadProjectInspectReport = {
  projectName: "usb2uart",
  copperLayerCount: 2,
  schematicSheetCount: 1,
  netCount: 36,
  boardOutlineMm: { minXMm: 0, minYMm: 0, maxXMm: 40, maxYMm: 30 },
  components: [
    { libId: "Device:R", references: ["R1", "R2"], status: "reuse", componentId: "c1" },
    {
      libId: "Connector:USB_C_Receptacle",
      references: ["J1"],
      status: "missing",
      componentId: null,
      reason: "Component not found in OpenPCB library; will be deferred until library ingestion is wired.",
    },
  ],
  counts: {
    schematicSymbols: 3,
    schematicWires: 4,
    schematicLabels: 0,
    schematicGlobalLabels: 0,
    schematicPowerSymbols: 0,
    schematicJunctions: 0,
    schematicNoConnects: 0,
    hierarchicalSheets: 0,
    pcbFootprints: 3,
    pcbSegments: 10,
    pcbVias: 2,
    pcbZones: 1,
    pcbKeepouts: 0,
  },
  netClasses: [],
  warnings: [
    {
      code: "kicad_custom_rules_ignored",
      severity: "warning",
      message: "'usb2uart.kicad_dru' custom design rules (.kicad_dru) are not imported.",
    },
  ],
};

const commitResult: KicadProjectCommitResult = {
  designId: "design-42",
  designName: "usb2uart",
  applied: {
    boardOutline: true,
    copperLayerCount: 2,
    netClassesIngested: 1,
    deferred: [],
  },
  warnings: [
    {
      code: "component_unresolved",
      severity: "warning",
      message: `J1: Ingestion failed for Connector:USB_C_Receptacle / Connector_USB:USB_C_Receptacle: ${J1_REASON}`,
    },
    {
      code: "arc_tessellated",
      severity: "info",
      message: "Tessellated 4 arc-track chord segment(s) into straight Manhattan-45 polylines.",
    },
  ],
};

let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

function json(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubEnv("VITE_FEATURE_DESIGNER_OUTPUTQUARANTINE", "0");
  fetchMock = vi.fn(async (url: string) =>
    url.endsWith("/imports/kicad-project/inspect")
      ? json({ report })
      : json({ result: commitResult }),
  );
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function render(props: {
  onImported?: (r: KicadProjectCommitResult) => void;
  onOpenDesign?: (id: string) => void;
  onClose?: () => void;
} = {}): Promise<void> {
  await act(async () =>
    root.render(
      <KicadProjectImportWizard
        backendURL="http://127.0.0.1:0"
        moduleId="designer"
        onClose={props.onClose ?? (() => undefined)}
        onImported={props.onImported ?? (() => undefined)}
        onOpenDesign={props.onOpenDesign ?? (() => undefined)}
      />,
    ),
  );
  await flush();
}

function dialog(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!el) throw new Error("dialog not rendered");
  return el;
}

function button(name: string): HTMLButtonElement {
  const match = [...dialog().querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === name,
  );
  if (!match) throw new Error(`button "${name}" not found`);
  return match;
}

async function pickFile(): Promise<void> {
  const input = dialog().querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File(["zip"], "usb2uart.zip", { type: "application/zip" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => el.click());
  await flush();
}

/** Text outside every `<details>`, i.e. what a user sees without expanding. */
function visibleText(): string {
  const clone = dialog().cloneNode(true) as HTMLElement;
  clone.querySelectorAll("details").forEach((d) => d.remove());
  return clone.textContent ?? "";
}

function assertNoOffSystemClasses(): void {
  const classes = [...dialog().querySelectorAll<HTMLElement>("[class]")]
    .map((el) => el.getAttribute("class") ?? "")
    .join(" ");
  expect(classes).not.toMatch(/\b(?:bg|text|border)-(?:slate|violet|amber|emerald)-\d/);
}

test("focuses Choose ZIP when the dialog opens and shows the import copy", async () => {
  await render();
  expect(document.activeElement?.textContent).toContain("Choose ZIP");
  expect(dialog().getAttribute("aria-labelledby")).toBeTruthy();
  expect(dialog().textContent).toContain("Import KiCad project");
  expect(dialog().textContent).toContain(PICK_FOOTNOTE);
  expect(dialog().textContent).not.toContain("v1 imports");
  assertNoOffSystemClasses();
});

test("review binds the design name label and shows human warnings", async () => {
  await render();
  await pickFile();
  const label = [...dialog().querySelectorAll("label")].find(
    (l) => l.textContent === "Design name",
  )!;
  const input = dialog().querySelector<HTMLInputElement>(`#${CSS.escape(label.htmlFor)}`);
  expect(label.htmlFor).not.toBe("");
  expect(input?.value).toBe("usb2uart");
  const text = visibleText();
  expect(text).toContain("In library");
  expect(text).toContain("New — added to library");
  expect(text).not.toContain("deferred until library ingestion");
  expect(text).toContain("Custom design rules (.kicad_dru) were not imported.");
  expect(text).not.toContain("kicad_custom_rules_ignored");
  expect(dialog().querySelector("details")?.textContent).toContain(
    "kicad_custom_rules_ignored",
  );
  assertNoOffSystemClasses();
});

test("Done stays open, onImported only reports, Open design opens the design", async () => {
  const onImported = vi.fn();
  const onOpenDesign = vi.fn();
  const onClose = vi.fn();
  await render({ onImported, onOpenDesign, onClose });
  await pickFile();
  await click(button("Import design"));

  expect(onImported).toHaveBeenCalledTimes(1);
  expect(onImported).toHaveBeenCalledWith(commitResult);
  expect(onOpenDesign).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(dialog().textContent).toContain("Import finished");

  await click(button("Open design"));
  expect(onOpenDesign).toHaveBeenCalledWith("design-42");
  await click(button("Close"));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("Done shows the J1 rejection and blockers in plain language, codes hidden", async () => {
  await render();
  await pickFile();
  await click(button("Import design"));
  const text = visibleText();
  expect(text).toContain(`J1 can't be imported — ${J1_REASON}`);
  expect(text).not.toContain("Ingestion failed for");
  expect(text).toContain("Curved tracks were converted to straight segments.");
  expect(text).toContain(MANUFACTURING_BLOCKED_COPY);
  expect(text).not.toContain("component_unresolved");
  expect(text).not.toContain("arc_tessellated");
  const details = [...dialog().querySelectorAll("details")].map((d) => d.textContent).join(" ");
  expect(details).toContain("component_unresolved");
  expect(details).toContain("arc_tessellated");
  assertNoOffSystemClasses();
});

test("a failed commit never looks like success", async () => {
  fetchMock.mockImplementation(async (url: string) =>
    url.endsWith("/imports/kicad-project/inspect")
      ? json({ report })
      : new Response(
          JSON.stringify({ title: "Bad project", status: 422, detail: "Sheet cycle detected." }),
          { status: 422, headers: { "content-type": "application/problem+json" } },
        ),
  );
  const onImported = vi.fn();
  await render({ onImported });
  await pickFile();
  await click(button("Import design"));
  expect(onImported).not.toHaveBeenCalled();
  expect(dialog().textContent).toContain("Import failed");
  expect(dialog().textContent).toContain("Sheet cycle detected.");
  expect(dialog().textContent).not.toContain("Import finished");
  await click(button("Back to review"));
  expect(button("Import design")).toBeDefined();
});

test("designer.outputQuarantine on: inspection only, commit disabled", async () => {
  vi.stubEnv("VITE_FEATURE_DESIGNER_OUTPUTQUARANTINE", "1");
  await render();
  await pickFile();
  expect(button("Import design").disabled).toBe(true);
  expect(
    fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/imports/kicad-project")),
  ).toEqual([]);
});
