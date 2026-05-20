-- 0009_legacy_builtin_id_rewrite.sql
-- Rewrite legacy builtin:* IDs stored inside designer state (parts + history + JSON payloads).
-- NOTE: This is string-level migration (SQLite REPLACE), not JSON parsing.

-- designer_schematic_parts.component_id
UPDATE designer_schematic_parts
SET component_id = REPLACE(component_id, 'builtin:resistor', 'openpcb.core.passive.resistor')
WHERE component_id LIKE 'builtin:%';

UPDATE designer_schematic_parts
SET component_id = REPLACE(component_id, 'builtin:capacitor', 'openpcb.core.passive.capacitor')
WHERE component_id LIKE 'builtin:%';

UPDATE designer_schematic_parts
SET component_id = REPLACE(component_id, 'builtin:sym:resistor', 'openpcb.core.symbol.passive.resistor')
WHERE component_id LIKE 'builtin:%';

UPDATE designer_schematic_parts
SET component_id = REPLACE(component_id, 'builtin:sym:capacitor', 'openpcb.core.symbol.passive.capacitor')
WHERE component_id LIKE 'builtin:%';

UPDATE designer_schematic_parts
SET component_id = REPLACE(component_id, 'builtin:fp:r-0402-1005m', 'openpcb.core.footprint.passive.r-0402')
WHERE component_id LIKE 'builtin:%';

UPDATE designer_schematic_parts
SET component_id = REPLACE(component_id, 'builtin:fp:r-0603-1608m', 'openpcb.core.footprint.passive.r-0603')
WHERE component_id LIKE 'builtin:%';

UPDATE designer_schematic_parts
SET component_id = REPLACE(component_id, 'builtin:fp:r-0805-2012m', 'openpcb.core.footprint.passive.r-0805')
WHERE component_id LIKE 'builtin:%';

UPDATE designer_schematic_parts
SET component_id = REPLACE(component_id, 'builtin:fp:r-1206-3216m', 'openpcb.core.footprint.passive.r-1206')
WHERE component_id LIKE 'builtin:%';

UPDATE designer_schematic_parts
SET component_id = REPLACE(component_id, 'builtin:fp:r-1210-3225m', 'openpcb.core.footprint.passive.r-1210')
WHERE component_id LIKE 'builtin:%';

UPDATE designer_schematic_parts
SET component_id = REPLACE(component_id, 'builtin:fp:r-2512-6332m', 'openpcb.core.footprint.passive.r-2512')
WHERE component_id LIKE 'builtin:%';

UPDATE designer_schematic_parts
SET component_id = REPLACE(component_id, 'builtin:fp:r-axial-din0207-p7.62', 'openpcb.core.footprint.passive.r-axial-din0207-p7-62')
WHERE component_id LIKE 'builtin:%';

UPDATE designer_schematic_parts
SET component_id = REPLACE(component_id, 'builtin:fp:r-axial-din0207-p10.16', 'openpcb.core.footprint.passive.r-axial-din0207-p10-16')
WHERE component_id LIKE 'builtin:%';

UPDATE designer_schematic_parts
SET component_id = REPLACE(component_id, 'builtin:fp:r-axial-din0309-p12.70', 'openpcb.core.footprint.passive.r-axial-din0309-p12-70')
WHERE component_id LIKE 'builtin:%';

UPDATE designer_schematic_parts
SET component_id = REPLACE(component_id, 'builtin:fp:c-0402-1005m', 'openpcb.core.footprint.passive.c-0402')
WHERE component_id LIKE 'builtin:%';

UPDATE designer_schematic_parts
SET component_id = REPLACE(component_id, 'builtin:fp:c-0603-1608m', 'openpcb.core.footprint.passive.c-0603')
WHERE component_id LIKE 'builtin:%';

UPDATE designer_schematic_parts
SET component_id = REPLACE(component_id, 'builtin:fp:c-0805-2012m', 'openpcb.core.footprint.passive.c-0805')
WHERE component_id LIKE 'builtin:%';

