// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  PARAMETRIC_TEMPLATES,
  defaultValues,
  getTemplate,
  hashParams,
  validateParams,
} from "../../../../shared/rendering/parametric";
import { generatorUnavailableReason } from "../../shared/generator-policy";
import {
  FootprintGeneratorPanel,
  templateToPayload,
  type GeneratedFootprintPayload,
} from "./FootprintGeneratorPanel";
import { FootprintStep } from "../import-wizard/steps/FootprintStep";
import {
  hasCurrentPreset,
  useImportWizardStore,
} from "../import-wizard/useImportWizardStore";

// Every IPC family is quarantined on the pinned rendering-core (H15 D1); the
// positive paths mark chosen families available, the rest keep the real policy.
const qualification = vi.hoisted(() => ({ available: new Set<string>() }));
vi.mock("../../shared/generator-qualification", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../shared/generator-qualification")>();
  const ipcFamilyAvailability: typeof actual.ipcFamilyAvailability = (
    family,
    ...rest
  ) =>
    qualification.available.has(family)
      ? { available: true, revision: 2 }
      : actual.ipcFamilyAvailability(family, ...rest);
  return { ...actual, ipcFamilyAvailability };
});
vi.mock("../../../../shared/frontend/canvas/preview", () => ({
  FootprintPreviewCanvas: () => null,
  SymbolPreviewCanvas: () => null,
}));
vi.mock("../import-wizard/footprint-editor", () => ({
  FootprintEditorCanvas: () => null,
  FootprintEditorToolbar: () => null,
  LayerPanel: () => null,
  PadPropertyPanel: () => null,
  useFootprintEditorStore: Object.assign(() => null, {
    getState: () => ({ reset: () => undefined }),
  }),
}));

const BACKEND = "http://test";
const TEMPLATE_LIST = PARAMETRIC_TEMPLATES.map((t) => ({
  id: t.id,
  label: t.label,
  description: t.description,
  generatorVersion: t.generatorVersion,
  schema: t.schema,
  defaults: defaultValues(t.schema),
}));

interface PendingMaterialize {
  params: Record<string, unknown>;
  resolve: () => void;
}
let pending: PendingMaterialize[] = [];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function materializedResponse(
  templateId: string,
  params: Record<string, unknown>,
): Response {
  const template = getTemplate(templateId)!;
  const validated = validateParams(template.schema, params);
  if (!validated.ok) throw new Error("fixture params invalid");
  const result = template.generate(validated.values);
  return jsonResponse({
    ok: true,
    data: {
      templateId,
      generatorVersion: template.generatorVersion,
      params: validated.values,
      paramsHash: hashParams(validated.values),
      source: result.source,
      metadata: {
        name: result.name,
        mountType: result.mountType,
        packageCode: result.packageCode,
        tags: result.tags,
      },
    },
  });
}

// Materialize requests stay pending until the test resolves them, so the
// order of responses vs. form edits is under test control. The mock ignores
// abort on purpose: only the request-key check may drop a late response.
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url === `${BACKEND}/api/modules/library/templates`) {
    return jsonResponse({ ok: true, data: { templates: TEMPLATE_LIST } });
  }
  const match = /\/templates\/([^/]+)\/materialize$/.exec(url);
  if (!match) throw new Error(`unexpected fetch ${url}`);
  const templateId = decodeURIComponent(match[1]!);
  const { params } = JSON.parse(String(init?.body)) as {
    params: Record<string, unknown>;
  };
  return new Promise<Response>((resolve) => {
    pending.push({
      params,
      resolve: () => resolve(materializedResponse(templateId, params)),
    });
  });
});

let root: Root;
let host: HTMLDivElement;
const onGenerated = vi.fn<(g: GeneratedFootprintPayload | null) => void>();
const onUse = vi.fn<(g: GeneratedFootprintPayload) => void>();

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
}

async function render(element: React.ReactElement): Promise<void> {
  await act(async () => root.render(element));
  await flush();
}

function panel(
  props: Partial<React.ComponentProps<typeof FootprintGeneratorPanel>> = {},
): React.ReactElement {
  return (
    <FootprintGeneratorPanel
      backendURL={BACKEND}
      moduleId="library"
      onGenerated={onGenerated}
      onUse={onUse}
      {...props}
    />
  );
}

function buttonStartingWith(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.startsWith(text),
  );
  if (!found) throw new Error(`button "${text}" missing`);
  return found;
}

async function click(text: string): Promise<void> {
  await act(async () => buttonStartingWith(text).click());
  await flush();
}

