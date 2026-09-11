/**
 * Re-export shim. The stroke font moved to
 * `src/shared/rendering/pcb/artwork/stroke-font.ts` in S12 (DFM contract 11
 * §1.2): the silkscreen artwork model is built in `shared/` and the Gerber
 * writer emits it, so the glyphs cannot live in the export module any more.
 * Edit the shared file, not this one.
 */
export * from "../../../../../shared/rendering/pcb/artwork/stroke-font";