UPDATE designer_schematic_parts
SET component_id = REPLACE(component_id, 'builtin:fp:c-1206-3216m', 'openpcb.core.footprint.passive.c-1206')
WHERE component_id LIKE 'builtin:%';

UPDATE designer_schematic_parts
SET component_id = REPLACE(component_id, 'builtin:fp:c-1210-3225m', 'openpcb.core.footprint.passive.c-1210')
WHERE component_id LIKE 'builtin:%';

UPDATE designer_schematic_parts
SET component_id = REPLACE(component_id, 'builtin:fp:c-disc-d3-p2.5', 'openpcb.core.footprint.passive.c-disc-d3-p2-5')
WHERE component_id LIKE 'builtin:%';

UPDATE designer_schematic_parts
SET component_id = REPLACE(component_id, 'builtin:fp:c-disc-d5-p5', 'openpcb.core.footprint.passive.c-disc-d5-p5')
WHERE component_id LIKE 'builtin:%';

UPDATE designer_schematic_parts
SET component_id = REPLACE(component_id, 'builtin:fp:c-disc-d7.5-p5', 'openpcb.core.footprint.passive.c-disc-d7-5-p5')
WHERE component_id LIKE 'builtin:%';

-- designer_command_log.command_json
UPDATE designer_command_log
SET command_json = REPLACE(command_json, 'builtin:resistor', 'openpcb.core.passive.resistor')
WHERE command_json LIKE '%builtin:%';

UPDATE designer_command_log
SET command_json = REPLACE(command_json, 'builtin:capacitor', 'openpcb.core.passive.capacitor')
WHERE command_json LIKE '%builtin:%';

UPDATE designer_command_log
SET command_json = REPLACE(command_json, 'builtin:sym:resistor', 'openpcb.core.symbol.passive.resistor')
WHERE command_json LIKE '%builtin:%';

UPDATE designer_command_log
SET command_json = REPLACE(command_json, 'builtin:sym:capacitor', 'openpcb.core.symbol.passive.capacitor')
WHERE command_json LIKE '%builtin:%';

UPDATE designer_command_log
SET command_json = REPLACE(command_json, 'builtin:fp:r-0402-1005m', 'openpcb.core.footprint.passive.r-0402')
WHERE command_json LIKE '%builtin:%';

UPDATE designer_command_log
SET command_json = REPLACE(command_json, 'builtin:fp:r-0603-1608m', 'openpcb.core.footprint.passive.r-0603')
WHERE command_json LIKE '%builtin:%';

UPDATE designer_command_log
SET command_json = REPLACE(command_json, 'builtin:fp:r-0805-2012m', 'openpcb.core.footprint.passive.r-0805')
WHERE command_json LIKE '%builtin:%';

UPDATE designer_command_log
SET command_json = REPLACE(command_json, 'builtin:fp:r-1206-3216m', 'openpcb.core.footprint.passive.r-1206')
WHERE command_json LIKE '%builtin:%';

UPDATE designer_command_log
SET command_json = REPLACE(command_json, 'builtin:fp:r-1210-3225m', 'openpcb.core.footprint.passive.r-1210')
WHERE command_json LIKE '%builtin:%';

UPDATE designer_command_log
SET command_json = REPLACE(command_json, 'builtin:fp:r-2512-6332m', 'openpcb.core.footprint.passive.r-2512')
WHERE command_json LIKE '%builtin:%';

UPDATE designer_command_log
SET command_json = REPLACE(command_json, 'builtin:fp:r-axial-din0207-p7.62', 'openpcb.core.footprint.passive.r-axial-din0207-p7-62')
WHERE command_json LIKE '%builtin:%';

UPDATE designer_command_log
SET command_json = REPLACE(command_json, 'builtin:fp:r-axial-din0207-p10.16', 'openpcb.core.footprint.passive.r-axial-din0207-p10-16')
WHERE command_json LIKE '%builtin:%';

