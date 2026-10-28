// Intentionally failing child test: parent asserts both the refusal diagnostic and
// natural process exit. No --test-force-exit: a stranded fixture endpoint must fail it.
import test from 'node:test';
import path from 'node:path';
import { symlink } from 'node:fs/promises';
import { fixture, barrier } from './adoption-support.mjs';

test('a refused workflow cannot strand a phase wait or its fixture endpoint', { timeout: 15_000 }, async t => {
  const f = await fixture(); t.after(f.dispose);
  const alias = path.join(f.home, '.pi', 'cwd-alias');
  await symlink(f.home, alias, process.platform === 'win32' ? 'junction' : 'dir');
  f.context.cwd = alias; // The existing canonical-home safety gate must refuse this.
  const gate = barrier();
  const pending = f.workflow({ phase: async phase => {
    if (phase === 'prepared-committed') await gate.wait();
  } }).run(f.context, 'adopt');
  try {
    await gate.until(pending);
  } finally {
    gate.release(); await Promise.allSettled([pending]);
  }
});
