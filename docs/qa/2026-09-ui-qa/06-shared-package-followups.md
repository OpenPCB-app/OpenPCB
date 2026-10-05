[← index](README.md)

# Shared-package follow-ups

## (g) Shared-package follow-ups (`@openpcb/*`, CoreLibrary — no edits in this run)

| Finding → TID | Package | Issue | In-app mitigation |
|---|---|---|---|
| Q7-022 → T-317 | @openpcb/kicad-import + CoreLibrary pack | Y-down footprints → mirrored land patterns in PCB/Gerber (S1) | none possible in-app; release blocker |
| Q10-001 → T-001 | @openpcb/r3f-eda-canvas (EDAText / troika) | Canvas text fonts fetched from cdn.jsdelivr.net → black canvases offline (S1) | F0b: bundle font + troika config |
| Q7-013 → T-316 | @openpcb/rendering-core (ipc7351b family-presets) | Wrong SOT pad counts/layouts; QFN EP shorts signal pads (S1) | L4a: hide affected presets |
| F2A-016 → T-105 | @openpcb/rendering-core (symbol-preview-builder) | KiCad '~{}' markup literal, pin names overprint, labels inside bodies, fit ignores text | — |
| Q7-003 → T-294 | @openpcb/r3f-eda-canvas (symbol-render-layer) | No unit/body-style filtering for multi-unit symbols | L3/L1 filter units before render |
| Q3-030 → T-116 | @openpcb/r3f-eda-canvas (canvasTheme) | Canvas palette violet/amber selection, not neutral tokens | — |
| F1B-025 → T-202 | @openpcb/r3f-eda-canvas (layers.js) | Solder-mask swatches = drill black; In1 amber ≈ outline | — |
| F2B-016 → T-204 | @openpcb/r3f-eda-canvas (footprint-render-layer) | Pad numbers upside-down on 180° parts | — |
| F2A-012 → T-239 | @openpcb/r3f-eda-canvas (EDAText) | 3D refdes not depth-tested (shows through board) | — |
| Q3-024 → T-120 | @openpcb/r3f-eda-canvas (use-eda-camera) | Wheel zoom down to 1 % vs button floor 10 % | D2 may pass min zoom if supported |
| Q7-002 → T-298 | @openpcb/r3f-eda-canvas (GridShader) | uPixelsPerUnit stuck → wizard/preview grids never render | — |
| Q6-012 → T-264 | @openpcb/r3f-eda-canvas (PreviewCanvasShell) | Overlay relies on host Tailwind classes that aren't generated | F0a: @source for package dist |
| Q6-029 → T-282 | @openpcb/r3f-eda-canvas (FootprintPreviewCanvas) | Hidden F.Fab labels included in fit bounds | L1: pass fitToGeometryOnly |
| Q6-036 → T-286 | @openpcb/step-to-glb | ~200 GLTFExporter warnings per STEP conversion | — |
| Q7-033 → T-023 | three / @react-three/fiber (via packages) | THREE.Clock deprecation + Context Lost logs per canvas mount | — |
| F2A-011 → T-238 | CoreLibrary data | Pin header 1x02 vertical 3D model lies flat | — |
| F1B-009 → T-214 | CoreLibrary data / DRC preset | Core footprints fail JLCPCB silk rules (~5 warnings per part) | out of scope (DRC) |
| Q3-007 → T-095 | @openpcb/rendering-core (grid constant) | Schematic grid default 2 mm ≠ 2.54 mm pin pitch | G: app passes 1.27 mm |
| Q5-019 → T-247 | @openpcb/kicad-import (validate-pads) | Unnumbered NPTH pads reject whole part (USB-C J1 dropped) | D1/D4 surface warnings |
