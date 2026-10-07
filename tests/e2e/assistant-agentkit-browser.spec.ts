import { test, expect } from "./support/assistant-agentkit-fixture";
import type { Page } from "@playwright/test";

// Also applies when the default E2E config discovers this authenticated spec.
test.use({ trace: "off", video: "off" });

interface Projection { revision: number; parts: Array<{ id: string; componentId: string; reference: string }> }

async function newDesign(page: Page, origin: string): Promise<string> {
  await page.goto(origin);
  await expect(page.getByRole("heading", { name: "Designs" })).toBeVisible();
  const response = page.waitForResponse((res) => res.url().endsWith("/api/modules/designer/designs") && res.request().method() === "POST");
  await page.getByRole("button", { name: "New Design" }).first().click();
  const body = await (await response).json() as { data: { design: { id: string } } };
  await expect(page.getByRole("tab", { name: "Schem" })).toBeVisible();
  await page.getByTitle("Open the assistant (⌘/Ctrl+I)").click();
  await expect(page.getByPlaceholder("Ask about this design…")).toBeVisible();
  await expect(page.getByPlaceholder("Ask about this design…")).toBeEnabled();
  return body.data.design.id;
}

async function projection(page: Page, backend: string, designId: string): Promise<Projection> {
  const response = await page.request.get(`${backend}/api/modules/designer/designs/${designId}/projection/schematic`);
  expect(response.ok()).toBeTruthy();
  return (await response.json() as { data: { projection: Projection } }).data.projection;
}

test("Space and dock share authenticated native run, IDs, verification and Designer Undo", async ({ page, agentkit }) => {
  const designId = await newDesign(page, agentkit.origin);
  await page.getByPlaceholder("Ask about this design…").fill("Place two fixture capacitors in this design.");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  const submitted = page.waitForResponse((res) => /\/v1\/chats\/[^/]+\/messages$/.test(res.url()) && res.request().method() === "POST");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const accepted = await submitted;
  const result = await accepted.json() as { runId: string };
  await expect(page.getByText("Fixture placed C1 and C2. Native readback verified.", { exact: true })).toBeVisible();
  const placed = await projection(page, agentkit.bootstrap.url, designId);
  expect(placed.parts.map((part) => part.reference).sort()).toEqual(["C1", "C2"]);
  expect(new Set(placed.parts.map((part) => part.id)).size).toBe(2);
  expect(placed.parts.every((part) => part.componentId === agentkit.componentId)).toBeTruthy();
  await expect(page.getByText("Final verification: pass", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open in Assistant view" }).click();
  await expect(page.getByPlaceholder("Ask about your PCB, or describe what to build…")).toBeVisible();
  await expect(page.getByText("Fixture placed C1 and C2. Native readback verified.", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Final verification: pass", { exact: true })).toBeVisible();
  const request = page.request;
  const run = await request.get(`${agentkit.bootstrap.url}/api/modules/assistant/v1/runs/${result.runId}`,
    { headers: { "X-OpenPCB-Token": agentkit.bootstrap.token } });
  expect(run.ok()).toBeTruthy();
  expect((await run.json() as { status: string }).status).toBe("completed");
  await page.getByRole("button", { name: "Designer", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(async () => (await projection(page, agentkit.bootstrap.url, designId)).parts.length).toBe(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(async () => (await projection(page, agentkit.bootstrap.url, designId)).parts.length).toBe(0);
});

test("Active run reconnects across Space/dock remount and reload, then Stop cancels it", async ({ page, agentkit }) => {
  await newDesign(page, agentkit.origin);
  await page.getByPlaceholder("Ask about this design…").fill("Keep streaming until I press Stop.");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  const submitted = page.waitForResponse((res) => /\/v1\/chats\/[^/]+\/messages$/.test(res.url()) && res.request().method() === "POST");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const result = await (await submitted).json() as { runId: string };
  await expect(page.getByRole("button", { name: "Stop generating", exact: true })).toBeVisible();
  await expect(page.getByText("Fixture waiting for Stop.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open in Assistant view" }).click();
  await expect(page.getByRole("button", { name: "Stop generating", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Designs" })).toBeVisible();
  await page.getByRole("button", { name: "Designer", exact: true }).first().click();
  await expect(page.getByRole("tab", { name: "Schem" })).toBeVisible();
  await page.getByTitle("Open the assistant (⌘/Ctrl+I)").click();
  await expect(page.getByRole("button", { name: "Stop generating", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop generating", exact: true }).click();
  await expect.poll(async () => {
    const response = await page.request.get(`${agentkit.bootstrap.url}/api/modules/assistant/v1/runs/${result.runId}`,
      { headers: { "X-OpenPCB-Token": agentkit.bootstrap.token } });
    return (await response.json() as { status: string }).status;
  }).toBe("cancelled");
  await expect(page.getByRole("button", { name: "Stop generating", exact: true })).toHaveCount(0);
  await expect(page.getByText("Keep streaming until I press Stop.", { exact: true })).toHaveCount(1);
});
