import { expect, test, type Page } from "@playwright/test";

type HarnessFixture = "base" | "base-altered";

type StateHashArtifact = {
  scenarioId: string;
  fixture: HarnessFixture | "drag-wiring" | "medium-hardening";
  algorithm: "sha256";
  hash: string;
};

const DETERMINISM_SEED = "schematic-determinism-seed-v1";
const CANONICAL_SCENARIO_ID = "canonical-replay-v1";

async function gotoHarness(page: Page, fixture: HarnessFixture) {
  const query = new URLSearchParams({
    e2e: "schematic",
    fixture,
    seed: DETERMINISM_SEED,
    scenario: CANONICAL_SCENARIO_ID,
  });

  await page.goto(`/?${query.toString()}`);
  await expect(page.getByText("Schematic E2E")).toBeVisible();
  await expect(page.getByTestId("e2e-session")).toHaveText("none");
}

async function readStateHashArtifact(page: Page): Promise<StateHashArtifact> {
  await expect(page.getByTestId("e2e-state-hash")).toHaveText(
    /^[a-f0-9]{64}$/,
  );

  const raw = await page.getByTestId("e2e-state-hash-artifact").textContent();
  if (!raw) {
    throw new Error("missing state hash artifact payload");
  }

  const artifact = JSON.parse(raw) as StateHashArtifact;
  expect(artifact.algorithm).toBe("sha256");
  expect(artifact.scenarioId).toBe(CANONICAL_SCENARIO_ID);
  expect(artifact.hash).toMatch(/^[a-f0-9]{64}$/);
  return artifact;
}

async function runCanonicalReplayAndReadHash(
  page: Page,
): Promise<StateHashArtifact> {
  await expect(page.getByTestId("e2e-replay-canonical")).toBeVisible();
  await page.getByTestId("e2e-replay-canonical").click();

  await expect(page.getByTestId("e2e-symbols")).toHaveText("3");
  await expect(page.getByTestId("e2e-wires")).toHaveText("1");
  await expect(page.getByTestId("e2e-session")).toHaveText("none");

  return readStateHashArtifact(page);
}

function assertStateHashMatches(
  artifact: StateHashArtifact,
  expectedHash: string,
) {
  if (artifact.hash !== expectedHash) {
    throw new Error(
      `State hash mismatch for scenario ${artifact.scenarioId}: expected ${expectedHash}, got ${artifact.hash}`,
    );
  }
}

test.describe.configure({ mode: "serial" });

test.describe("schematic determinism replay", () => {
  test("canonical replay yields identical state hash for repeated seeded runs", async ({
    page,
  }) => {
    await gotoHarness(page, "base");
    const firstRun = await runCanonicalReplayAndReadHash(page);

    await gotoHarness(page, "base");
    const secondRun = await runCanonicalReplayAndReadHash(page);

    expect(firstRun.fixture).toBe("base");
    expect(secondRun.fixture).toBe("base");
    expect(firstRun.hash).toBe(secondRun.hash);
  });

  test("mismatch path fails when altered fixture hash is validated against canonical hash", async ({
    page,
  }) => {
    await gotoHarness(page, "base");
    const canonical = await runCanonicalReplayAndReadHash(page);

    await gotoHarness(page, "base-altered");
    const altered = await readStateHashArtifact(page);
    expect(altered.fixture).toBe("base-altered");

    expect(() => assertStateHashMatches(altered, canonical.hash)).toThrow(
      /State hash mismatch/,
    );
  });
});
