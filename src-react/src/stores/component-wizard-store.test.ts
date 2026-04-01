import { beforeEach, describe, expect, it } from "vitest";
import { useComponentWizardStore } from "./component-wizard-store";

describe("component-wizard-store", () => {
  beforeEach(() => {
    useComponentWizardStore.getState().reset();
  });

  it("initializes new drafts on symbol step", () => {
    useComponentWizardStore.getState().initDraft("draft-1");

    const state = useComponentWizardStore.getState();
    expect(state.draftId).toBe("draft-1");
    expect(state.currentStep).toBe("symbol");
    expect(state.draft).toEqual({
      displayLabel: "",
      description: "",
      symbolData: null,
      footprintData: null,
      modelData: null,
      specs: null,
      defaultPackageVariantId: null,
    });
    expect(state.isDirty).toBe(false);
  });

  it("marks drafts dirty on partial updates and preserves existing fields", () => {
    const store = useComponentWizardStore.getState();
    store.initDraft("draft-2");
    store.updateDraft({ displayLabel: "MCU" });
    store.updateDraft({ description: "Imported symbol" });

    const state = useComponentWizardStore.getState();
    expect(state.draft?.displayLabel).toBe("MCU");
    expect(state.draft?.description).toBe("Imported symbol");
    expect(state.isDirty).toBe(true);
  });

  it("resets all wizard state", () => {
    const store = useComponentWizardStore.getState();
    store.initDraft("draft-3");
    store.updateDraft({ displayLabel: "BGA" });
    store.setStep("footprint");
    store.reset();

    const state = useComponentWizardStore.getState();
    expect(state.draftId).toBeNull();
    expect(state.draft).toBeNull();
    expect(state.currentStep).toBe("symbol");
    expect(state.isDirty).toBe(false);
  });
});
