create table if not exists designer_comment_reactions (
  id text primary key,
  design_id text not null references designer_design_heads(id) on delete cascade,
  thread_id text not null references designer_comment_threads(id) on delete cascade,
  message_id text not null references designer_comment_messages(id) on delete cascade,
  emoji text not null,
  created_by text,
  created_at text not null,
  deleted_at text
);
--> statement-breakpoint
create index if not exists designer_comment_reactions_message_id_idx
  on designer_comment_reactions(message_id);
--> statement-breakpoint
create index if not exists designer_comment_reactions_thread_id_idx
  on designer_comment_reactions(thread_id);
