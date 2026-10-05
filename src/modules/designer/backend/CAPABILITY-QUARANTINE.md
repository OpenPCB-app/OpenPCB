# Manufacturing and KiCad project capability quarantine

Runtime manufacturing summary, JSON and ZIP output, plus standalone placement-coordinate PnP/CPL CSV, return HTTP 422 `UNQUALIFIED_MANUFACTURING`. The shared server guard runs before PCB projection reads, which can lazily create or synchronize persisted data. The Designer SDK uses the same guard; Assistant/MCP export tools report the refusal through that SDK.

The blockers are `electrical-identity`, `source-frame` and `output-completeness`. Checking only dangling net IDs is insufficient: an old coordinate-based ID may remain valid while identifying a different electrical net. Payload options, environment flags and DRC acknowledgement cannot override this restriction. Pure numerical builders remain available for qualification tests; their existing greater-than-four-layer and unsupported-via refusals remain intact.

KiCad project inspection remains available. HTTP, SDK and direct project commit reject with 422 `UNQUALIFIED_IMPORT` before inspection, Library ingestion, database writes or model publication. This does not claim that the import pipeline is qualified or atomic.

Descriptive BOM CSV, TSV, JLC BOM and KiCad BOM exports remain available. Their columns contain no placement coordinates. Standalone PnP and fabrication bundles are unavailable in the UI; inspection reports cannot enable project commit.

Remove these guards only after durable electrical identity, source-frame provenance and complete numerical output have been independently qualified across import, move, rotate, undo, save/reopen and native file publication. There is no user override.
