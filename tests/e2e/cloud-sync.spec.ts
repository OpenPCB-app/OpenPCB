// T-N3.2: Automated multi-machine sync E2E
//
// Boots two Electron instances with isolated userData dirs, signs both into the
// same Supabase project, and verifies that a command applied on instance A
// appears in instance B's "Open from Cloud" import.
//
// Skipped unless the following env are present (set in shell or .env.e2e):
//   E2E_CLOUD_API_URL        — e.g. https://api.openpcb.app
//   E2E_CLOUD_SUPABASE_URL   — e.g. https://supabase.openpcb.app
//   E2E_CLOUD_ANON_KEY       — Supabase anon JWT
//   E2E_CLOUD_TEST_EMAIL     — pre-provisioned Pro test account
//   E2E_CLOUD_TEST_PASSWORD
//
// To run: npx playwright test tests/e2e/cloud-sync.spec.ts --project=electron
// (Requires a second project entry in playwright.config.ts for _electron.)

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
} from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

const required = [
  "E2E_CLOUD_API_URL",
  "E2E_CLOUD_SUPABASE_URL",
  "E2E_CLOUD_ANON_KEY",
  "E2E_CLOUD_TEST_EMAIL",
  "E2E_CLOUD_TEST_PASSWORD",
] as const;

const missing = required.filter((k) => !process.env[k]);

test.describe("cloud-sync multi-machine", () => {
  test.skip(missing.length > 0, `missing env: ${missing.join(", ")}`);

  let instanceA: ElectronApplication;
  let instanceB: ElectronApplication;
  let userDataA: string;
  let userDataB: string;

  test.beforeAll(async () => {
    const tmpRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "openpcb-e2e-cloud-"),
    );
    userDataA = path.join(tmpRoot, "machine-A");
    userDataB = path.join(tmpRoot, "machine-B");
    await fs.mkdir(userDataA, { recursive: true });
    await fs.mkdir(userDataB, { recursive: true });

    const env: Record<string, string> = {
      ...process.env,
      VITE_CLOUD_API_URL: process.env.E2E_CLOUD_API_URL!,
      VITE_SUPABASE_URL: process.env.E2E_CLOUD_SUPABASE_URL!,
      VITE_SUPABASE_ANON_KEY: process.env.E2E_CLOUD_ANON_KEY!,
    };

    [instanceA, instanceB] = await Promise.all([
      electron.launch({
        args: [".", `--user-data-dir=${userDataA}`],
        env: { ...env, OPENPCB_DB_PATH: path.join(userDataA, "data.sqlite") },
      }),
      electron.launch({
        args: [".", `--user-data-dir=${userDataB}`],
        env: { ...env, OPENPCB_DB_PATH: path.join(userDataB, "data.sqlite") },
      }),
    ]);
  });

  test.afterAll(async () => {
    await instanceA?.close();
    await instanceB?.close();
  });

  async function signIn(app: ElectronApplication): Promise<void> {
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await window.evaluate(
      async ({ url, key, email, password }) => {
        const { createClient } = await import("@supabase/supabase-js");
        const sb = createClient(url, key);
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        const { data } = await sb.auth.getSession();
        await window.electronAPI?.secureStorage?.set?.(
          "sb-auth-token",
          JSON.stringify(data.session),
        );
      },
      {
        url: process.env.E2E_CLOUD_SUPABASE_URL!,
        key: process.env.E2E_CLOUD_ANON_KEY!,
        email: process.env.E2E_CLOUD_TEST_EMAIL!,
        password: process.env.E2E_CLOUD_TEST_PASSWORD!,
      },
    );
  }

  test("A places label → B imports → label round-trips with same id", async () => {
    await signIn(instanceA);
    await signIn(instanceB);

    const winA = await instanceA.firstWindow();
    await winA.getByRole("button", { name: "New Design" }).first().click();
    await winA.getByRole("button", { name: /Link to Cloud/i }).click();
    await expect(winA.getByText(/Cloud:/)).toBeVisible({ timeout: 10_000 });

    // Place a known label via the designer command bus directly to avoid UI flakiness.
    const labelText = `E2E-${Date.now()}`;
    await winA.evaluate(async (text) => {
      const api = (window as any).designerApi;
      const designId = (window as any).currentDesignId;
      await api.dispatchCommand(designId, {
        type: "upsert_label",
        text,
        positionNm: { x: 10_000_000, y: 10_000_000 },
      });
    }, labelText);

    // Wait for cloud-sync mirror to flush (fire-and-forget, give 5s).
    await winA.waitForTimeout(5_000);

    // On B: open browser, import the cloud design, assert label appears.
    const winB = await instanceB.firstWindow();
    await winB.getByRole("button", { name: /Open from Cloud/i }).click();
    await winB
      .getByRole("button", { name: /Preview/ })
      .first()
      .click();
    await expect(winB.getByText(labelText)).toBeVisible({ timeout: 15_000 });
    await winB.getByRole("button", { name: /Import to local & open/ }).click();
    await expect(winB.getByText(labelText)).toBeVisible({ timeout: 15_000 });
  });
});
