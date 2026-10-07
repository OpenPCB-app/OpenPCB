// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AgentKitAppProvider } from "../../../../shared/frontend/assistant/AgentKitAppProvider";
import { useAssistantConversation } from "../hooks/useAssistantConversation";
import { RunVerification } from "../components/RunVerification";
import { ProposalOutcome } from "../components/ProposalOutcome";
import { AgentKitHttpFixture, provider, settings } from "./agentkit-http-fixture";

let fixture: AgentKitHttpFixture;
let container: HTMLDivElement;
let root: Root;
let view: ReturnType<typeof useAssistantConversation>;
let changed: ReturnType<typeof vi.fn>;
function Probe({ chatId }: { chatId: string }) {
  view = useAssistantConversation(chatId, "new", changed);
  return <><div data-testid="content">{view.messages.map(message => message.content).join("|")}</div>
    <div data-testid="phase">{view.selectedRun?.status}</div>
    <RunVerification event={view.verification} truncated={view.chat.truncated} finishReason={view.chat.finishReason} />
    {view.writeProposals.map(proposal => <ProposalOutcome key={proposal.id} outcome={proposal.applyResult} />)}</>;
}
async function mount(chatId = "chat-a", visible = true) {
  await act(async () => { root.render(<AgentKitAppProvider baseUrl="http://127.0.0.1:3000/api/modules/assistant">{visible ? <Probe chatId={chatId} /> : null}</AgentKitAppProvider>); });
}
async function until(check: () => boolean, timeout = 2000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(`Condition timed out: ${container.textContent}`);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  }
}
async function submit(content = "Place a capacitor") {
  await until(() => view.canSend);
  await act(async () => { view.setInput(content); });
  await act(async () => { await view.submit(); });
}
beforeEach(() => {
  fixture = new AgentKitHttpFixture(); changed = vi.fn();
  Object.defineProperty(window, "electronAPI", { configurable: true, value: { localApi: { bootstrap: async () => ({ url: "http://127.0.0.1:3000", token: "a".repeat(64) }) } } });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fixture.fetch);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => { root.unmount(); fixture.close(); }); container.remove(); vi.unstubAllGlobals(); });

