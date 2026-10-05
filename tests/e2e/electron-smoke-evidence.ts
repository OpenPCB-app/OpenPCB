import type { Page, TestInfo } from "@playwright/test";

type DiagnosticsPaths = {
  logs: string;
  crashDumps: string;
  userData: string;
  appVersion: string;
};

export async function getDiagnosticsPaths(
  page: Page,
): Promise<DiagnosticsPaths | null> {
  return page.evaluate(async () => {
    if (!window.electronAPI?.getDiagnosticsPaths) return null;
    return window.electronAPI.getDiagnosticsPaths();
  });
}

export async function attachElectronLogs(
  page: Page | null,
  testInfo: TestInfo,
): Promise<void> {
  if (!page) return;

  try {
    const diagnostics = await getDiagnosticsPaths(page);
    if (!diagnostics) return;

    await testInfo.attach("electron-diagnostics.json", {
      body: JSON.stringify(diagnostics, null, 2),
      contentType: "application/json",
    });

    // Electron's log directory can contain unrelated historical launches.
    await testInfo.attach("electron-window.png", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  } catch {
    // Best-effort diagnostics only; never mask the original failure.
  }
}

export async function attachHomeNameGeometry(
  page: Page,
  info: TestInfo,
  label: string,
): Promise<void> {
  const geometry = await page
    .getByText("Untitled Design", { exact: true })
    .evaluateAll((elements) =>
      elements.map((element) => {
        const chain = [];
        for (
          let current: Element | null = element;
          current && chain.length < 5;
          current = current.parentElement
        ) {
          const style = getComputedStyle(current);
          const bounds = current.getBoundingClientRect();
          chain.push({
            tag: current.tagName,
            className: current.className,
            bounds: {
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height,
            },
            display: style.display,
            visibility: style.visibility,
            overflow: style.overflow,
            gridTemplateColumns: style.gridTemplateColumns,
            minWidth: style.minWidth,
            width: style.width,
            flex: style.flex,
          });
        }
        return chain;
      }),
    );
  await info.attach(`${label}-home-name-geometry.json`, {
    body: JSON.stringify(geometry, null, 2),
    contentType: "application/json",
  });
}
