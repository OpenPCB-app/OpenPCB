-- 0006_legacy_builtin_id_migration.sql
-- Rewrite legacy builtin:* identifiers to canonical openpcb.core.* ids.

UPDATE library_components
SET id = 'openpcb.core.passive.resistor'
WHERE id = 'builtin:resistor';

UPDATE library_components
SET id = 'openpcb.core.passive.capacitor'
WHERE id = 'builtin:capacitor';

UPDATE library_component_footprints
SET component_id = 'openpcb.core.passive.resistor'
WHERE component_id = 'builtin:resistor';

UPDATE library_component_footprints
SET component_id = 'openpcb.core.passive.capacitor'
WHERE component_id = 'builtin:capacitor';

UPDATE library_symbols
SET id = 'openpcb.core.symbol.passive.resistor'
WHERE id = 'builtin:sym:resistor';

UPDATE library_symbols
SET id = 'openpcb.core.symbol.passive.capacitor'
WHERE id = 'builtin:sym:capacitor';

UPDATE library_footprints
SET id = 'openpcb.core.footprint.passive.r-0402'
WHERE id = 'builtin:fp:r-0402-1005m';

UPDATE library_footprints
SET id = 'openpcb.core.footprint.passive.r-0603'
WHERE id = 'builtin:fp:r-0603-1608m';

UPDATE library_footprints
SET id = 'openpcb.core.footprint.passive.r-0805'
WHERE id = 'builtin:fp:r-0805-2012m';

UPDATE library_footprints
SET id = 'openpcb.core.footprint.passive.r-1206'
WHERE id = 'builtin:fp:r-1206-3216m';

UPDATE library_footprints
SET id = 'openpcb.core.footprint.passive.r-1210'
WHERE id = 'builtin:fp:r-1210-3225m';

UPDATE library_footprints
SET id = 'openpcb.core.footprint.passive.r-2512'
WHERE id = 'builtin:fp:r-2512-6332m';

UPDATE library_footprints
SET id = 'openpcb.core.footprint.passive.r-axial-din0207-p7-62'
WHERE id = 'builtin:fp:r-axial-din0207-p7.62';

UPDATE library_footprints
SET id = 'openpcb.core.footprint.passive.r-axial-din0207-p10-16'
WHERE id = 'builtin:fp:r-axial-din0207-p10.16';

UPDATE library_footprints
SET id = 'openpcb.core.footprint.passive.r-axial-din0309-p12-70'
WHERE id = 'builtin:fp:r-axial-din0309-p12.70';

UPDATE library_footprints
SET id = 'openpcb.core.footprint.passive.c-0402'
WHERE id = 'builtin:fp:c-0402-1005m';

UPDATE library_footprints
SET id = 'openpcb.core.footprint.passive.c-0603'
WHERE id = 'builtin:fp:c-0603-1608m';

UPDATE library_footprints
SET id = 'openpcb.core.footprint.passive.c-0805'
WHERE id = 'builtin:fp:c-0805-2012m';

UPDATE library_footprints
SET id = 'openpcb.core.footprint.passive.c-1206'
WHERE id = 'builtin:fp:c-1206-3216m';

UPDATE library_footprints
SET id = 'openpcb.core.footprint.passive.c-1210'
WHERE id = 'builtin:fp:c-1210-3225m';

UPDATE library_footprints
SET id = 'openpcb.core.footprint.passive.c-disc-d3-p2-5'
WHERE id = 'builtin:fp:c-disc-d3-p2.5';

UPDATE library_footprints
SET id = 'openpcb.core.footprint.passive.c-disc-d5-p5'
WHERE id = 'builtin:fp:c-disc-d5-p5';

UPDATE library_footprints
SET id = 'openpcb.core.footprint.passive.c-disc-d7-5-p5'
WHERE id = 'builtin:fp:c-disc-d7.5-p5';

UPDATE library_component_footprints
SET footprint_id = 'openpcb.core.footprint.passive.r-0402'
WHERE footprint_id = 'builtin:fp:r-0402-1005m';

UPDATE library_component_footprints
SET footprint_id = 'openpcb.core.footprint.passive.r-0603'
WHERE footprint_id = 'builtin:fp:r-0603-1608m';

UPDATE library_component_footprints
SET footprint_id = 'openpcb.core.footprint.passive.r-0805'
WHERE footprint_id = 'builtin:fp:r-0805-2012m';

UPDATE library_component_footprints
SET footprint_id = 'openpcb.core.footprint.passive.r-1206'
WHERE footprint_id = 'builtin:fp:r-1206-3216m';

UPDATE library_component_footprints
SET footprint_id = 'openpcb.core.footprint.passive.r-1210'
WHERE footprint_id = 'builtin:fp:r-1210-3225m';

UPDATE library_component_footprints
SET footprint_id = 'openpcb.core.footprint.passive.r-2512'
WHERE footprint_id = 'builtin:fp:r-2512-6332m';

UPDATE library_component_footprints
SET footprint_id = 'openpcb.core.footprint.passive.r-axial-din0207-p7-62'
WHERE footprint_id = 'builtin:fp:r-axial-din0207-p7.62';

UPDATE library_component_footprints
SET footprint_id = 'openpcb.core.footprint.passive.r-axial-din0207-p10-16'
WHERE footprint_id = 'builtin:fp:r-axial-din0207-p10.16';