/** Radix tabs activate on mousedown, not click. */
async function activateTab(label: string): Promise<void> {
  const trigger = [...host.querySelectorAll('[role="tab"]')].find(
    (t) => t.textContent === label,
  );
  if (!trigger) throw new Error(`tab "${label}" missing`);
  await act(async () => {
    trigger.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0 }),
    );
  });
  await flush();
}

async function typeInto(id: string, value: string): Promise<void> {
  const input = host.querySelector<HTMLInputElement>(`#${id}`);
  if (!input) throw new Error(`input #${id} missing`);
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}

async function resolveMaterialize(index: number): Promise<void> {
  await act(async () => pending[index]!.resolve());
  await flush();
}

function lastEmitted(): GeneratedFootprintPayload | null | undefined {
  return onGenerated.mock.calls.at(-1)?.[0];
}

function useButton(): HTMLButtonElement {
  return buttonStartingWith("Use footprint");
}

function templatePayloadFor(
  templateId: string,
  params: Record<string, unknown>,
): GeneratedFootprintPayload {
  const template = getTemplate(templateId)!;
  const validated = validateParams(template.schema, params);
  if (!validated.ok) throw new Error("fixture params invalid");
  const result = template.generate(validated.values);
  return templateToPayload({
    templateId,
    params: validated.values,
    source: result.source,
    metadata: {
      name: result.name,
      mountType: result.mountType,
      packageCode: result.packageCode,
      tags: [...result.tags],
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  pending = [];
  qualification.available = new Set(["chip", "sot"]);
  vi.stubGlobal("fetch", fetchMock);
  useImportWizardStore.getState().reset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  useImportWizardStore.getState().reset();
});

describe("IPC tab (T-319)", () => {
  test("(a) selecting family and size emits the identical tuple without a Generate click", async () => {
    await render(panel());
    expect(lastEmitted()).toBeNull();
    await click("Chip");
    await click("0603");
    expect(lastEmitted()?.generator).toEqual({
      kind: "ipc7351b",
      family: "chip",
      size: "0603",
      density: "nominal",
    });
    expect(
      [...host.querySelectorAll("button")].some((b) =>
        b.textContent?.includes("Generate footprint"),
      ),
    ).toBe(false);
  });

  test("(b) size then density change always emits the displayed tuple", async () => {
    await render(panel());
    await click("SOT");
    await click("SOT-23");
    expect(lastEmitted()?.generator).toMatchObject({
      size: "SOT-23",
      density: "nominal",
    });
    const before = onGenerated.mock.calls.length;
    await click("SOT-323");
    expect(lastEmitted()?.generator).toEqual({
      kind: "ipc7351b",
      family: "sot",
      size: "SOT-323",
      density: "nominal",
    });
    await click("C (Least)");
    const shown = {
      kind: "ipc7351b",
      family: "sot",
      size: "SOT-323",
      density: "least",
    };
    expect(lastEmitted()?.generator).toEqual(shown);
    for (const [emitted] of onGenerated.mock.calls.slice(before)) {
      expect(emitted?.generator).not.toMatchObject({ size: "SOT-23" });
    }
    expect(useButton().disabled).toBe(false);
    await act(async () => useButton().click());
    expect(onUse).toHaveBeenCalledOnce();
    expect(onUse.mock.calls[0]![0].generator).toEqual(shown);
  });

  test("(e) an unavailable family renders the reason and emits null", async () => {
    qualification.available = new Set();
    await render(
      panel({
        ipcSelection: { family: "qfn", size: "QFN-16", density: "nominal" },
      }),
    );
    const reason = generatorUnavailableReason("qfn");
    expect(reason).not.toBeNull();
    const alert = [...host.querySelectorAll('[role="alert"]')].find(
      (el) => el.textContent === reason,
    );
    expect(alert).toBeDefined();
    expect(lastEmitted()).toBeNull();
    expect(useButton().disabled).toBe(true);
  });
});

describe("Template tab (T-319)", () => {
  test("(c) emits null until a template materializes; switching back re-emits the IPC payload", async () => {
    await render(panel());
    await click("Chip");
    await click("0603");
    const ipcPayload = lastEmitted();
    expect(ipcPayload).not.toBeNull();
    await activateTab("Template");
    expect(lastEmitted()).toBeNull();
    expect(useButton().disabled).toBe(true);
    await click("Generate footprint");
    expect(lastEmitted()).toBeNull();
    await resolveMaterialize(0);
    expect(lastEmitted()?.generator).toMatchObject({
      kind: "template",
      templateId: TEMPLATE_LIST[0]!.id,
    });
    expect(useButton().disabled).toBe(false);
    await activateTab("IPC package");
    expect(lastEmitted()).toBe(ipcPayload);
  });

  test("(d) editing a template field emits null and disables Use", async () => {
    await render(panel({ activeTab: "template" }));
    await click("Generate footprint");
    await resolveMaterialize(0);
    expect(lastEmitted()).not.toBeNull();
    expect(useButton().disabled).toBe(false);
    await typeInto("tpl-param-pinsPerRow", "5");
    expect(lastEmitted()).toBeNull();
    expect(useButton().disabled).toBe(true);
  });

  test("(f) a late response for edited params is dropped; the current one is emitted", async () => {
    await render(panel({ activeTab: "template" }));
    await click("Generate footprint");
    expect(pending).toHaveLength(1);
    await typeInto("tpl-param-pinsPerRow", "5");
    const emittedBeforeLate = onGenerated.mock.calls.length;
    await resolveMaterialize(0);
    expect(
      onGenerated.mock.calls.slice(emittedBeforeLate).every(([g]) => g === null),
    ).toBe(true);
    expect(lastEmitted()).toBeNull();
    expect(useButton().disabled).toBe(true);

    await click("Generate footprint");
    expect(pending).toHaveLength(2);
    expect(pending[1]!.params).toMatchObject({ pinsPerRow: 5 });
    await resolveMaterialize(1);
    const current = lastEmitted();
    expect(current?.generator).toMatchObject({
      kind: "template",
      params: { pinsPerRow: 5 },
    });
    expect(useButton().disabled).toBe(false);
  });
});

describe("wizard store", () => {
  test("(g) remount keeps the Template tab, the form and a committable payload", async () => {
    useImportWizardStore.setState({ footprintSource: "preset" });
    await render(<FootprintStep backendURL={BACKEND} moduleId="library" />);
    await activateTab("Template");
    await typeInto("tpl-param-pinsPerRow", "6");
    await click("Generate footprint");
    await resolveMaterialize(0);
    const before = useImportWizardStore.getState();
    expect(before.templatePayload).not.toBeNull();
    expect(hasCurrentPreset(before)).toBe(true);
    const payload = before.templatePayload;
    const selection = before.templateSelection;

    // Leave the step and come back.
    await render(<></>);
    await render(<FootprintStep backendURL={BACKEND} moduleId="library" />);

    const tab = [...host.querySelectorAll('[role="tab"]')].find(
      (t) => t.textContent === "Template",
    );
    expect(tab?.getAttribute("aria-selected")).toBe("true");
    expect(
      host.querySelector<HTMLInputElement>("#tpl-param-pinsPerRow")?.value,
    ).toBe("6");
    const after = useImportWizardStore.getState();
    expect(after.templatePayload).toBe(payload);
    expect(after.templateSelection).toBe(selection);
    expect(after.generatedFootprint?.generator).toEqual(payload!.generator);
    expect(hasCurrentPreset(after)).toBe(true);
    expect(pending).toHaveLength(1);
  });

  test("(h) a template payload whose params differ from the displayed form is not committable", () => {
    const template = TEMPLATE_LIST[0]!;
    const displayed = Object.fromEntries(
      Object.entries(template.defaults).map(([k, v]) => [
        k,
        typeof v === "boolean" ? v : String(v),
      ]),
    );
    const pinsPerRow = Number(template.defaults.pinsPerRow);
    const matching = templatePayloadFor(template.id, template.defaults);
    const differing = templatePayloadFor(template.id, {
      ...template.defaults,
      pinsPerRow: pinsPerRow + 1,
    });
    const state = useImportWizardStore.getState();
    state.setFootprintSource("preset");
    state.setGeneratorTab("template");
    state.setTemplateSelection({ templateId: template.id, values: displayed });

    state.setGeneratedFootprint(differing);
    expect(useImportWizardStore.getState().generatedFootprint).toBeNull();
    expect(
      hasCurrentPreset({
        ...useImportWizardStore.getState(),
        generatedFootprint: differing,
      }),
    ).toBe(false);

    // Same params after normalisation ("2" displayed vs 2 produced) is current.
    state.setGeneratedFootprint(matching);
    expect(hasCurrentPreset(useImportWizardStore.getState())).toBe(true);

    // A template payload is never current while the IPC tab is displayed.
    expect(
      hasCurrentPreset({
        ...useImportWizardStore.getState(),
        generatorTab: "ipc",
      }),
    ).toBe(false);
  });
});
