import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { commentAttachmentResponse } from "./attachment-response";

test("desktop Node serves exact binary comment attachment with existing private cache headers", async () => {
  assert.equal("Bun" in globalThis, false);
  const directory = await mkdtemp(join(tmpdir(), "openpcb-comment-attachment-"));
  try {
    const bytes = Uint8Array.from([0, 255, 80, 67, 66]);
    const file = join(directory, "attachment.bin");
    await writeFile(file, bytes);
    const response = await commentAttachmentResponse(file, "image/png");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
    assert.equal(response.headers.get("Content-Type"), "image/png");
    assert.equal(response.headers.get("Cache-Control"), "private, max-age=86400");
    await assert.rejects(commentAttachmentResponse(join(directory, "absent"), "image/png"), { code: "ENOENT" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