UPDATE designer_command_log
SET command_json = REPLACE(command_json, 'builtin:fp:r-axial-din0309-p12.70', 'openpcb.core.footprint.passive.r-axial-din0309-p12-70')
WHERE command_json LIKE '%builtin:%';

UPDATE designer_command_log
SET command_json = REPLACE(command_json, 'builtin:fp:c-0402-1005m', 'openpcb.core.footprint.passive.c-0402')
WHERE command_json LIKE '%builtin:%';

UPDATE designer_command_log
SET command_json = REPLACE(command_json, 'builtin:fp:c-0603-1608m', 'openpcb.core.footprint.passive.c-0603')
WHERE command_json LIKE '%builtin:%';

UPDATE designer_command_log
SET command_json = REPLACE(command_json, 'builtin:fp:c-0805-2012m', 'openpcb.core.footprint.passive.c-0805')
WHERE command_json LIKE '%builtin:%';

UPDATE designer_command_log
SET command_json = REPLACE(command_json, 'builtin:fp:c-1206-3216m', 'openpcb.core.footprint.passive.c-1206')
WHERE command_json LIKE '%builtin:%';

UPDATE designer_command_log
SET command_json = REPLACE(command_json, 'builtin:fp:c-1210-3225m', 'openpcb.core.footprint.passive.c-1210')
WHERE command_json LIKE '%builtin:%';

UPDATE designer_command_log
SET command_json = REPLACE(command_json, 'builtin:fp:c-disc-d3-p2.5', 'openpcb.core.footprint.passive.c-disc-d3-p2-5')
WHERE command_json LIKE '%builtin:%';

UPDATE designer_command_log
SET command_json = REPLACE(command_json, 'builtin:fp:c-disc-d5-p5', 'openpcb.core.footprint.passive.c-disc-d5-p5')
WHERE command_json LIKE '%builtin:%';

UPDATE designer_command_log
SET command_json = REPLACE(command_json, 'builtin:fp:c-disc-d7.5-p5', 'openpcb.core.footprint.passive.c-disc-d7-5-p5')
WHERE command_json LIKE '%builtin:%';

-- designer_command_log.result_json
UPDATE designer_command_log
SET result_json = REPLACE(result_json, 'builtin:resistor', 'openpcb.core.passive.resistor')
WHERE result_json LIKE '%builtin:%';

UPDATE designer_command_log
SET result_json = REPLACE(result_json, 'builtin:capacitor', 'openpcb.core.passive.capacitor')
WHERE result_json LIKE '%builtin:%';

UPDATE designer_command_log
SET result_json = REPLACE(result_json, 'builtin:sym:resistor', 'openpcb.core.symbol.passive.resistor')
WHERE result_json LIKE '%builtin:%';

UPDATE designer_command_log
SET result_json = REPLACE(result_json, 'builtin:sym:capacitor', 'openpcb.core.symbol.passive.capacitor')
WHERE result_json LIKE '%builtin:%';

UPDATE designer_command_log
SET result_json = REPLACE(result_json, 'builtin:fp:r-0402-1005m', 'openpcb.core.footprint.passive.r-0402')
WHERE result_json LIKE '%builtin:%';

UPDATE designer_command_log
SET result_json = REPLACE(result_json, 'builtin:fp:r-0603-1608m', 'openpcb.core.footprint.passive.r-0603')
WHERE result_json LIKE '%builtin:%';

UPDATE designer_command_log
SET result_json = REPLACE(result_json, 'builtin:fp:r-0805-2012m', 'openpcb.core.footprint.passive.r-0805')
WHERE result_json LIKE '%builtin:%';

UPDATE designer_command_log
SET result_json = REPLACE(result_json, 'builtin:fp:r-1206-3216m', 'openpcb.core.footprint.passive.r-1206')
WHERE result_json LIKE '%builtin:%';

UPDATE designer_command_log
SET result_json = REPLACE(result_json, 'builtin:fp:r-1210-3225m', 'openpcb.core.footprint.passive.r-1210')
WHERE result_json LIKE '%builtin:%';

