// Workspace-library cloud-sync wire contract (desktop ↔ cloud-api).
//
// Custom components sync as an `.opclib` package (see @openpcb/opclib-pack):
// the desktop packs its custom components (3D models bundled in the archive),
// uploads the bytes to cloud-api, which stores the archive in Supabase Storage
// (user-assets bucket) and indexes the manifest. Pull = download the archive +
// unpack via the existing opclib importer.
//
// This file is mirrored verbatim in cloud-api
// (src/modules/library/cloud-sync-types.ts). Promote to @openpcb/contracts when
// the shared-package release cadence allows.

/** One custom component as indexed in the cloud (content-addressed). */
export interface WorkspaceLibraryComponentRef {
  uuid: string;
  name: string;
  version: string;
  category: string | null;
  contentSha256: string;
}

/** An uploaded `.opclib` snapshot of a workspace's custom library. */
export interface WorkspaceLibraryPackSummary {
  packId: string;
  version: string;
  packageSha256: string;
  componentCount: number;
  createdAt: string;
  components: WorkspaceLibraryComponentRef[];
}

export interface UploadWorkspaceLibraryPackResponse {
  pack: WorkspaceLibraryPackSummary;
}

export interface ListWorkspaceLibraryResponse {
  packs: WorkspaceLibraryPackSummary[];
}

/** Signed URL to fetch a stored `.opclib` archive directly from Storage. */
export interface DownloadWorkspaceLibraryPackResponse {
  url: string;
  packageSha256: string;
}

/**
 * Desktop-local sync state for the custom library, persisted in
 * `library_cloud_sync` (mirrors designer's `designer_cloud_link` semantics).
 */
export interface LibraryCloudSyncState {
  lastSyncedPackId: string | null;
  lastSyncedPackSha256: string | null;
  lastSyncedAt: string | null;
  failedAttempts: number;
  lastError: string | null;
}
