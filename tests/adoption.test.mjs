import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const source = await readFile(new URL('./fixtures/adoption-runner.mjs', import.meta.url), 'utf8');
// Every declared scenario is exercised; missing modules/assertions fail, never skipped/green.
const names = [...source.matchAll(/^\s*'([^']+)': \{/gm)].map(match => match[1]);
assert.equal(names.length, 108, 'fixture table gained or lost a case without an explicit decision');
for (const name of names) test(`adoption fixture ${name}`, () => {
  const env = { ...process.env }; delete env.PI_ROLE_DIR; delete env.PI_INTERCOM_WORKER_ROLE;
  const child = spawnSync(process.execPath, ['tests/fixtures/adoption-runner.mjs', name], { env, encoding: 'utf8', timeout: 20000 });
  assert.ifError(child.error);
  const output = child.stdout + child.stderr;
  assert.doesNotMatch(output, /FIXTURE ERROR|NOT_PROVEN/);
  assert.match(output, /TERMINAL: /);
  assert.ok([0, 1, 2].includes(child.status), output);
  assert.match(output, /(?:EXPECT .* MATCHED|ASSERT .* PASS)/, `no actual proof for ${name}: ${output}`);
});
