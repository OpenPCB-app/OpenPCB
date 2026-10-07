import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateDistribution } from './check-agentkit-distribution.mjs';

const integrity = `sha512-${Buffer.alloc(64, 7).toString('base64')}`;
function fixture() {
  const packages = Object.fromEntries(['agentkit', '@openpcb/contracts'].map((name) => [name, {
    version: '9.8.7-test-fixture',
    resolved: `https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-9.8.7-test-fixture.tgz`,
    integrity,
  }]));
  const dependencies = Object.fromEntries(Object.entries(packages).map(([name, pin]) => [name, pin.version]));
  return {
    policy: { schemaVersion: 1, productionRelease: { packages } },
    manifests: { 'package.json': { dependencies: structuredClone(dependencies) },
      'electron/package.json': {}, 'src/core/backend/package.json': {}, 'src/core/frontend/package.json': {} },
    lock: { lockfileVersion: 3, packages: { '': { dependencies: structuredClone(dependencies) },
      ...Object.fromEntries(Object.entries(packages).map(([name, pin]) => [`node_modules/${name}`, { ...pin }])) } },
  };
}

const blocked = /AgentKit distribution is blocked by OPENPCB-124:/;

test('only reviewed exact published fixture pins and matching lock integrity pass', () => {
  assert.doesNotThrow(() => validateDistribution(fixture()));
});

test('null, missing, incomplete or malformed publication policy fails closed', () => {
  const f = fixture();
  f.policy.productionRelease = null;
  assert.throws(() => validateDistribution(f), /no reviewed published AgentKit\/contracts release pin is configured/);
  const missing = fixture(); delete missing.policy.productionRelease;
  assert.throws(() => validateDistribution(missing), blocked);
  const incomplete = fixture(); delete incomplete.policy.productionRelease.packages.agentkit;
  assert.throws(() => validateDistribution(incomplete), blocked);
  const malformed = fixture(); malformed.policy.productionRelease.packages.agentkit.integrity = 'sha512-short';
  assert.throws(() => validateDistribution(malformed), blocked);
  const mutable = fixture(); mutable.policy.productionRelease.packages.agentkit.version = '^9.8.7';
  assert.throws(() => validateDistribution(mutable), blocked);
});

for (const source of ['file:vendor/agentkit/unpublished.tgz', '^9.8.7', '~9.8.7', 'latest',
  'github:owner/AgentKit#main', 'github:owner/AgentKit#v9.8.7', 'npm:agentkit@9.8.7']) {
  test(`unreviewed local, mutable or alias source refused: ${source}`, () => {
    const f = fixture(); f.manifests['package.json'].dependencies.agentkit = source;
    assert.throws(() => validateDistribution(f), /reviewed exact published version/);
  });
}

test('workspaces cannot substitute a second AgentKit or contracts version', () => {
  const f = fixture();
  f.manifests['electron/package.json'].dependencies = { agentkit: 'file:../candidate.tgz' };
  assert.throws(() => validateDistribution(f), /unreviewed or mutable agentkit dependency/);
});

for (const field of ['version', 'resolved', 'integrity']) {
  test(`lock ${field} must match reviewed publication identity`, () => {
    const f = fixture(); f.lock.packages['node_modules/agentkit'][field] = 'changed';
    assert.throws(() => validateDistribution(f), /does not match the reviewed published agentkit pin/);
  });
}

test('missing root lock entry, lock-root mismatch, links and nested substitute versions fail closed', () => {
  const absent = fixture(); delete absent.lock.packages['node_modules/agentkit'];
  assert.throws(() => validateDistribution(absent), blocked);
  const rootMismatch = fixture(); rootMismatch.lock.packages[''].dependencies.agentkit = 'latest';
  assert.throws(() => validateDistribution(rootMismatch), blocked);
  const link = fixture(); link.lock.packages['node_modules/agentkit'].link = true;
  assert.throws(() => validateDistribution(link), blocked);
  const nested = fixture(); nested.lock.packages['node_modules/consumer/node_modules/agentkit'] = {
    ...nested.lock.packages['node_modules/agentkit'], version: '1.0.0',
  };
  assert.throws(() => validateDistribution(nested), blocked);
  const oldLock = fixture(); oldLock.lock.lockfileVersion = 2;
  assert.throws(() => validateDistribution(oldLock), blocked);
});

test('legacy ai-core direct and transitive production graph cannot pass', () => {
  const direct = fixture(); direct.manifests['package.json'].dependencies['@openpcb/ai-core'] = '0.3.0';
  assert.throws(() => validateDistribution(direct), /legacy ai-core production dependency/);
  const nested = fixture(); nested.lock.packages['node_modules/consumer/node_modules/@openpcb/ai-core'] = { version: '0.3.0' };
  assert.throws(() => validateDistribution(nested), /legacy ai-core package/);
  const edge = fixture(); edge.lock.packages['node_modules/@openpcb/contracts'].dependencies = { '@openpcb/ai-core': '0.3.0' };
  assert.throws(() => validateDistribution(edge), /legacy ai-core dependency edge/);
});

test('renamed npm aliases cannot hide legacy ai-core production dependencies', () => {
  const direct = fixture();
  direct.manifests['package.json'].dependencies.renamed = 'npm:@openpcb/ai-core@0.3.0';
  assert.throws(() => validateDistribution(direct), /legacy ai-core production dependency/);
  const edge = fixture();
  edge.lock.packages['node_modules/consumer'] = { dependencies: { renamed: 'npm:@openpcb/ai-core@0.3.0' } };
  assert.throws(() => validateDistribution(edge), /legacy ai-core dependency edge/);
});

test('development-only test fixtures do not masquerade as production dependencies', () => {
  const f = fixture(); f.lock.packages['node_modules/dev-only/node_modules/@openpcb/ai-core'] = { version: '0.3.0', dev: true };
  assert.doesNotThrow(() => validateDistribution(f));
});

test('environment flags cannot bypass absent publication approval', () => {
  const previous = process.env.OPENPCB_ALLOW_UNPUBLISHED_AGENTKIT;
  process.env.OPENPCB_ALLOW_UNPUBLISHED_AGENTKIT = 'true';
  try {
    const f = fixture(); f.policy.productionRelease = null;
    assert.throws(() => validateDistribution(f), /no reviewed published/);
  } finally {
    if (previous === undefined) delete process.env.OPENPCB_ALLOW_UNPUBLISHED_AGENTKIT;
    else process.env.OPENPCB_ALLOW_UNPUBLISHED_AGENTKIT = previous;
  }
});