UPDATE designer_command_log
SET result_json = REPLACE(result_json, 'builtin:fp:r-2512-6332m', 'openpcb.core.footprint.passive.r-2512')
WHERE result_json LIKE '%builtin:%';

UPDATE designer_command_log
SET result_json = REPLACE(result_json, 'builtin:fp:r-axial-din0207-p7.62', 'openpcb.core.footprint.passive.r-axial-din0207-p7-62')
WHERE result_json LIKE '%builtin:%';

UPDATE designer_command_log
SET result_json = REPLACE(result_json, 'builtin:fp:r-axial-din0207-p10.16', 'openpcb.core.footprint.passive.r-axial-din0207-p10-16')
WHERE result_json LIKE '%builtin:%';

UPDATE designer_command_log
SET result_json = REPLACE(result_json, 'builtin:fp:r-axial-din0309-p12.70', 'openpcb.core.footprint.passive.r-axial-din0309-p12-70')
WHERE result_json LIKE '%builtin:%';

UPDATE designer_command_log
SET result_json = REPLACE(result_json, 'builtin:fp:c-0402-1005m', 'openpcb.core.footprint.passive.c-0402')
WHERE result_json LIKE '%builtin:%';

UPDATE designer_command_log
SET result_json = REPLACE(result_json, 'builtin:fp:c-0603-1608m', 'openpcb.core.footprint.passive.c-0603')
WHERE result_json LIKE '%builtin:%';

UPDATE designer_command_log
SET result_json = REPLACE(result_json, 'builtin:fp:c-0805-2012m', 'openpcb.core.footprint.passive.c-0805')
WHERE result_json LIKE '%builtin:%';

UPDATE designer_command_log
SET result_json = REPLACE(result_json, 'builtin:fp:c-1206-3216m', 'openpcb.core.footprint.passive.c-1206')
WHERE result_json LIKE '%builtin:%';

UPDATE designer_command_log
SET result_json = REPLACE(result_json, 'builtin:fp:c-1210-3225m', 'openpcb.core.footprint.passive.c-1210')
WHERE result_json LIKE '%builtin:%';

UPDATE designer_command_log
SET result_json = REPLACE(result_json, 'builtin:fp:c-disc-d3-p2.5', 'openpcb.core.footprint.passive.c-disc-d3-p2-5')
WHERE result_json LIKE '%builtin:%';

UPDATE designer_command_log
SET result_json = REPLACE(result_json, 'builtin:fp:c-disc-d5-p5', 'openpcb.core.footprint.passive.c-disc-d5-p5')
WHERE result_json LIKE '%builtin:%';

UPDATE designer_command_log
SET result_json = REPLACE(result_json, 'builtin:fp:c-disc-d7.5-p5', 'openpcb.core.footprint.passive.c-disc-d7-5-p5')
WHERE result_json LIKE '%builtin:%';

