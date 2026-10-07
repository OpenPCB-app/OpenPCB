import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { argumentsFrom, catalogQualification, exportedApi, responsesQualification,
  stubTools, verifyArtifact } from './qualify-assistant-candidate.mjs';

const packageDir = process.env.AGENTKIT_QUALIFICATION_PACKAGE_DIR;
const fixture = JSON.parse(await readFile(new URL(
  '../src/core/backend/tests/fixtures/assistant-parity/catalog.json', import.meta.url), 'utf8'));
const candidateTest = (name, run) => test(name, {
  skip: packageDir ? false : 'Set AGENTKIT_QUALIFICATION_PACKAGE_DIR to an exact developer candidate',
}, run);

async function candidate() {
  const manifest = JSON.parse(await readFile(resolve(packageDir, 'package.json'), 'utf8'));
  const core = await exportedApi(packageDir, manifest, 'core');
  const host = await exportedApi(packageDir, manifest, 'host');
  return { core, host, manifest };
}

test('requires explicit candidate and fixture paths', () => {
  assert.throws(() => argumentsFrom([]), /--package-dir is required/);
  assert.throws(() => argumentsFrom(['--package-dir', '/tmp/candidate']), /--fixture is required/);
  assert.throws(() => argumentsFrom(['--unknown', 'value']), /Unknown or incomplete option/);
  const paths = ['--package-dir', '/tmp/candidate', '--fixture', '/tmp/fixture'];
  assert.equal(argumentsFrom(paths)['--profile'], 'migration');
  assert.equal(argumentsFrom([...paths, '--profile', 'responses'])['--profile'], 'responses');
  assert.throws(() => argumentsFrom([...paths, '--profile', 'unknown']), /Invalid qualification profile/);
});

candidateTest('rejects artifact provenance mismatch', async () => {
  const { manifest } = await candidate();
  await assert.rejects(verifyArtifact({ '--package-dir': packageDir,
    '--tarball': new URL('../package.json', import.meta.url).pathname }, manifest),
  /Candidate artifact SHA-256 differs/);
});

candidateTest('invalid native schema identifies dropped tool; catalog cannot report success', async () => {
  const { core, host } = await candidate();
  const definitions = structuredClone(fixture.data.inAppTools);
  definitions[0].inputSchema.type = 'invalid-native-schema-type';
  const checked = await catalogQualification(core, host, definitions, stubTools(definitions, []));
  assert.equal(checked.result.passed, false);
  assert.deepEqual(checked.result.missing, [definitions[0].name]);
  assert.equal(checked.result.schemaErrors[0].tool, definitions[0].name);
  assert.equal(checked.result.schemaErrors[0].code, 'schema_invalid');
});

candidateTest('Responses rejects unsupported native keyword without sending a request', async (context) => {
  const { core } = await candidate();
  if (typeof core.ResponsesClient !== 'function') {
    context.skip('Foundation candidate has no public ResponsesClient');
    return;
  }
  const definitions = structuredClone(fixture.data.inAppTools);
  const definition = definitions.find((tool) => tool.name === 'designer_get_design_summary');
  definition.inputSchema.properties.designId.pattern = '^qualification-';
  const checked = await responsesQualification(core, definitions);
  assert.equal(checked.passed, false);
  for (const profile of Object.values(checked.profiles)) {
    assert.equal(profile.all.requestCount, 0);
    assert.equal(profile.all.error.errorCode, 'unsupported_tool_schema');
    const rejected = profile.individual.filter((item) => !item.passed);
    assert.deepEqual(rejected.map((item) => item.tool), ['designer_get_design_summary']);
    assert.equal(rejected[0].error.errorCode, 'unsupported_tool_schema');
    assert.equal(rejected[0].requestCount, 0);
  }
});

candidateTest('unchanged native schemas serialize or report unavailable public Responses export', async () => {
  const { core } = await candidate();
  const definitions = structuredClone(fixture.data.inAppTools);
  const checked = await responsesQualification(core, definitions);
  const supported = typeof core.ResponsesClient === 'function';
  assert.equal(checked.passed, supported);
  assert.deepEqual(definitions, fixture.data.inAppTools);
  for (const profile of Object.values(checked.profiles)) {
    if (supported) assert.equal(profile.all.requestCount, 1);
    else assert.equal(profile.all.reason, 'Public ResponsesClient export unavailable');
  }
});