UPDATE library_component_footprints
SET footprint_id = 'openpcb.core.footprint.passive.r-axial-din0309-p12-70'
WHERE footprint_id = 'builtin:fp:r-axial-din0309-p12.70';

UPDATE library_component_footprints
SET footprint_id = 'openpcb.core.footprint.passive.c-0402'
WHERE footprint_id = 'builtin:fp:c-0402-1005m';

UPDATE library_component_footprints
SET footprint_id = 'openpcb.core.footprint.passive.c-0603'
WHERE footprint_id = 'builtin:fp:c-0603-1608m';

UPDATE library_component_footprints
SET footprint_id = 'openpcb.core.footprint.passive.c-0805'
WHERE footprint_id = 'builtin:fp:c-0805-2012m';

UPDATE library_component_footprints
SET footprint_id = 'openpcb.core.footprint.passive.c-1206'
WHERE footprint_id = 'builtin:fp:c-1206-3216m';

UPDATE library_component_footprints
SET footprint_id = 'openpcb.core.footprint.passive.c-1210'
WHERE footprint_id = 'builtin:fp:c-1210-3225m';

UPDATE library_component_footprints
SET footprint_id = 'openpcb.core.footprint.passive.c-disc-d3-p2-5'
WHERE footprint_id = 'builtin:fp:c-disc-d3-p2.5';

UPDATE library_component_footprints
SET footprint_id = 'openpcb.core.footprint.passive.c-disc-d5-p5'
WHERE footprint_id = 'builtin:fp:c-disc-d5-p5';

UPDATE library_component_footprints
SET footprint_id = 'openpcb.core.footprint.passive.c-disc-d7-5-p5'
WHERE footprint_id = 'builtin:fp:c-disc-d7.5-p5';

UPDATE library_components
SET symbol_id = 'openpcb.core.symbol.passive.resistor'
WHERE symbol_id = 'builtin:sym:resistor';

UPDATE library_components
SET symbol_id = 'openpcb.core.symbol.passive.capacitor'
WHERE symbol_id = 'builtin:sym:capacitor';

UPDATE library_components
SET footprint_id = 'openpcb.core.footprint.passive.r-0402'
WHERE footprint_id = 'builtin:fp:r-0402-1005m';

UPDATE library_components
SET footprint_id = 'openpcb.core.footprint.passive.r-0603'
WHERE footprint_id = 'builtin:fp:r-0603-1608m';

UPDATE library_components
SET footprint_id = 'openpcb.core.footprint.passive.r-0805'
WHERE footprint_id = 'builtin:fp:r-0805-2012m';

UPDATE library_components
SET footprint_id = 'openpcb.core.footprint.passive.r-1206'
WHERE footprint_id = 'builtin:fp:r-1206-3216m';

UPDATE library_components
SET footprint_id = 'openpcb.core.footprint.passive.r-1210'
WHERE footprint_id = 'builtin:fp:r-1210-3225m';

UPDATE library_components
SET footprint_id = 'openpcb.core.footprint.passive.r-2512'
WHERE footprint_id = 'builtin:fp:r-2512-6332m';

UPDATE library_components
SET footprint_id = 'openpcb.core.footprint.passive.r-axial-din0207-p7-62'
WHERE footprint_id = 'builtin:fp:r-axial-din0207-p7.62';

UPDATE library_components
SET footprint_id = 'openpcb.core.footprint.passive.r-axial-din0207-p10-16'
WHERE footprint_id = 'builtin:fp:r-axial-din0207-p10.16';

UPDATE library_components
SET footprint_id = 'openpcb.core.footprint.passive.r-axial-din0309-p12-70'
WHERE footprint_id = 'builtin:fp:r-axial-din0309-p12.70';

UPDATE library_components
SET footprint_id = 'openpcb.core.footprint.passive.c-0402'
WHERE footprint_id = 'builtin:fp:c-0402-1005m';

UPDATE library_components
SET footprint_id = 'openpcb.core.footprint.passive.c-0603'
WHERE footprint_id = 'builtin:fp:c-0603-1608m';

UPDATE library_components
SET footprint_id = 'openpcb.core.footprint.passive.c-0805'
WHERE footprint_id = 'builtin:fp:c-0805-2012m';

UPDATE library_components
SET footprint_id = 'openpcb.core.footprint.passive.c-1206'
WHERE footprint_id = 'builtin:fp:c-1206-3216m';

UPDATE library_components
SET footprint_id = 'openpcb.core.footprint.passive.c-1210'
WHERE footprint_id = 'builtin:fp:c-1210-3225m';

UPDATE library_components
SET footprint_id = 'openpcb.core.footprint.passive.c-disc-d3-p2-5'
WHERE footprint_id = 'builtin:fp:c-disc-d3-p2.5';

UPDATE library_components
SET footprint_id = 'openpcb.core.footprint.passive.c-disc-d5-p5'
WHERE footprint_id = 'builtin:fp:c-disc-d5-p5';

UPDATE library_components
SET footprint_id = 'openpcb.core.footprint.passive.c-disc-d7-5-p5'
WHERE footprint_id = 'builtin:fp:c-disc-d7.5-p5';
