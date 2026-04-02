import { describe, expect, it } from "vitest";
import { parseHashToRoute, routeToHash } from "@/navigation/routes";

describe("navigation route schema", () => {
  it("serializes design variants", () => {
    expect(
      routeToHash({
        screen: "design",
        projectId: "project-1",
        designId: "design-1",
      }),
    ).toBe("#design-project:project-1:design-1");

    expect(
      routeToHash({
        screen: "design",
        projectId: null,
        designId: "design-1",
      }),
    ).toBe("#design-workspace:design-1");

    expect(
      routeToHash({
        screen: "design",
        projectId: "project-1",
        designId: null,
      }),
    ).toBe("#design-project:project-1");
  });

  it("parses compatibility aliases", () => {
    expect(parseHashToRoute("#project-abc")).toEqual({ screen: "home" });
    expect(parseHashToRoute("#component-new")).toEqual({ screen: "library" });
  });

  it("parses and serializes chat routes", () => {
    expect(parseHashToRoute("#chat")).toEqual({ screen: "chat", chatId: null });
    expect(parseHashToRoute("#chat-123")).toEqual({
      screen: "chat",
      chatId: "123",
    });

    expect(routeToHash({ screen: "chat", chatId: null })).toBe("#chat");
    expect(routeToHash({ screen: "chat", chatId: "123" })).toBe("#chat-123");
  });
});