-- designer_session_histories.undo_stack_json
UPDATE designer_session_histories
SET undo_stack_json = REPLACE(undo_stack_json, 'builtin:resistor', 'openpcb.core.passive.resistor')
WHERE undo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET undo_stack_json = REPLACE(undo_stack_json, 'builtin:capacitor', 'openpcb.core.passive.capacitor')
WHERE undo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET undo_stack_json = REPLACE(undo_stack_json, 'builtin:sym:resistor', 'openpcb.core.symbol.passive.resistor')
WHERE undo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET undo_stack_json = REPLACE(undo_stack_json, 'builtin:sym:capacitor', 'openpcb.core.symbol.passive.capacitor')
WHERE undo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET undo_stack_json = REPLACE(undo_stack_json, 'builtin:fp:r-0402-1005m', 'openpcb.core.footprint.passive.r-0402')
WHERE undo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET undo_stack_json = REPLACE(undo_stack_json, 'builtin:fp:r-0603-1608m', 'openpcb.core.footprint.passive.r-0603')
WHERE undo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET undo_stack_json = REPLACE(undo_stack_json, 'builtin:fp:r-0805-2012m', 'openpcb.core.footprint.passive.r-0805')
WHERE undo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET undo_stack_json = REPLACE(undo_stack_json, 'builtin:fp:r-1206-3216m', 'openpcb.core.footprint.passive.r-1206')
WHERE undo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET undo_stack_json = REPLACE(undo_stack_json, 'builtin:fp:r-1210-3225m', 'openpcb.core.footprint.passive.r-1210')
WHERE undo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET undo_stack_json = REPLACE(undo_stack_json, 'builtin:fp:r-2512-6332m', 'openpcb.core.footprint.passive.r-2512')
WHERE undo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET undo_stack_json = REPLACE(undo_stack_json, 'builtin:fp:r-axial-din0207-p7.62', 'openpcb.core.footprint.passive.r-axial-din0207-p7-62')
WHERE undo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET undo_stack_json = REPLACE(undo_stack_json, 'builtin:fp:r-axial-din0207-p10.16', 'openpcb.core.footprint.passive.r-axial-din0207-p10-16')
WHERE undo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET undo_stack_json = REPLACE(undo_stack_json, 'builtin:fp:r-axial-din0309-p12.70', 'openpcb.core.footprint.passive.r-axial-din0309-p12-70')
WHERE undo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET undo_stack_json = REPLACE(undo_stack_json, 'builtin:fp:c-0402-1005m', 'openpcb.core.footprint.passive.c-0402')
WHERE undo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET undo_stack_json = REPLACE(undo_stack_json, 'builtin:fp:c-0603-1608m', 'openpcb.core.footprint.passive.c-0603')
WHERE undo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET undo_stack_json = REPLACE(undo_stack_json, 'builtin:fp:c-0805-2012m', 'openpcb.core.footprint.passive.c-0805')
WHERE undo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET undo_stack_json = REPLACE(undo_stack_json, 'builtin:fp:c-1206-3216m', 'openpcb.core.footprint.passive.c-1206')
WHERE undo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET undo_stack_json = REPLACE(undo_stack_json, 'builtin:fp:c-1210-3225m', 'openpcb.core.footprint.passive.c-1210')
WHERE undo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET undo_stack_json = REPLACE(undo_stack_json, 'builtin:fp:c-disc-d3-p2.5', 'openpcb.core.footprint.passive.c-disc-d3-p2-5')
WHERE undo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET undo_stack_json = REPLACE(undo_stack_json, 'builtin:fp:c-disc-d5-p5', 'openpcb.core.footprint.passive.c-disc-d5-p5')
WHERE undo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET undo_stack_json = REPLACE(undo_stack_json, 'builtin:fp:c-disc-d7.5-p5', 'openpcb.core.footprint.passive.c-disc-d7-5-p5')
WHERE undo_stack_json LIKE '%builtin:%';

