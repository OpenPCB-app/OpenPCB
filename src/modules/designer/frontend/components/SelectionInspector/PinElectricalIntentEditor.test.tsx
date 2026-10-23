// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { DesignerDispatchResult, DesignerPin } from "../../../../../sdks";
import { PinElectricalIntentEditor } from "./PinElectricalIntentEditor";

const pin: DesignerPin = {
  id: "part-1:pad-a", originPinKey: "pad-a", number: "1", name: "VIN",
  electricalType: "power_in", unit: 1,
  localPositionNm: { x: 0, y: 0 }, worldPositionNm: { x: 2_000_000, y: 3_000_000 },
};
const acknowledged: DesignerDispatchResult = { ok: true, revision: 2, createdEntityId: null };
let host: HTMLDivElement;
let root: Root;
const dispatchCommand = vi.fn<() => Promise<DesignerDispatchResult>>();
const setError = vi.fn();

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  dispatchCommand.mockReset().mockResolvedValue(acknowledged);
  setError.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function renderPin(overrides: Partial<DesignerPin> = {}): Promise<HTMLSelectElement> {
  await act(async () => root.render(
    <PinElectricalIntentEditor pin={{ ...pin, ...overrides }} dispatchCommand={dispatchCommand} setError={setError} />,
  ));
  return host.querySelector("select")!;
}

async function selectIntent(select: HTMLSelectElement, intent: string): Promise<void> {
  await act(async () => {
    select.value = intent;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

test("dispatches the stable pin command, waits for acknowledgement, then displays refreshed intent", async () => {
  let resolve!: (value: DesignerDispatchResult) => void;
  dispatchCommand.mockImplementation(() => new Promise((done) => { resolve = done; }));
  const select = await renderPin();
  expect(select.getAttribute("aria-label")).toBe("Pin 1 VIN electrical intent");
  await selectIntent(select, "power_source");
  expect(dispatchCommand).toHaveBeenCalledWith({
    type: "set_pin_electrical_intent", pinId: "part-1:pad-a", intent: "power_source",
  });
  expect(select.disabled).toBe(true);
  expect(select.getAttribute("aria-busy")).toBe("true");
  expect(select.value).toBe("");
  expect(host.textContent).toContain("Saving…");
  await selectIntent(select, "no_connect");
  expect(dispatchCommand).toHaveBeenCalledTimes(1);
  await act(async () => resolve(acknowledged));
  await renderPin({ electricalIntent: "power_source" });
  expect(select.disabled).toBe(false);
  expect(select.value).toBe("power_source");
  expect(host.textContent).toContain("does not rename the net");
});

test("shows rejected command error and keeps acknowledged intent", async () => {
  dispatchCommand.mockRejectedValueOnce(new Error("PIN_ALREADY_CONNECTED"));
  const select = await renderPin();
  await selectIntent(select, "no_connect");
  expect(select.value).toBe("");
  expect(select.disabled).toBe(false);
  expect(select.getAttribute("aria-invalid")).toBe("true");
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("PIN_ALREADY_CONNECTED");
  expect(setError).toHaveBeenCalledWith("PIN_ALREADY_CONNECTED");
});

test("non-ok command result is a visible failure", async () => {
  dispatchCommand.mockResolvedValueOnce({ ok: false, code: "OPERATION_IDENTITY_CONFLICT", commandId: "duplicate" });
  const select = await renderPin();
  await selectIntent(select, "no_connect");
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("OPERATION_IDENTITY_CONFLICT");
  expect(select.value).toBe("");
});

test("shows backend pin-intent validation detail", async () => {
  dispatchCommand.mockResolvedValueOnce({
    ok: false, code: "INVALID_PIN_ELECTRICAL_INTENT", pinId: pin.id,
    detail: "An intentional no-connect pin cannot already be connected.",
  });
  await selectIntent(await renderPin(), "no_connect");
  expect(host.querySelector('[role="alert"]')?.textContent)
    .toBe("An intentional no-connect pin cannot already be connected.");
});

test("deferred failure after row unmount does not set the next design's error", async () => {
  let reject!: (error: Error) => void;
  dispatchCommand.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  await selectIntent(await renderPin(), "no_connect");
  await act(async () => root.render(null));
  await act(async () => reject(new Error("Old design failure")));
  expect(setError).not.toHaveBeenCalled();
});

test("pin replacement releases pending state and ignores previous pin's deferred failure", async () => {
  let reject!: (error: Error) => void;
  dispatchCommand.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  await selectIntent(await renderPin(), "no_connect");
  const select = await renderPin({ id: "next-part:pin" });
  expect(select.disabled).toBe(false);
  await act(async () => reject(new Error("Old pin failure")));
  expect(setError).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await selectIntent(select, "power_source");
  expect(dispatchCommand).toHaveBeenLastCalledWith({
    type: "set_pin_electrical_intent", pinId: "next-part:pin", intent: "power_source",
  });
});

test("pin replacement clears the previous pin's displayed error", async () => {
  dispatchCommand.mockRejectedValueOnce(new Error("Old pin failure"));
  await selectIntent(await renderPin(), "no_connect");
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  await renderPin({ id: "next-part:pin" });
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

test.each(["", "no_connect", "power_source"])("unknown intent stays visible until explicitly replaced with %s", async (replacement) => {
  const select = await renderPin({ electricalIntent: "future_supply_mode" });
  expect(select.value).toBe("unsupported");
  expect(select.selectedOptions[0]?.textContent).toBe("Unsupported: future_supply_mode");
  expect(select.selectedOptions[0]?.disabled).toBe(true);
  expect(select.selectedOptions[0]?.hidden).toBe(false);
  expect(host.textContent).toContain("Unsupported stored intent: future_supply_mode");
  expect(dispatchCommand).not.toHaveBeenCalled();
  await selectIntent(select, replacement);
  expect(dispatchCommand).toHaveBeenCalledWith({
    type: "set_pin_electrical_intent", pinId: pin.id, intent: replacement || null,
  });
});

test("library no-connect pin cannot select power source", async () => {
  const select = await renderPin({ electricalType: "no_connect" });
  expect(select.querySelector<HTMLOptionElement>('option[value="power_source"]')?.disabled).toBe(true);
  expect(host.textContent).toContain("Library no-connect pins cannot be power sources.");
  await selectIntent(select, "power_source");
  expect(dispatchCommand).not.toHaveBeenCalled();
  await selectIntent(select, "no_connect");
  expect(dispatchCommand).toHaveBeenCalledWith({
    type: "set_pin_electrical_intent", pinId: pin.id, intent: "no_connect",
  });
});
