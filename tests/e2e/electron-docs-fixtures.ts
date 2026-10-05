import { expect, type Locator, type Route } from "@playwright/test";
import type { NativeSession } from "./electron-native-helpers";

type DocumentContent = {
  engine: "tiptap";
  version: number;
  data: {
    type: "doc";
    content: Array<{
      type: "paragraph";
      content?: Array<{ type: "text"; text: string }>;
    }>;
  };
};
export type NativeDocument = {
  id: string;
  title: string;
  revision: number;
  updated_at: string;
  content_json: DocumentContent;
};
const modifier = process.platform === "darwin" ? "Meta" : "Control";

export function documentContent(text: string): DocumentContent {
  return {
    engine: "tiptap",
    version: 1,
    data: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          ...(text ? { content: [{ type: "text", text }] } : {}),
        },
      ],
    },
  };
}

export function documentText(document: NativeDocument): string {
  return document.content_json.data.content
    .map(
      (paragraph) => paragraph.content?.map((node) => node.text).join("") ?? "",
    )
    .join("\n");
}

export function documentUrl(
  session: NativeSession,
  id: string,
  suffix = "",
): string {
  return `${session.backend}/api/modules/knowledge/pages/${id}${suffix}`;
}

export async function readDocument(
  session: NativeSession,
  id: string,
): Promise<NativeDocument> {
  const response = await fetch(documentUrl(session, id));
  expect(response.ok, `Read isolated page ${id}: ${response.status}`).toBe(
    true,
  );
  const data = (await response.json()) as { page: NativeDocument };
  return data.page;
}

export async function seedDocument(
  session: NativeSession,
  title: string,
  text: string,
): Promise<NativeDocument> {
  const response = await fetch(
    `${session.backend}/api/modules/knowledge/pages`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspace_id: "default",
        title,
        content: documentContent(text),
      }),
    },
  );
  expect(
    response.status,
    "Fixture POST executes once against the isolated native backend",
  ).toBe(201);
  return ((await response.json()) as { page: NativeDocument }).page;
}

export async function remoteWrite(
  session: NativeSession,
  id: string,
  field: "meta" | "content",
  value: string,
): Promise<void> {
  const response = await fetch(documentUrl(session, id, `/${field}`), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      field === "meta" ? { title: value } : documentContent(value),
    ),
  });
  expect(
    response.ok,
    `Remote ${field} fixture executes once: ${response.status}`,
  ).toBe(true);
}

export function editor(session: NativeSession): Locator {
  return session.page.locator(".tiptap[contenteditable='true']");
}

export async function openDocs(
  session: NativeSession,
  title: string,
): Promise<void> {
  await session.page.getByRole("button", { name: "Docs", exact: true }).click();
  await selectDocument(session, title);
}

export async function selectDocument(
  session: NativeSession,
  title: string,
): Promise<void> {
  await session.page.getByText(title, { exact: true }).click();
  await expect(
    session.page.getByRole("textbox", { name: "Page title" }),
  ).toHaveValue(title);
  await expect(editor(session)).toBeVisible();
}

export async function typeTitle(
  session: NativeSession,
  title: string,
): Promise<void> {
  await session.page.getByRole("textbox", { name: "Page title" }).click();
  await session.page.keyboard.press(`${modifier}+A`);
  if (!title) await session.page.keyboard.press("Backspace");
  await session.page.keyboard.type(title, { delay: 15 });
  await session.page.keyboard.press("Tab");
}

export async function typeBody(
  session: NativeSession,
  text: string,
): Promise<void> {
  await editor(session).click();
  await session.page.keyboard.press(`${modifier}+A`);
  await session.page.keyboard.type(text, { delay: 15 });
}

export async function undoBody(session: NativeSession): Promise<void> {
  await editor(session).click();
  await session.page.keyboard.press(`${modifier}+Z`);
}

export async function expectSaved(
  session: NativeSession,
  id: string,
  title: string,
  text: string,
): Promise<void> {
  await expect(
    session.page.getByRole("status").filter({ hasText: /^Saved$/ }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    session.page.getByRole("textbox", { name: "Page title" }),
  ).toHaveValue(title);
  await expect(editor(session)).toHaveText(text);
  const stored = await readDocument(session, id);
  expect(stored.title).toBe(title);
  expect(documentText(stored)).toBe(text);
}

export async function expectNoOpeningWrites(
  session: NativeSession,
  document: NativeDocument,
): Promise<void> {
  // Wait past both autosave debounce intervals to detect hydration-triggered writes.
  await session.page.waitForTimeout(900);
  expect(
    session.patches.filter((entry) =>
      entry.url.startsWith(documentUrl(session, document.id)),
    ),
  ).toEqual([]);
  expect((await readDocument(session, document.id)).revision).toBe(
    document.revision,
  );
}

export async function rejectBodySaves(
  session: NativeSession,
  id: string,
): Promise<() => Promise<void>> {
  const url = documentUrl(session, id, "/content");
  session.expectedResourceFailures.push({
    url,
    text: "Failed to load resource: the server responded with a status of 500 (Internal Server Error)",
  });
  const handler = async (route: Route): Promise<void> => {
    if (route.request().method() !== "PATCH") return route.continue();
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "NATIVE_QA_INJECTED_500" }),
    });
  };
  await session.page.route(url, handler);
  return () => session.page.unroute(url, handler);
}

export async function holdFirstMetadataSave(
  session: NativeSession,
  id: string,
  field: "meta" | "content" = "meta",
): Promise<{
  entered: Promise<void>;
  release: () => void;
  remove: () => Promise<void>;
}> {
  let enter: () => void = () => {};
  let release: () => void = () => {};
  let held = false;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const url = documentUrl(session, id, `/${field}`);
  const handler = async (route: Route): Promise<void> => {
    if (route.request().method() === "PATCH" && !held) {
      held = true;
      enter();
      await released;
    }
    await route.continue();
  };
  await session.page.route(url, handler);
  return { entered, release, remove: () => session.page.unroute(url, handler) };
}

export async function seedPdf(
  session: NativeSession,
): Promise<{ id: string; title: string }> {
  const stream = "BT /F1 16 Tf 30 100 Td (Native PDF fixture) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 180] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = Buffer.from(pdf);
  await session.info.attach("native-fixture.pdf", {
    body: bytes,
    contentType: "application/pdf",
  });
  const data = new FormData();
  data.set(
    "file",
    new Blob([bytes], { type: "application/pdf" }),
    "Native fixture.pdf",
  );
  data.set("workspace_id", "default");
  const response = await fetch(
    `${session.backend}/api/modules/knowledge/pages/import/pdf`,
    { method: "POST", body: data },
  );
  expect(response.status, "Real PDF import executes once").toBe(201);
  return ((await response.json()) as { page: { id: string; title: string } })
    .page;
}