-- designer_session_histories.redo_stack_json
UPDATE designer_session_histories
SET redo_stack_json = REPLACE(redo_stack_json, 'builtin:resistor', 'openpcb.core.passive.resistor')
WHERE redo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET redo_stack_json = REPLACE(redo_stack_json, 'builtin:capacitor', 'openpcb.core.passive.capacitor')
WHERE redo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET redo_stack_json = REPLACE(redo_stack_json, 'builtin:sym:resistor', 'openpcb.core.symbol.passive.resistor')
WHERE redo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET redo_stack_json = REPLACE(redo_stack_json, 'builtin:sym:capacitor', 'openpcb.core.symbol.passive.capacitor')
WHERE redo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET redo_stack_json = REPLACE(redo_stack_json, 'builtin:fp:r-0402-1005m', 'openpcb.core.footprint.passive.r-0402')
WHERE redo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET redo_stack_json = REPLACE(redo_stack_json, 'builtin:fp:r-0603-1608m', 'openpcb.core.footprint.passive.r-0603')
WHERE redo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET redo_stack_json = REPLACE(redo_stack_json, 'builtin:fp:r-0805-2012m', 'openpcb.core.footprint.passive.r-0805')
WHERE redo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET redo_stack_json = REPLACE(redo_stack_json, 'builtin:fp:r-1206-3216m', 'openpcb.core.footprint.passive.r-1206')
WHERE redo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET redo_stack_json = REPLACE(redo_stack_json, 'builtin:fp:r-1210-3225m', 'openpcb.core.footprint.passive.r-1210')
WHERE redo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET redo_stack_json = REPLACE(redo_stack_json, 'builtin:fp:r-2512-6332m', 'openpcb.core.footprint.passive.r-2512')
WHERE redo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET redo_stack_json = REPLACE(redo_stack_json, 'builtin:fp:r-axial-din0207-p7.62', 'openpcb.core.footprint.passive.r-axial-din0207-p7-62')
WHERE redo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET redo_stack_json = REPLACE(redo_stack_json, 'builtin:fp:r-axial-din0207-p10.16', 'openpcb.core.footprint.passive.r-axial-din0207-p10-16')
WHERE redo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET redo_stack_json = REPLACE(redo_stack_json, 'builtin:fp:r-axial-din0309-p12.70', 'openpcb.core.footprint.passive.r-axial-din0309-p12-70')
WHERE redo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET redo_stack_json = REPLACE(redo_stack_json, 'builtin:fp:c-0402-1005m', 'openpcb.core.footprint.passive.c-0402')
WHERE redo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET redo_stack_json = REPLACE(redo_stack_json, 'builtin:fp:c-0603-1608m', 'openpcb.core.footprint.passive.c-0603')
WHERE redo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET redo_stack_json = REPLACE(redo_stack_json, 'builtin:fp:c-0805-2012m', 'openpcb.core.footprint.passive.c-0805')
WHERE redo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET redo_stack_json = REPLACE(redo_stack_json, 'builtin:fp:c-1206-3216m', 'openpcb.core.footprint.passive.c-1206')
WHERE redo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET redo_stack_json = REPLACE(redo_stack_json, 'builtin:fp:c-1210-3225m', 'openpcb.core.footprint.passive.c-1210')
WHERE redo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET redo_stack_json = REPLACE(redo_stack_json, 'builtin:fp:c-disc-d3-p2.5', 'openpcb.core.footprint.passive.c-disc-d3-p2-5')
WHERE redo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET redo_stack_json = REPLACE(redo_stack_json, 'builtin:fp:c-disc-d5-p5', 'openpcb.core.footprint.passive.c-disc-d5-p5')
WHERE redo_stack_json LIKE '%builtin:%';

UPDATE designer_session_histories
SET redo_stack_json = REPLACE(redo_stack_json, 'builtin:fp:c-disc-d7.5-p5', 'openpcb.core.footprint.passive.c-disc-d7-5-p5')
WHERE redo_stack_json LIKE '%builtin:%';

-- designer_pcb_entities.payload_json
UPDATE designer_pcb_entities
SET payload_json = REPLACE(payload_json, 'builtin:resistor', 'openpcb.core.passive.resistor')
WHERE payload_json LIKE '%builtin:%';

UPDATE designer_pcb_entities
SET payload_json = REPLACE(payload_json, 'builtin:capacitor', 'openpcb.core.passive.capacitor')
WHERE payload_json LIKE '%builtin:%';

UPDATE designer_pcb_entities
SET payload_json = REPLACE(payload_json, 'builtin:sym:resistor', 'openpcb.core.symbol.passive.resistor')
WHERE payload_json LIKE '%builtin:%';

UPDATE designer_pcb_entities
SET payload_json = REPLACE(payload_json, 'builtin:sym:capacitor', 'openpcb.core.symbol.passive.capacitor')
WHERE payload_json LIKE '%builtin:%';

UPDATE designer_pcb_entities
SET payload_json = REPLACE(payload_json, 'builtin:fp:r-0402-1005m', 'openpcb.core.footprint.passive.r-0402')
WHERE payload_json LIKE '%builtin:%';

