// Inbound sync queries: read designs + projections from Cloud Hono backend.
// All authed via the Supabase session bearer token (set on every request).
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

export interface CloudPubComponentRow {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  tags: string[];
}

export interface CloudPubComponentVersionRow {
  id: string;
  componentId: string;
  channel: string;
  version: string;
  manifest: Record<string, unknown>;
}

export interface CloudCommandLogEntry {
  commandId: string;
  designId: string;
  sessionId: string;
  userId: string;
  appliedRevision: number;
  commandType: string;
  commandJson: unknown;
  forwardPatches: unknown;
  issuedAt: string;
  appliedAt: string;
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

// Read projection_json + command log directly from PostgREST (RLS-gated).
export async function getCloudProjection(
  designId: string,
): Promise<{ projection: CloudProjection; revision: number; name: string }> {
  const sb = getSupabase();
  if (!sb) throw new Error("Cloud not configured");
  const { data, error } = await sb
    .from("design")
    .select("id, name, revision, projection_json")
    .eq("id", designId)
    .single();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Cloud design ${designId} not found`);
  const row = data as unknown as {
    id: string;
    name: string;
    revision: number;
    projection_json: CloudProjection;
  };
  return {
    projection: row.projection_json ?? { parts: [], wires: [], labels: [] },
    revision: row.revision,
    name: row.name,
  };
}

// Fetch a single cloud library component-version by component id. Used by the
// import-from-cloud flow to auto-pull missing components into the local
// library before placing them.
export async function fetchCloudComponentVersion(
  componentId: string,
  channel = "stable",
  version = "1.0.0",
): Promise<CloudPubComponentVersionRow | null> {
  const sb = getSupabase();
  if (!sb) throw new Error("Cloud not configured");
  const { data, error } = await sb
    .from("pub_component_version")
    .select("id, componentId:component_id, channel, version, manifest")
    .eq("component_id", componentId)
    .eq("channel", channel)
    .eq("version", version)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as CloudPubComponentVersionRow) ?? null;
}

export async function getCloudCommandLog(
  designId: string,
  sinceRevision = 0,
): Promise<CloudCommandLogEntry[]> {
  const sb = getSupabase();
  if (!sb) throw new Error("Cloud not configured");
  const { data, error } = await sb
    .from("design_command")
    .select(
      "command_id, design_id, session_id, user_id, applied_revision, command_type, command_json, forward_patches, issued_at, applied_at",
    )
    .eq("design_id", designId)
    .gt("applied_revision", sinceRevision)
    .order("applied_revision", { ascending: true });
  if (error) throw new Error(error.message);
  if (!data) return [];
  return (data as unknown as Record<string, unknown>[]).map((r) => ({
    commandId: String(r.command_id),
    designId: String(r.design_id),
    sessionId: String(r.session_id),
    userId: String(r.user_id),
    appliedRevision: Number(r.applied_revision),
    commandType: String(r.command_type),
    commandJson: r.command_json,
    forwardPatches: r.forward_patches,
    issuedAt: String(r.issued_at),
    appliedAt: String(r.applied_at),
  }));
}