describe("canonical Assistant conversation transport", () => {
  test("waits for settings, snapshots configured provider/model/preset, joins double submit", async () => {
    let release!: () => void;
    fixture.delaySettings = new Promise(resolve => { release = resolve; });
    await mount();
    await act(async () => { view.setInput("Question"); await view.submit(); });
    expect(fixture.submissions.size).toBe(0);
    await act(async () => { release(); });
    await until(() => view.canSend);
    await act(async () => { await Promise.all([view.submit(), view.submit()]); });
    expect(fixture.submissions.size).toBe(1);
    const writes = fixture.requests.filter(request => request.method === "POST" && request.url.pathname.endsWith("/messages"));
    expect(writes).toHaveLength(1);
    expect(writes[0]!.body).toMatchObject({ providerId: provider.id, model: settings.defaultModel, metadata: { promptPresetId: "minimal-concise" } });
    expect(writes[0]!.headers.get("X-OpenPCB-Token")).toBe("a".repeat(64));
    await until(() => view.input === "");
  });
  test("lost submit response retries same Idempotency-Key without a second turn", async () => {
    fixture.loseNextPost = true; await mount(); await submit("Recover me");
    expect(view.error).toContain("POST response lost"); expect(view.input).toBe("Recover me");
    await act(async () => { await view.submit(); });
    expect(fixture.submissions.size).toBe(1);
    const writes = fixture.requests.filter(request => request.method === "POST" && request.url.pathname.endsWith("/messages"));
    expect(writes).toHaveLength(2);
    expect(writes[0]!.headers.get("Idempotency-Key")).toBe(writes[1]!.headers.get("Idempotency-Key"));
  });
  test("lost POST retry keeps original turn snapshot when defaults refresh", async () => {
    fixture.loseNextPost = true; await mount(); await submit("Immutable retry");
    fixture.preferenceSettings.defaultModel = "new-default-model";
    await act(async () => { await view.cache.refreshPreferences(); });
    await until(() => view.canSend && view.model === "new-default-model");
    await act(async () => { await view.submit(); });
    const writes = fixture.requests.filter(request => request.method === "POST" && request.url.pathname.endsWith("/messages"));
    expect(writes).toHaveLength(2);
    expect(writes[0]!.headers.get("Idempotency-Key")).toBe(writes[1]!.headers.get("Idempotency-Key"));
    expect(writes[1]!.body).toEqual(writes[0]!.body);
    expect(fixture.submissions.size).toBe(1);
  });
  test("lost POST followed by remount attaches accepted turn and clears only its draft", async () => {
    fixture.loseNextPost = true; await mount(); await submit("Recover after navigation");
    expect(view.input).toBe("Recover after navigation");
    await mount("chat-a", false); await mount();
    await until(() => view.selectedRun?.taskId === "run-1" && view.input === "");
    expect(fixture.submissions.size).toBe(1);
    expect(fixture.requests.filter(request => request.method === "POST" && request.url.pathname.endsWith("/messages"))).toHaveLength(1);
  });
  test("provider/model/preset choices survive switching and remount without changing defaults", async () => {
    await mount(); await until(() => view.canSend);
    await act(async () => { view.setModel("chosen-model"); view.setPromptPresetId("friendly-tutorial"); });
    await mount("chat-b"); await until(() => view.canSend);
    expect(view.model).toBe(settings.defaultModel);
    await mount("chat-a", false); await mount(); await until(() => view.canSend);
    expect(view.model).toBe("chosen-model"); expect(view.promptPresetId).toBe("friendly-tutorial");
    await submit("Use my snapshot");
    const write = fixture.requests.find(request => request.method === "POST" && request.url.pathname.endsWith("/messages"));
    expect(write!.body).toMatchObject({ model: "chosen-model", metadata: { promptPresetId: "friendly-tutorial" } });
  });
  test("remount attaches original active run; Stop stays cancelled and never resumes automatically", async () => {
    await mount(); await submit(); await until(() => view.selectedRun?.taskId === "run-1");
    await mount("chat-a", false); await mount();
    await until(() => view.selectedRun?.taskId === "run-1");
    await act(async () => { await view.stopRun(); });
    await until(() => view.selectedRun?.status === "cancelled");
    await mount("chat-a", false); await mount();
    expect(fixture.submissions.size).toBe(1);
    expect(fixture.requests.filter(request => request.url.pathname.endsWith("/resume"))).toHaveLength(0);
    expect(container.textContent).toContain("Stopped answer");
  });
  test("reconnect uses Last-Event-ID; final message and verification come from authoritative reads", async () => {
    await mount(); await submit(); await until(() => (fixture.connections.get("run-1")?.size ?? 0) >= 2);
    await act(async () => { fixture.append("run-1", "run.message.delta", { delta: "Streamed draft" }); });
    await until(() => container.textContent?.includes("Streamed draft") === true);
    await act(async () => { fixture.disconnect("run-1"); });
    await until(() => fixture.requests.some(request => request.url.pathname.endsWith("/stream") && request.headers.get("Last-Event-ID") === "run-1:1"));
    await act(async () => {
      fixture.append("run-1", "run.completed", { iterations: 1, finishReason: "stop" });
      fixture.append("run-1", "run.verification", { pass: 1, status: "partial", deficiencies: ["Unconnected capacitor pin"] });
      fixture.settle("run-1", "completed", "Persisted final answer");
    });
    await until(() => container.textContent?.includes("Persisted final answer") === true && container.textContent.includes("Unconnected capacitor pin"));
    expect(container.textContent).not.toContain("Streamed draft");
    expect(fixture.submissions.size).toBe(1);
  });
  test("rapid switch ignores delayed old-chat read and retains drafts by chat", async () => {
    let release!: () => void;
    fixture.delayMessages.set("chat-a", new Promise(resolve => { release = resolve; }));
    fixture.messages.get("chat-a")!.push({ id: "old", chatId: "chat-a", role: "assistant", content: "Old chat secret", metadata: {}, createdAt: "2026-10-07" });
    await mount(); await act(async () => { view.setInput("Draft A"); });
    await mount("chat-b"); await until(() => view.canSend);
    await act(async () => { view.setInput("Draft B"); release(); });
    expect(view.input).toBe("Draft B"); expect(container.textContent).not.toContain("Old chat secret");
    await mount("chat-a"); await until(() => view.input === "Draft A");
    expect(container.textContent).toContain("Old chat secret");
  });
  test("interrupted run waits for explicit Continue and reuses original run identity", async () => {
    await mount(); await submit(); await until(() => view.selectedRun?.taskId === "run-1");
    await act(async () => { fixture.settle("run-1", "interrupted", "Saved partial answer"); });
    await mount("chat-a", false); await mount();
    await until(() => view.selectedRun?.status === "interrupted");
    expect(fixture.requests.filter(request => request.url.pathname.endsWith("/resume"))).toHaveLength(0);
    await act(async () => { await view.continueRun(); });
    await until(() => fixture.requests.some(request => request.url.pathname.endsWith("/run-1/resume")));
    expect(fixture.submissions.size).toBe(1);
  });
  test("late unscoped proposal refresh from A cannot expose or apply A in chat B", async () => {
    fixture.proposals.set("proposal-a", { id: "proposal-a", chatId: "chat-a", scopeKey: "design:a", toolName: "designer_schematic_edits", kind: "designer_schematic_edits", risk: "medium", status: "pending", warnings: [], truncated: false, createdAt: "2026-10-07" });
    fixture.presentations.set("proposal-a", { proposalId: "proposal-a", envelope: { id: "proposal-a", designId: "design-a", baseRevision: 0, kind: "designer_schematic_edits", toolName: "designer_schematic_edits", title: "Edit A", summary: "Edit A", riskLevel: "medium", operations: [], payload: {}, sources: [], warnings: [] }, outcome: null });
    await mount(); await until(() => view.writeProposals.length === 1);
    let release!: () => void;
    fixture.delayProposals.set("chat-a", new Promise(resolve => { release = resolve; }));
    let delayed!: Promise<void>;
    await act(async () => { delayed = view.refreshMessages(); });
    await mount("chat-b"); await until(() => view.canSend);
    await act(async () => { release(); await delayed; });
    expect(view.writeProposals).toEqual([]);
    await act(async () => { await expect(view.proposalActions.apply("proposal-a")).rejects.toThrow("no longer available"); });
    expect(fixture.mutationCount).toBe(0);
  });
  test("forced preferences refresh wins over delayed pre-save app and canonical snapshots", async () => {
    let releaseApp!: () => void; let releaseSettings!: () => void;
    fixture.delayAppSettings = new Promise(resolve => { releaseApp = resolve; });
    fixture.delaySettings = new Promise(resolve => { releaseSettings = resolve; });
    fixture.preferenceAppSettings.defaultPromptPresetId = "strict-grounded";
    await mount();
    fixture.delayAppSettings = null; fixture.delaySettings = null;
    fixture.preferenceAppSettings.defaultPromptPresetId = "minimal-concise"; fixture.preferenceSettings.defaultModel = "new-model";
    await act(async () => { await view.cache.refreshPreferences(); });
    await until(() => view.canSend && view.promptPresetId === "minimal-concise" && view.model === "new-model");
    await act(async () => { releaseApp(); releaseSettings(); });
    expect(view.promptPresetId).toBe("minimal-concise"); expect(view.model).toBe("new-model");
  });
  test("late provider refresh cannot overwrite a newer saved provider", async () => {
    await mount(); await until(() => view.canSend);
    let release!: () => void; fixture.delayProviders = new Promise(resolve => { release = resolve; });
    let oldRefresh!: Promise<void>;
    await act(async () => { oldRefresh = view.cache.refreshPreferences(); });
    await until(() => fixture.requests.filter(request => request.url.pathname.endsWith("/providers")).length >= 3);
    fixture.preferenceProvider.label = "Latest saved provider"; fixture.delayProviders = null;
    await act(async () => { await view.cache.refreshPreferences(); });
    expect(view.selectedProvider?.label).toBe("Latest saved provider");
    await act(async () => { release(); await oldRefresh; });
    expect(view.selectedProvider?.label).toBe("Latest saved provider");
  });
  test("delayed chat list cannot erase a newer canonical creation", async () => {
    let release!: () => void; fixture.delayChats = new Promise(resolve => { release = resolve; });
    await mount();
    let created!: { id: string };
    await act(async () => { created = await view.cache.createChat({ designId: "created-design" }); });
    fixture.delayChats = null;
    await act(async () => { await view.cache.reloadChats(); release(); });
    expect(view.cache.chats.some(chat => chat.id === created.id)).toBe(true);
  });
  test("preferences refresh replaces already-loaded canonical model catalog", async () => {
    await mount(); await until(() => view.canSend);
    expect(view.models.map(model => model.modelId)).toEqual(["fixture-model"]);
    fixture.modelCatalogue = [{ providerId: "local", modelId: "new-catalogue-model", displayName: "New model", fetchedAt: "2026-10-07" }];
    await act(async () => { await view.cache.refreshPreferences(); });
    expect(view.models.map(model => model.modelId)).toEqual(["new-catalogue-model"]);
  });
  test("session permission comes from trusted proposal ID and revoke removes durable grant", async () => {
    fixture.proposals.set("permission-proposal", { id: "permission-proposal", chatId: "chat-a", scopeKey: "design:design-real", toolName: "designer_schematic_edits", kind: "designer_schematic_edits", risk: "destructive", status: "pending", warnings: [], truncated: false, createdAt: "2026-10-07" });
    fixture.presentations.set("permission-proposal", { proposalId: "permission-proposal", envelope: { id: "permission-proposal", designId: "design-real", baseRevision: 0, kind: "designer_schematic_edits", toolName: "designer_schematic_edits", title: "Edit", summary: "Edit", riskLevel: "destructive", operations: [], payload: {}, sources: [], warnings: [] }, outcome: null });
    await mount(); await until(() => view.writeProposals[0]?.designId === "design-real");
    await act(async () => { await view.proposalActions.allow("permission-proposal"); });
    expect(view.proposalActions.isAllowed("permission-proposal")).toBe(true);
    const grant = fixture.requests.find(request => request.url.pathname.endsWith("/permission-proposal/allow-session"));
    expect(grant!.body).toEqual({}); expect(fixture.mutationCount).toBe(0);
    await mount("chat-a", false); await mount();
    await until(() => view.proposalActions.isAllowed("permission-proposal"));
    await act(async () => { await view.proposalActions.revoke("permission-proposal"); });
    expect(view.proposalActions.isAllowed("permission-proposal")).toBe(false); expect(fixture.allowances.size).toBe(0);
    expect(fixture.requests.find(request => request.method === "DELETE")!.url.pathname).toContain("trusted%3Aallowance%3Akey");
  });
  test("approve precedes stable native apply; lost apply reconciles real receipts and partial errors", async () => {
    fixture.proposals.set("proposal-real", { id: "proposal-real", chatId: "chat-a", scopeKey: "design:design-real", toolName: "designer_schematic_edits", kind: "designer_schematic_edits", risk: "medium", status: "pending", warnings: [], truncated: false, createdAt: "2026-10-07" });
    fixture.presentations.set("proposal-real", { proposalId: "proposal-real", envelope: { id: "proposal-real", designId: "design-real", baseRevision: 6, kind: "designer_schematic_edits", toolName: "designer_schematic_edits", title: "Place capacitor", summary: "Native placement", riskLevel: "medium", operations: [], payload: {}, sources: [], warnings: [] }, outcome: null });
    await mount(); await until(() => view.writeProposals.length === 1 && view.writeProposals[0]?.designId === "design-real");
    fixture.loseNextApply = true;
    await act(async () => { await expect(view.proposalActions.apply("proposal-real")).rejects.toThrow("Retry"); });
    await act(async () => { await view.proposalActions.apply("proposal-real"); });
    expect(fixture.mutationCount).toBe(1);
    const actions = fixture.requests.filter(request => /\/(approve|apply)$/.test(request.url.pathname));
    expect(actions.map(request => request.url.pathname.split("/").at(-1))).toEqual(["approve", "apply", "apply"]);
    expect(actions.filter(request => request.url.pathname.endsWith("/apply")).map(request => request.body.operationId)).toEqual(["native:proposal-real", "native:proposal-real"]);
    expect(changed).toHaveBeenCalledWith({ kind: "applied", designId: "design-real", revision: 7 });
    await until(() => container.textContent?.includes("Fixture placement refused") === true);
    expect(container.textContent).toContain("command-real"); expect(container.textContent).toContain("part-real");
    expect(view.writeProposals[0]?.status).toBe("partial");
  });
});