UPDATE designer_pcb_entities
SET payload_json = REPLACE(payload_json, 'builtin:fp:r-0603-1608m', 'openpcb.core.footprint.passive.r-0603')
WHERE payload_json LIKE '%builtin:%';

UPDATE designer_pcb_entities
SET payload_json = REPLACE(payload_json, 'builtin:fp:r-0805-2012m', 'openpcb.core.footprint.passive.r-0805')
WHERE payload_json LIKE '%builtin:%';

UPDATE designer_pcb_entities
SET payload_json = REPLACE(payload_json, 'builtin:fp:r-1206-3216m', 'openpcb.core.footprint.passive.r-1206')
WHERE payload_json LIKE '%builtin:%';

UPDATE designer_pcb_entities
SET payload_json = REPLACE(payload_json, 'builtin:fp:r-1210-3225m', 'openpcb.core.footprint.passive.r-1210')
WHERE payload_json LIKE '%builtin:%';

UPDATE designer_pcb_entities
SET payload_json = REPLACE(payload_json, 'builtin:fp:r-2512-6332m', 'openpcb.core.footprint.passive.r-2512')
WHERE payload_json LIKE '%builtin:%';

UPDATE designer_pcb_entities
SET payload_json = REPLACE(payload_json, 'builtin:fp:r-axial-din0207-p7.62', 'openpcb.core.footprint.passive.r-axial-din0207-p7-62')
WHERE payload_json LIKE '%builtin:%';

UPDATE designer_pcb_entities
SET payload_json = REPLACE(payload_json, 'builtin:fp:r-axial-din0207-p10.16', 'openpcb.core.footprint.passive.r-axial-din0207-p10-16')
WHERE payload_json LIKE '%builtin:%';

UPDATE designer_pcb_entities
SET payload_json = REPLACE(payload_json, 'builtin:fp:r-axial-din0309-p12.70', 'openpcb.core.footprint.passive.r-axial-din0309-p12-70')
WHERE payload_json LIKE '%builtin:%';

UPDATE designer_pcb_entities
SET payload_json = REPLACE(payload_json, 'builtin:fp:c-0402-1005m', 'openpcb.core.footprint.passive.c-0402')
WHERE payload_json LIKE '%builtin:%';

UPDATE designer_pcb_entities
SET payload_json = REPLACE(payload_json, 'builtin:fp:c-0603-1608m', 'openpcb.core.footprint.passive.c-0603')
WHERE payload_json LIKE '%builtin:%';

UPDATE designer_pcb_entities
SET payload_json = REPLACE(payload_json, 'builtin:fp:c-0805-2012m', 'openpcb.core.footprint.passive.c-0805')
WHERE payload_json LIKE '%builtin:%';

UPDATE designer_pcb_entities
SET payload_json = REPLACE(payload_json, 'builtin:fp:c-1206-3216m', 'openpcb.core.footprint.passive.c-1206')
WHERE payload_json LIKE '%builtin:%';

UPDATE designer_pcb_entities
SET payload_json = REPLACE(payload_json, 'builtin:fp:c-1210-3225m', 'openpcb.core.footprint.passive.c-1210')
WHERE payload_json LIKE '%builtin:%';

UPDATE designer_pcb_entities
SET payload_json = REPLACE(payload_json, 'builtin:fp:c-disc-d3-p2.5', 'openpcb.core.footprint.passive.c-disc-d3-p2-5')
WHERE payload_json LIKE '%builtin:%';

UPDATE designer_pcb_entities
SET payload_json = REPLACE(payload_json, 'builtin:fp:c-disc-d5-p5', 'openpcb.core.footprint.passive.c-disc-d5-p5')
WHERE payload_json LIKE '%builtin:%';

UPDATE designer_pcb_entities
SET payload_json = REPLACE(payload_json, 'builtin:fp:c-disc-d7.5-p5', 'openpcb.core.footprint.passive.c-disc-d7-5-p5')
WHERE payload_json LIKE '%builtin:%';
