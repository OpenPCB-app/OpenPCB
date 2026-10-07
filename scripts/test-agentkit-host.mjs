import { build } from 'esbuild';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(join(tmpdir(), 'openpcb-agentkit-host-test-'));
try {
  await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const files = ['host.node-test', 'redaction.node-test'];
  await Promise.all(files.map((name) => build({
    entryPoints: [join(root, `src/modules/assistant/backend/agentkit/${name}.ts`)],
    outfile: join(directory, `${name}.mjs`), bundle: true, platform: 'node', format: 'esm', packages: 'external',
  })));
  const result = spawnSync(process.env.OPENPCB_AGENTKIT_TEST_EXECUTABLE ?? process.execPath, ['--test', ...files.map((name) => join(directory, `${name}.mjs`))], { cwd: root, stdio: 'inherit', timeout: 120_000 });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
