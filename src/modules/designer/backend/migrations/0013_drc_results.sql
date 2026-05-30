create table if not exists designer_drc_results (
  design_id text primary key references designer_design_heads(id) on delete cascade,
  ran_at_revision integer not null,
  ran_at text not null,
  error_count integer not null,
  warning_count integer not null,
  info_count integer not null,
  violations_json text not null,
  options_json text not null default '{}',
  created_at text not null,
  updated_at text not null
);
