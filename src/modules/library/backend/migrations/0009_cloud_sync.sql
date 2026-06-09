-- Desktop-local sync state for the custom-component cloud library.
-- Mirrors designer's `designer_cloud_link` semantics. Single row (id='default')
-- — the desktop has one custom library that syncs to the user's personal
-- cloud workspace. The user's bearer token is never stored (passed per-request
-- via x-cloud-bearer headers, like the designer sync).
create table if not exists library_cloud_sync (
  id                  text primary key,
  cloud_workspace_id  text,
  last_pack_id        text,
  last_package_sha256 text,
  component_count     integer not null default 0,
  last_synced_at      text,
  failed_attempts     integer not null default 0,
  last_error          text
);
