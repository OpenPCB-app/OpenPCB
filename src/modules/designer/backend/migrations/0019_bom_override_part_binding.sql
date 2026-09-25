-- 0019_bom_override_part_binding.sql
--
-- A BOM override (DNP, MPN, LCSC, price, notes…) belongs to a PART, not to a
-- reference designator: a refdes rename — and the undo/redo of one, which
-- replays ECS patches without running any command handler — must not drop it.
-- Rows gain `part_id` (the schematic part id, which is also the placement's
-- partId). `refdes` stays as the reference at the last write and is the match
-- key only for an unbound row (part_id null).
--
-- unique(design_id, refdes) has to go: a renamed part's bound row keeps its old
-- refdes, which another part may now carry. SQLite cannot drop an inline
-- constraint, so the table is rebuilt (precedent: assistant 0005). Existing
-- rows are bound to the part that carries their refdes today.
create table designer_bom_overrides_next (
  id text primary key,
  design_id text not null references designer_design_heads(id) on delete cascade,
  part_id text,
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
  updated_at text not null
);
--> statement-breakpoint
insert into designer_bom_overrides_next (
  id,
  design_id,
  part_id,
  refdes,
  manufacturer,
  manufacturer_part_number,
  lcsc_part_number,
  supplier,
  unit_price_micros,
  currency,
  dnp,
  assembly_side,
  notes,
  created_at,
  updated_at
)
select
  o.id,
  o.design_id,
  (
    select p.id
    from designer_schematic_parts p
    where p.design_id = o.design_id and p.reference = o.refdes
    limit 1
  ),
  o.refdes,
  o.manufacturer,
  o.manufacturer_part_number,
  o.lcsc_part_number,
  o.supplier,
  o.unit_price_micros,
  o.currency,
  o.dnp,
  o.assembly_side,
  o.notes,
  o.created_at,
  o.updated_at
from designer_bom_overrides o;
--> statement-breakpoint
drop table designer_bom_overrides;
--> statement-breakpoint
alter table designer_bom_overrides_next rename to designer_bom_overrides;
--> statement-breakpoint
create index designer_bom_overrides_design_id_idx
  on designer_bom_overrides(design_id);
--> statement-breakpoint
create unique index designer_bom_overrides_design_part_uq
  on designer_bom_overrides(design_id, part_id);
--> statement-breakpoint
create unique index designer_bom_overrides_design_ref_unbound_uq
  on designer_bom_overrides(design_id, refdes)
  where part_id is null;
