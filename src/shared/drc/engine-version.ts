/**
 * The DRC engine's semantic version, stamped into every persisted DRC result
 * (`designer_drc_results.provenance_json`, H19 / OPENPCB-67 §3.5) so that a
 * manufacturing export never trusts a verdict produced by different rules.
 *
 * BUMP THIS on any change to the check set, a default severity
 * (`DEFAULT_SEVERITY_BY_CODE`), `NON_OVERRIDABLE`, a code's rule class
 * (`RULE_CLASS_BY_CODE` — class ignores drop violations by class), or a
 * check's semantics. `src/core/backend/tests/fixtures/drc/engine-tables.json`
 * snapshots the tables next to this number, so a table edit that forgets the
 * bump fails `designer-drc-provenance.test.ts` and the reviewer sees both.
 *
 * Packaged builds also combine it with the app version (see
 * `drcEngineVersion`), so an upgrade invalidates old evidence even when a bump
 * is forgotten; in dev builds this constant is what counts.
 */
export const DRC_ENGINE_VERSION = 1;

/** The ONE spelling of the stamp: `${DRC_ENGINE_VERSION}+${appVersion}`. */
export function drcEngineVersion(appVersion: string): string {
  return `${DRC_ENGINE_VERSION}+${appVersion}`;
}
