import { readFile } from "node:fs/promises";

/** Use the desktop Node runtime as well as the development runtime. */
export async function commentAttachmentResponse(localPath: string, mimeType: string): Promise<Response> {
  return new Response(new Uint8Array(await readFile(localPath)), {
    headers: { "Content-Type": mimeType, "Cache-Control": "private, max-age=86400" },
  });
}
