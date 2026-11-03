// Intentionally failing child test: parent asserts both the refusal diagnostic and
// natural process exit. No --test-force-exit: a stranded fixture endpoint must fail it.
import test from 'node:test';
import path from 'node:path';
import { mkdir, symlink } from 'node:fs/promises';
import { fixture, standalone, barrier } from './adoption-support.mjs';

test('a refused workflow cannot strand a phase wait or its fixture endpoint', { timeout: 15_000 }, async t => {
  const f = await fixture(); t.after(f.dispose);
  // ADR 0025 fixtures carry no committed claim/session store; create the alias parent explicitly.
  const alias = path.join(f.home, '.pi', 'cwd-alias');
  await mkdir(path.dirname(alias), { recursive: true });
  await symlink(f.home, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const gate = barrier();
  const workflow = standalone(f, {
    phase: async phase => { if (phase === 'before-publish') await gate.wait(); },
  });
  workflow.context.cwd = alias;
  const pending = workflow.workflow.run(workflow.context, 'adopt');
  try {
    await gate.until(pending);
  } finally {
    gate.release(); await Promise.allSettled([pending]);
  }
});
