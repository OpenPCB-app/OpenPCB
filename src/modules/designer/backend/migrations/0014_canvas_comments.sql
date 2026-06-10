create table if not exists designer_comment_threads (
  id text primary key,
  design_id text not null references designer_design_heads(id) on delete cascade,
  surface text not null check (surface in ('schematic', 'pcb', 'design')),
  anchor_json text,
  status text not null default 'open' check (status in ('open', 'resolved', 'archived')),
  todo_status text not null default 'none' check (todo_status in ('none', 'todo', 'in_progress', 'done')),
  title text,
  created_by text,
  created_at text not null,
  updated_at text not null,
  last_message_at text,
  message_count integer not null default 0,
  revision integer not null default 0,
  sync_state text not null default 'local' check (sync_state in ('local', 'pending', 'synced', 'failed', 'conflict')),
  deleted_at text
);
--> statement-breakpoint
create index if not exists designer_comment_threads_design_id_idx
  on designer_comment_threads(design_id);
--> statement-breakpoint
create index if not exists designer_comment_threads_design_surface_idx
  on designer_comment_threads(design_id, surface);
--> statement-breakpoint
create table if not exists designer_comment_messages (
  id text primary key,
  design_id text not null references designer_design_heads(id) on delete cascade,
  thread_id text not null references designer_comment_threads(id) on delete cascade,
  kind text not null default 'user' check (kind in ('user', 'system', 'assistant')),
  body text,
  mentions_json text not null default '[]',
  created_by text,
  created_at text not null,
  updated_at text not null,
  edited_at text,
  deleted_at text,
  revision integer not null default 0
);
--> statement-breakpoint
create index if not exists designer_comment_messages_thread_id_idx
  on designer_comment_messages(thread_id);
--> statement-breakpoint
create index if not exists designer_comment_messages_design_id_idx
  on designer_comment_messages(design_id);
--> statement-breakpoint
create table if not exists designer_comment_attachments (
  id text primary key,
  design_id text not null references designer_design_heads(id) on delete cascade,
  thread_id text not null references designer_comment_threads(id) on delete cascade,
  message_id text references designer_comment_messages(id) on delete set null,
  file_name text not null,
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  byte_size integer not null check (byte_size <= 5242880),
  local_path text,
  storage_key text,
  created_at text not null,
  deleted_at text
);
--> statement-breakpoint
create index if not exists designer_comment_attachments_thread_id_idx
  on designer_comment_attachments(thread_id);
--> statement-breakpoint
create index if not exists designer_comment_attachments_message_id_idx
  on designer_comment_attachments(message_id);
--> statement-breakpoint
create table if not exists designer_comment_outbox (
  command_id text primary key,
  design_id text not null references designer_design_heads(id) on delete cascade,
  thread_id text,
  base_revision integer,
  command_type text not null,
  command_json text not null,
  status text not null default 'pending' check (status in ('pending', 'synced', 'failed', 'conflict')),
  attempts integer not null default 0,
  last_error text,
  created_at text not null,
  updated_at text not null,
  synced_at text
);
--> statement-breakpoint
create index if not exists designer_comment_outbox_status_idx
  on designer_comment_outbox(status);
--> statement-breakpoint
create index if not exists designer_comment_outbox_design_id_idx
  on designer_comment_outbox(design_id);
