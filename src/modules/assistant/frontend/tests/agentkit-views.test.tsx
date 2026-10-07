// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AgentKitAppProvider } from "../../../../shared/frontend/assistant/AgentKitAppProvider";
import { AssistantSpace } from "../Space";
import { useDesignerConversation } from "../hooks/useDesignerConversation";
import { DesignerChatDock } from "../DesignerChatDock";
import { AgentKitHttpFixture } from "./agentkit-http-fixture";
vi.mock("../../../../core/frontend/src/providers/ThemeProvider", () => ({ useTheme: () => ({ mode: "light" }) }));
let fixture: AgentKitHttpFixture;
let container: HTMLDivElement;
let root: Root;
let changed: ReturnType<typeof vi.fn>;
let opened: ReturnType<typeof vi.fn>;
async function mount(designId = "design-real") {
  await act(async () => {
    root.render(<AgentKitAppProvider baseUrl="http://127.0.0.1:3000/api/modules/assistant">
      <section data-testid="space"><AssistantSpace moduleId="assistant" namespace="assistant" backendURL={null} params={{ chatId: "chat-a" }} /></section>
      <section data-testid="dock"><DesignerChatDock backendURL={null} designId={designId} designName={designId} designRevision={0} onClose={() => {}} onOpenFull={opened} onDesignChanged={changed} /></section>
    </AgentKitAppProvider>);
  });
}
async function until(check: () => boolean, timeout = 2000) {
  const deadline = Date.now() + timeout;
  while (!check()) { if (Date.now() >= deadline) throw new Error(`Condition timed out: ${container.textContent}`); await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); }
}
function area(name: "space" | "dock") { return container.querySelector<HTMLElement>(`[data-testid="${name}"]`)!; }
function textarea(name: "space" | "dock") { return area(name).querySelector<HTMLTextAreaElement>("textarea")!; }
async function enter(name: "space" | "dock", text: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea(name), text); textarea(name).dispatchEvent(new Event("input", { bubbles: true })); });
}
beforeEach(() => {
  fixture = new AgentKitHttpFixture(); fixture.chats.get("chat-a")!.metadata = { designId: "design-real", designName: "Real design" };
  changed = vi.fn(); opened = vi.fn(); localStorage.clear();
  Object.defineProperty(window, "electronAPI", { configurable: true, value: { localApi: { bootstrap: async () => ({ url: "http://127.0.0.1:3000", token: "a".repeat(64) }) } } });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("fetch", fixture.fetch);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => { root.unmount(); fixture.close(); }); container.remove(); vi.unstubAllGlobals(); });

test("Space and dock share canonical chat, draft, accepted run and Stop", async () => {
  await mount(); await until(() => !textarea("space").disabled && !textarea("dock").disabled);
  await enter("space", "Shared question");
  expect(textarea("dock").value).toBe("Shared question");
  await act(async () => { textarea("space").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  await until(() => fixture.submissions.size === 1 && area("dock").textContent?.includes("Shared question") === true);
  await until(() => [...area("dock").querySelectorAll("button")].some(button => button.textContent?.trim() === "Stop"));
  await act(async () => { [...area("dock").querySelectorAll("button")].find(button => button.textContent?.trim() === "Stop")!.click(); });
  await until(() => area("space").textContent?.includes("Stopped answer") === true && area("dock").textContent?.includes("Stopped answer") === true);
  expect(fixture.requests.filter(request => request.url.pathname.includes("/api/modules/tasks/"))).toHaveLength(0);
  expect(fixture.requests.filter(request => request.url.pathname.endsWith("/cancel"))).toHaveLength(1);
  expect(fixture.submissions.size).toBe(1);
  await act(async () => { area("dock").querySelector<HTMLButtonElement>('[aria-label="Open in Assistant view"]')!.click(); });
  expect(opened).toHaveBeenCalledWith("chat-a");
});

test("Shift+Enter preserves multiline draft, design switch hides previous thread", async () => {
  fixture.chats.get("chat-b")!.metadata = { designId: "design-other", designName: "Other design" };
  await mount(); await until(() => !textarea("dock").disabled);
  await enter("dock", "Line one\nLine two");
  await act(async () => { textarea("dock").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true })); });
  expect(fixture.submissions.size).toBe(0);
  await mount("design-other"); await until(() => !textarea("dock").disabled);
  expect(textarea("dock").value).toBe("");
  await enter("dock", "Other draft");
  await mount("design-real"); await until(() => textarea("dock").value === "Line one\nLine two");
  expect(fixture.submissions.size).toBe(0);
});


test("delayed dock creation and binding preserve newer draft text", async () => {
  let view!: ReturnType<typeof useDesignerConversation>;
  function Probe() {
    view = useDesignerConversation({ backendURL: null, designId: "design-late", designName: "Late design", designRevision: 0, onClose() {}, onOpenFull: opened, onDesignChanged: changed });
    return <div>{view.input}</div>;
  }
  await act(async () => { root.render(<AgentKitAppProvider baseUrl="http://127.0.0.1:3000/api/modules/assistant"><Probe /></AgentKitAppProvider>); });
  await until(() => view.canSend);
  await act(async () => { view.setInput("Original draft"); });
  let releaseCreate!: () => void; let releaseBinding!: () => void;
  fixture.delayCreate = new Promise(resolve => { releaseCreate = resolve; });
  fixture.delayBinding = new Promise(resolve => { releaseBinding = resolve; });
  let creation!: Promise<{ id: string }>;
  await act(async () => { creation = view.createDesignChat(); });
  await act(async () => { view.setInput("Newer draft during creation"); releaseCreate(); });
  await until(() => fixture.requests.some(request => request.url.pathname.endsWith("/context-bindings")));
  expect(view.selectedChatId).toBeNull();
  await act(async () => { view.setInput("Newest draft during binding"); releaseBinding(); await creation; });
  await until(() => view.canSend && view.input === "Newest draft during binding");
  expect(fixture.submissions.size).toBe(0);
  expect(fixture.chats.get(view.selectedChatId!)!.metadata.designId).toBe("design-late");
});
