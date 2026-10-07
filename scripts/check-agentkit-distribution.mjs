import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGES = ['agentkit', '@openpcb/contracts'];
const DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'];
const MANIFESTS = ['package.json', 'electron/package.json',
  'src/core/backend/package.json', 'src/core/frontend/package.json'];
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA512_INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/;

function refuse(message) {
  throw new Error(`AgentKit distribution is blocked by OPENPCB-124: ${message}`);
}

function hasLegacyDependency(dependencies) {
  return Object.entries(dependencies ?? {}).some(([name, source]) =>
    name === '@openpcb/ai-core' || (typeof source === 'string'
      && /^npm:@openpcb\/ai-core(?:@|$)/.test(source)));
}

function validatePolicy(policy) {
  if (policy?.schemaVersion !== 1) refuse('release policy schema is invalid.');
  if (policy.productionRelease === null) {
    refuse('no reviewed published AgentKit/contracts release pin is configured.');
  }
  const pins = policy.productionRelease?.packages;
  if (!pins || Object.keys(pins).sort().join(',') !== [...PACKAGES].sort().join(',')) {
    refuse('release policy must pin AgentKit and domain contracts.');
  }
  for (const name of PACKAGES) {
    const pin = pins[name];
    const basename = name.split('/').at(-1);
    const expectedUrl = `https://registry.npmjs.org/${name}/-/${basename}-${pin?.version}.tgz`;
    if (!EXACT_VERSION.test(pin?.version ?? '') || pin.resolved !== expectedUrl
      || !SHA512_INTEGRITY.test(pin.integrity ?? '')) {
      refuse(`reviewed published pin is invalid for ${name}.`);
    }
  }
  return pins;
}

function validateManifests(manifests, pins) {
  const root = manifests['package.json'];
  for (const name of PACKAGES) {
    if (root?.dependencies?.[name] !== pins[name].version) {
      refuse(`package.json must use the reviewed exact published version of ${name}.`);
    }
  }
  for (const [file, manifest] of Object.entries(manifests)) {
    for (const field of [...DEPENDENCY_FIELDS, 'devDependencies']) {
      for (const name of PACKAGES) {
        const source = manifest[field]?.[name];
        if (source !== undefined && source !== pins[name].version) {
          refuse(`${file} has an unreviewed or mutable ${name} dependency.`);
        }
      }
    }
    for (const field of DEPENDENCY_FIELDS) {
      if (hasLegacyDependency(manifest[field])) {
        refuse(`${file} retains the legacy ai-core production dependency.`);
      }
    }
  }
}

function validateLockedPin(entry, name, pin) {
  if (!entry || entry.link || entry.dev || entry.version !== pin.version
    || entry.resolved !== pin.resolved || entry.integrity !== pin.integrity) {
    refuse(`package-lock.json does not match the reviewed published ${name} pin.`);
  }
}

function validateLock(lock, pins) {
  if (lock?.lockfileVersion !== 3 || !lock.packages) refuse('npm lockfile version 3 is required.');
  for (const name of PACKAGES) {
    if (lock.packages['']?.dependencies?.[name] !== pins[name].version) {
      refuse(`npm root lock dependency differs from the reviewed ${name} pin.`);
    }
    validateLockedPin(lock.packages[`node_modules/${name}`], name, pins[name]);
  }
  for (const [location, entry] of Object.entries(lock.packages)) {
    if (entry.dev === true) continue;
    if (location.endsWith('node_modules/@openpcb/ai-core') || entry.name === '@openpcb/ai-core') {
      refuse('npm production graph retains the legacy ai-core package.');
    }
    for (const field of DEPENDENCY_FIELDS) {
      if (hasLegacyDependency(entry[field])) {
        refuse('npm production graph retains a legacy ai-core dependency edge.');
      }
    }
    for (const name of PACKAGES) {
      if (location.endsWith(`node_modules/${name}`) || entry.name === name) {
        validateLockedPin(entry, name, pins[name]);
      }
    }
  }
}

/** Only an independently reviewed published policy can qualify a redistributable. */
export function validateDistribution({ manifests, lock, policy }) {
  const pins = validatePolicy(policy);
  validateManifests(manifests, pins);
  validateLock(lock, pins);
}

export async function checkDistribution(root) {
  const files = [...MANIFESTS, 'package-lock.json', 'resources/agentkit-release.json'];
  const documents = await Promise.all(files.map(async (file) =>
    [file, JSON.parse(await readFile(resolve(root, file), 'utf8'))]));
  const data = Object.fromEntries(documents);
  validateDistribution({ manifests: Object.fromEntries(MANIFESTS.map((file) => [file, data[file]])),
    lock: data['package-lock.json'], policy: data['resources/agentkit-release.json'] });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await checkDistribution(fileURLToPath(new URL('..', import.meta.url)));
    console.log('AgentKit distribution guard: reviewed published dependency pins match.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'AgentKit distribution guard failed.');
    process.exitCode = 1;
  }
}
