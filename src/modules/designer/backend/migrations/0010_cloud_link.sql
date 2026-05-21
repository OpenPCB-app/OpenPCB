create table if not exists designer_cloud_link (
  design_id text primary key references designer_design_heads(id) on delete cascade,
  cloud_design_id text not null,
  cloud_workspace_id text not null,
  cloud_user_id text not null,
  last_synced_revision integer not null default -1,
  linked_at text not null,
  failed_attempts integer not null default 0,
  last_error text
);

create index if not exists idx_designer_cloud_link_cloud_id
  on designer_cloud_link(cloud_design_id);
