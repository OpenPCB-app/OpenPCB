// Inbound sync queries: read designs + projections from the Cloud Hono backend
// (cloud-api). Reads go through cloud-api HTTP endpoints (authz enforced in app
// code), NOT PostgREST — this keeps the desktop independent of Supabase's data
// API. The Supabase client is still used only to mint the session bearer token.
import { getSupabase } from "./supabase";
import { readCloudConfig } from "./config";

export interface CloudDesignSummary {
  id: string;
  name: string;
  revision: number;
  updatedAt?: string;
}

export interface CloudDesignDetail {
  id: string;
  name: string;
  revision: number;
  workspaceId: string;
}

// Cloud's projection_json mirrors desktop's DesignerSchematicProjection shape
// verbatim (nm units, arrays of entities). Keep this interface minimal — only
// the fields the importer reads.
export interface CloudProjectionPart {
  id: string;
  componentId: string;
  reference: string;
  value: string;
  positionNm: { x: number; y: number };
  rotationDeg: 0 | 90 | 180 | 270;
  mirrored: boolean;
}
export interface CloudProjectionWire {
  id: string;
  sourcePinId: string;
  targetPinId: string;
  pointsNm?: Array<{ x: number; y: number }>;
}
export interface CloudProjectionLabel {
  id: string;
  text: string;
  positionNm: { x: number; y: number };
}
export interface CloudProjection {
  parts: CloudProjectionPart[];
  wires: CloudProjectionWire[];
  labels: CloudProjectionLabel[];
}

async function authHeader(): Promise<Record<string, string>> {
  const sb = getSupabase();
  if (!sb) return {};
  const { data } = await sb.auth.getSession();
  const t = data.session?.access_token;
  return t ? { authorization: `Bearer ${t}` } : {};
}

async function get<T>(path: string): Promise<T> {
  const cfg = readCloudConfig();
  if (!cfg.enabled) throw new Error("Cloud not configured");
  const res = await fetch(`${cfg.apiUrl}${path}`, {
    headers: await authHeader(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cloud ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export async function listPersonalWorkspaceDesigns(): Promise<
  CloudDesignSummary[]
> {
  const ws = await get<{ id: string }>("/v1/workspaces/me/personal");
  const out = await get<{ designs: CloudDesignSummary[] }>(
    `/v1/designs/workspaces/${ws.id}`,
  );
  return out.designs;
}

export async function getCloudDesign(
  designId: string,
): Promise<CloudDesignDetail> {
  return get<CloudDesignDetail>(`/v1/designs/${designId}`);
}

// Read the live projection from cloud-api (GET /v1/designs/:id/projection).
// Ownership is enforced server-side in app code; no PostgREST/RLS dependency.
export async function getCloudProjection(
  designId: string,
): Promise<{ projection: CloudProjection; revision: number; name: string }> {
  const out = await get<{
    id: string;
    name: string;
    revision: number;
    projection: CloudProjection | null;
  }>(`/v1/designs/${designId}/projection`);
  return {
    projection: out.projection ?? { parts: [], wires: [], labels: [] },
    revision: out.revision,
    name: out.name,
  };
}
