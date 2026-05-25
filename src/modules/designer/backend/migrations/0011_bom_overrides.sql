create table if not exists designer_bom_overrides (
  id text primary key,
  design_id text not null references designer_design_heads(id) on delete cascade,
  refdes text not null,
  manufacturer text,
  manufacturer_part_number text,
  lcsc_part_number text,
  supplier text,
  unit_price_micros integer,
  currency text,
  dnp integer not null default 0,
  assembly_side text,
  notes text,
  created_at text not null,
  updated_at text not null,
  unique(design_id, refdes)
);

create index if not exists designer_bom_overrides_design_id_idx
  on designer_bom_overrides(design_id);
