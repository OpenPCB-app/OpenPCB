import { describe, expect, it } from "bun:test";
import { COPILOT_CLIENT_ID, COPILOT_SCOPE } from "../../config";

describe("GitHub Provider", () => {
  it("exports required constants from config", () => {
    expect(COPILOT_CLIENT_ID).toBeDefined();
    expect(COPILOT_SCOPE).toBe("read:user");
  });
});
