import { build } from 'esbuild';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(join(tmpdir(), 'openpcb-assistant-parity-'));
try {
  await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const outfile = join(directory, 'retirement.node-test.mjs');
  await build({ entryPoints: [join(root, 'src/core/backend/tests/fixtures/assistant-parity/retirement.node.ts')],
    outfile, bundle: true, platform: 'node', format: 'esm', external: ['agentkit', 'agentkit/*', 'better-sqlite3'],
    banner: { js: "import { createRequire as createFixtureRequire } from 'node:module'; const require = createFixtureRequire(import.meta.url);" } });
  const result = spawnSync(process.execPath, ['--test', outfile], { cwd: root, stdio: 'inherit', timeout: 120_000 });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { await rm(directory, { recursive: true, force: true }); }
