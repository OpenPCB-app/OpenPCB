#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// These pins identify unpublished developer candidates, not production dependencies.
const ARTIFACTS = {
  '0.6.0': 'ab724ec617a12d68fc4c6a88656ff9605949c2f3929113b89b293ab6c999e5a5',
  '0.7.0': '8ac9b61fc18a93ae6578c3b346bc79d225247ef0e73e9ed488971004d2b324e9',
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const clone = (value) => JSON.parse(JSON.stringify(value));

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function argumentsFrom(argv) {
  const options = {};
  const allowed = new Set(['--package-dir', '--fixture', '--tarball', '--profile']);
  for (let i = 0; i < argv.length; i += 2) {
    assert(allowed.has(argv[i]) && argv[i + 1], `Unknown or incomplete option: ${argv[i]}`);
    assert(!options[argv[i]], `Repeated option: ${argv[i]}`);
    options[argv[i]] = argv[i] === '--profile' ? argv[i + 1] : resolve(argv[i + 1]);
  }
  assert(options['--package-dir'], '--package-dir is required (developer qualification only)');
  assert(options['--fixture'], '--fixture is required');
  options['--profile'] ??= 'migration';
  assert(['migration', 'responses'].includes(options['--profile']), 'Invalid qualification profile');
  return options;
}

export async function exportedApi(packageDir, manifest, name) {
  const declaration = manifest.exports[`./${name}`];
  assert(typeof declaration?.import === 'string', `Missing public export: agentkit/${name}`);
  return import(pathToFileURL(resolve(packageDir, declaration.import)).href);
}

async function filesUnder(root, at = root) {
  const files = [];
  for (const entry of await readdir(at, { withFileTypes: true })) {
    const path = join(at, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(root, path));
    else {
      assert(entry.isFile(), `Unexpected artifact entry: ${path}`);
      files.push(relative(root, path));
    }
  }
  return files.sort();
}

export async function verifyArtifact(options, manifest) {
  const expected = ARTIFACTS[manifest.version];
  assert.equal(manifest.name, 'agentkit');
  assert(expected, `Unrecognized unpublished candidate version: ${manifest.version}`);
  const tarball = options['--tarball'] ?? resolve(options['--package-dir'], '../../../..',
    'tarballs', `agentkit-${manifest.version}.tgz`);
  const sha256 = hash(await readFile(tarball));
  assert.equal(sha256, expected, 'Candidate artifact SHA-256 differs from canonical evidence');
  const extraction = await mkdtemp(join(tmpdir(), 'openpcb-candidate-'));
  try {
    execFileSync('tar', ['-xzf', tarball, '-C', extraction]);
    const root = join(extraction, 'package');
    const files = await filesUnder(root);
    for (const file of files) {
      assert.equal(hash(await readFile(join(options['--package-dir'], file))),
        hash(await readFile(join(root, file))), `Installed candidate differs from artifact: ${file}`);
    }
    return { name: manifest.name, version: manifest.version, tarball, sha256,
      installedFilesVerified: files.length, publication: 'unpublished developer candidate' };
  } finally {
    await rm(extraction, { recursive: true, force: true });
  }
}

export function stubTools(definitions, executionLog) {
  return definitions.map((definition) => ({
    definition,
    async execute(context, input) {
      assert.equal(definition.name, 'designer_get_design_summary',
        'Qualification stub refuses all tools except the read fixture');
      executionLog.push({ tool: definition.name, input: clone(input) });
      const data = { designId: 'qualification-design', revision: 7, partIds: ['qualification-part'] };
      return { ok: true, data, modelData: data, summary: 'Synthetic read fixture.',
        sources: [], warnings: [], truncated: false, limits: context.limits };
    },
  }));
}

export async function catalogQualification(core, host, definitions, tools) {
  const errors = [];
  const registry = new core.AiToolRegistry();
  for (const tool of tools) {
    try { registry.register(tool); }
    catch (error) {
      errors.push({ tool: tool.definition.name, code: error.code, message: error.message });
    }
  }
  const warnings = [];
  const contributor = { namespace: 'openpcb', contribute: async () => tools };
  const catalog = host.createContributorToolCatalog({ contributors: [contributor],
    logger: { debug() {}, info() {}, error() {}, warn(message, fields) {
      warnings.push({ message, ...fields });
    } } });
  const entries = await catalog.listTools();
  const missing = definitions.filter((definition) => !entries.some(
    (entry) => entry.definition.name === definition.name)).map((definition) => definition.name);
  for (const entry of entries) {
    assert.equal(entry.namespace, 'openpcb');
    assert.deepEqual(entry.definition, definitions.find((item) => item.name === entry.definition.name));
  }
  return { contributor, result: { passed: errors.length === 0 && missing.length === 0,
    expectedCount: definitions.length, actualCount: entries.length, namespace: 'openpcb',
    schemaErrors: errors, missing, warnings, entries } };
}

function terminal() {
  return { type: 'response.completed', response: { id: 'qualification-response', status: 'completed',
    output: [{ type: 'message', id: 'qualification-message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'Qualification complete.' }] }] } };
}

async function responsesRequest(core, definitions, authKind, messages) {
  if (typeof core.ResponsesClient !== 'function') {
    return { passed: false, supported: false, reason: 'Public ResponsesClient export unavailable' };
  }
  const requests = [];
  const identity = { providerId: 'qualification-provider', protocol: 'responses',
    connectionId: 'qualification-connection', generation: 1 };
  const client = new core.ResponsesClient({ id: identity.providerId, transport: {
    identity, authKind,
    async request(input) {
      assert.deepEqual(input.connectionIdentity, identity);
      requests.push({ operation: input.operation, connectionIdentity: clone(input.connectionIdentity),
        body: clone(input.body) });
      return new Response(`data: ${JSON.stringify(terminal())}\n\n`, {
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  } });
  const events = [];
  for await (const event of client.streamChat({ runId: 'qualification-run', model: 'mock-model',
    messages, tools: definitions })) events.push(event);
  const failure = events.find((event) => event.type === 'run.failed');
  if (failure) return { passed: false, supported: true, error: failure.data, requestCount: requests.length };
  assert.equal(requests.length, 1);
  const body = requests[0].body;
  assert.equal(body.tools.length, 1);
  assert.equal(body.tools[0].name, 'agentkit');
  for (const [index, definition] of definitions.entries()) {
    const serialized = body.tools[0].tools[index];
    assert.equal(serialized.name, definition.name);
    assert.deepEqual(serialized.parameters, definition.inputSchema);
    assert.equal(serialized.strict, false);
  }
  const call = body.input.find((item) => item.type === 'function_call');
  const output = body.input.find((item) => item.type === 'function_call_output');
  if (call) {
    assert.equal(call.call_id, 'qualification-call');
    assert.equal(call.namespace, 'agentkit');
    assert.equal(output.call_id, call.call_id);
    assert.deepEqual(JSON.parse(output.output), { designId: 'qualification-design', revision: 7,
      partIds: ['qualification-part'] });
  }
  return { passed: true, supported: true, requestCount: requests.length, requests, events };
}

export async function responsesQualification(core, definitions) {
  const messages = [{ role: 'user', content: 'Inspect qualification fixture.' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'qualification-call',
      name: 'designer_get_design_summary', argumentsJson: '{}' }] },
    { role: 'tool', toolCallId: 'qualification-call', content: JSON.stringify({
      designId: 'qualification-design', revision: 7, partIds: ['qualification-part'] }) }];
  const profiles = {};
  for (const profile of ['api-key', 'chatgpt-account']) {
    const all = await responsesRequest(core, definitions, profile, messages);
    const individual = [];
    for (const definition of definitions) {
      const checked = await responsesRequest(core, [definition], profile,
        [{ role: 'user', content: 'Serialize schema only.' }]);
      individual.push({ tool: definition.name, passed: checked.passed, supported: checked.supported,
        error: checked.error, reason: checked.reason, requestCount: checked.requestCount });
    }
    profiles[profile] = { all, individual };
  }
  return { passed: Object.values(profiles).every((profile) => profile.all.passed), profiles };
}

async function hostQualification(api, contributor, executionLog) {
  const { host, memory, local, testing } = api;
  const store = new memory.MemoryAssistantStore();
  const taskRunner = new local.SingleProcessTaskRunner({ store, recoveryMode: 'manual' });
  const mock = new testing.MockProviderClient();
  mock.setScript([
    { steps: [{ kind: 'tool_call', toolCallId: 'qualification-call',
      name: 'designer_get_design_summary', argumentsJson: '{}' }] },
    { steps: [{ kind: 'text', content: 'Synthetic design has revision 7.' }] },
  ]);
  const providerRequests = [];
  const client = { id: mock.id, kind: mock.kind,
    capabilities: () => mock.capabilities(), listModels: () => mock.listModels(),
    streamChat(input) { providerRequests.push(clone(input)); return mock.streamChat(input); } };
  await store.providers.upsertProvider({ id: 'qualification-provider', label: 'Mock',
    kind: 'openai-compatible', baseUrl: 'http://localhost:1', defaultModel: 'mock-model', enabled: true });
  await store.settings.updateSettings({ defaultProviderId: 'qualification-provider' });
  const chat = await store.conversations.createChat({ id: 'qualification-chat' });
  const runner = new host.TurnRunner({ store, taskRunner, providerFactory: () => client,
    contributors: [contributor], clock: host.defaultClock, ids: host.defaultIds });
  try {
    const submitted = await runner.submitMessage({ chatId: chat.id, content: 'Inspect synthetic fixture.',
      taskId: 'qualification-task' });
    const attempt = await store.tasks.createAttempt({ attemptId: 'qualification-attempt',
      taskId: submitted.runId, ownerId: 'qualification-worker' });
    const lease = await store.tasks.acquireLease({ taskId: submitted.runId,
      attemptId: attempt.attemptId, ownerId: 'qualification-worker', ttlMs: 60_000 });
    await runner.execute({ taskId: submitted.runId, attemptId: attempt.attemptId,
      leaseToken: lease.leaseToken, signal: new AbortController().signal });
    const task = await store.tasks.getTask(submitted.runId);
    assert.equal(task.status, 'completed');
    assert.equal(executionLog.length, 1);
    assert.equal(mock.callCount, 2);
    const toolMessage = providerRequests[1].messages.find((message) => message.role === 'tool');
    assert.equal(toolMessage.toolCallId, 'qualification-call');
    assert.deepEqual(JSON.parse(toolMessage.content).data, { designId: 'qualification-design',
      revision: 7, partIds: ['qualification-part'] });
    const events = await store.tasks.listEvents(submitted.runId);
    return { passed: true, status: task.status, providerCalls: mock.callCount,
      execution: executionLog, toolMessage, events,
      scope: 'Real AgentKit TurnRunner, memory store and local task runner; synthetic read tool only. No OpenPCB domain execution or native app qualification.' };
  } finally { await runner.disposeContributors(); }
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(join(options['--package-dir'], 'package.json'), 'utf8'));
  const artifact = await verifyArtifact(options, manifest);
  const fixtureBytes = await readFile(options['--fixture']);
  const fixture = JSON.parse(fixtureBytes.toString());
  assert.equal(hash(canonicalJson(fixture.data)), fixture.sha256, 'Fixture catalog hash mismatch');
  const definitions = fixture.data.inAppTools;
  assert.equal(definitions.length, 15, 'Baseline changed: review qualification expectations');
  const original = clone(definitions);
  const api = {};
  for (const name of ['contracts', 'core', 'host', 'testing', 'adapters-memory', 'runner-local']) {
    api[{ 'adapters-memory': 'memory', 'runner-local': 'local' }[name] ?? name] =
      await exportedApi(options['--package-dir'], manifest, name);
  }
  const executionLog = [];
  const tools = stubTools(definitions, executionLog);
  const catalog = await catalogQualification(api.core, api.host, definitions, tools);
  const requiresResponses = options['--profile'] === 'responses';
  const responses = requiresResponses
    ? await responsesQualification(api.core, definitions)
    : { required: false, reason: 'Responses is a separate qualification gate' };
  let hostResult;
  try { hostResult = await hostQualification(api, catalog.contributor, executionLog); }
  catch (error) { hostResult = { passed: false, error: error.message, code: error.code }; }
  assert.deepEqual(definitions, original, 'Qualification mutated native definitions');
  const report = { formatVersion: 1, profile: options['--profile'], artifact, runtime: process.version,
    fixture: { path: options['--fixture'], fileSha256: hash(fixtureBytes), catalogSha256: fixture.sha256 },
    passed: catalog.result.passed && (!requiresResponses || responses.passed) && hostResult.passed,
    catalog: catalog.result, responses, host: hostResult,
    limitations: ['Unpublished candidate only; no published install pin qualification.',
      'Mock providers/transports; no OAuth, licensed authentication SDK or paid inference.',
      'Native app, actual OpenPCB domain behavior and packaged distribution remain unqualified.'] };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.passed ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.log(JSON.stringify({ passed: false, error: error.message, code: error.code }, null, 2));
    process.exitCode = 1;
  });
}
