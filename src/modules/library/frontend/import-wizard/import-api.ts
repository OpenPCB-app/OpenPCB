import type { FootprintRenderSource } from "../../../../shared/rendering/types";
import type { GeneratedFootprintMetadata } from "../../../../shared/rendering/ipc7351b";
import type {
  CommitKicadRequest,
  CommitKicadResponse,
  InspectKicadRequest,
  InspectKicadResponse,
} from "../../contracts/import";
import { toUserError } from "../utils";

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function inspectKicadImport(
  backendURL: string,
  moduleId: string,
  body: InspectKicadRequest,
  signal: AbortSignal,
): Promise<InspectKicadResponse> {
  const inspectUrl = `${backendURL}/api/modules/${moduleId}/imports/kicad/inspect`;
  const response = await fetch(inspectUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const payload = (await parseJson(response)) as {
    ok?: boolean;
    data?: InspectKicadResponse;
    error?: string;
  };
  if (!response.ok || !payload?.ok || !payload.data) {
    throw new Error(
      toUserError(payload, `Inspect failed (HTTP ${response.status})`),
    );
  }
  return payload.data;
}

export async function commitKicadImportRequest(
  backendURL: string,
  moduleId: string,
  body: CommitKicadRequest,
  signal: AbortSignal,
): Promise<CommitKicadResponse> {
  const commitUrl = `${backendURL}/api/modules/${moduleId}/imports/kicad`;
  const response = await fetch(commitUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const payload = (await parseJson(response)) as {
    ok?: boolean;
    data?: CommitKicadResponse;
    error?: string;
  };
  if (!response.ok || !payload?.ok || !payload.data) {
    throw new Error(
      toUserError(payload, `Import failed (HTTP ${response.status})`),
    );
  }
  return payload.data;
}

export interface CommitGeneratedBody {
  symbolLibrary: { fileName: string; content: string };
  selection: { symbolId: string };
  generatedFootprint: {
    source: FootprintRenderSource;
    metadata: GeneratedFootprintMetadata;
  };
  component: { name: string; description: string };
}

export async function commitGeneratedImportRequest(
  backendURL: string,
  moduleId: string,
  body: CommitGeneratedBody,
  signal: AbortSignal,
): Promise<CommitKicadResponse> {
  const url = `${backendURL}/api/modules/${moduleId}/imports/generated`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const payload = (await parseJson(response)) as {
    ok?: boolean;
    data?: CommitKicadResponse;
    error?: string;
  };
  if (!response.ok || !payload?.ok || !payload.data) {
    throw new Error(
      toUserError(payload, `Generated import failed (HTTP ${response.status})`),
    );
  }
  return payload.data;
}
