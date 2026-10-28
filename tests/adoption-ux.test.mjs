// Acceptance surface for ADR 0025 (issue #25 AC1–AC9): one native confirmation for existing-board
// adoption, zero questions/commands for first-board startup, and zero Git/claim influence. These use the
// real runtime + workflow against disposable projects-home directories; no Git repository is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fixture, standalone, declineUI } from './fixtures/adoption-support.mjs';
import { createFixture, configText, mockUi, IDS } from './fixtures/adoption-fixture.mjs';
import { AdoptionDecisionCaptureFailure, AdoptionHostUiUnavailable } from '../dist/adoption.js';

test('first-board startup asks nothing, writes no evidence record and loads responsibility', async t => {
  const f = await fixture({ noBoard: true });
  t.after(() => f.dispose());
  // The support fixture's runtime already started as the canonical Orchestrator: startup created the board.
  const config = await f.boardConfig();
  assert.equal(config.agents.length, 1);
  assert.equal(config.agents[0].sessionId, f.id);
  assert.equal(f.ui.prompts.length, 0);
  await assert.rejects(readFile(path.join(f.home, 'coordinator-claim.md')), { code: 'ENOENT' });
  assert.equal(f.runtime.responsibility?.coordinator, true);
});

test('existing-board replacement shows root, both pairs and preservation, then asks exactly once', async t => {
  const f = await fixture();
  t.after(() => f.dispose());
  const result = await f.adopt();
  assert.equal(result.code, 'OK', result.lines.join('\n'));
  assert.equal(f.ui.prompts.length, 1);
  const question = f.ui.prompts[0].prompt;
  for (const expected of [f.home, IDS.gone, IDS.fresh, String(f.ports.coordinator), 'Builder', 'Reviewer']) {
    assert.ok(question.includes(expected), `question must name ${expected}`);
  }
  assert.match(question, /every other parsed value is preserved/i);
  assert.match(question, /jobs, close jobs, handoffs, history/i);
  assert.match(question, /disconnected or unknown endpoint probe is not evidence/i);
});

test('the question never asks for typed wording, an ended attestation or a second answer', async t => {
  const f = await fixture();
  t.after(() => f.dispose());
  await f.adopt();
  const question = f.ui.prompts[0].prompt;
  assert.doesNotMatch(question, /I confirm coordinator/i);
  assert.doesNotMatch(question, /type|paste|write the exact/i);
  assert.doesNotMatch(question, /finaliz|renew|declar/i);
  assert.equal(f.ui.prompts.length, 1);
});

test('an already matching pair is load-only: no question, no write, CURRENT', async t => {
  const f = await fixture({ self: true });
  t.after(() => f.dispose());
  const before = await f.board.read();
  const result = await f.adopt();
  assert.equal(result.code, 'CURRENT');
  assert.equal(f.ui.prompts.length, 0);
  assert.equal(await f.board.read(), before);
});

test('No, Esc and a dismissal all change nothing; a fresh invocation asks again', async t => {
  const f = await fixture({ ui: declineUI() });
  t.after(() => f.dispose());
  const before = await f.board.read();
  assert.equal((await f.adopt()).code, 'CANCELLED');
  assert.equal((await f.adopt()).code, 'CANCELLED');
  assert.equal(f.ui.prompts.length, 2, 'each fresh invocation is a new decision');
  assert.equal(await f.board.read(), before);
});

test('an unreadable capture is neither yes nor dismiss, and an unavailable surface is a named HOST stop', async t => {
  const capture = await fixture({ ui: mockUi({ adoptCoordinator: { throws: new AdoptionDecisionCaptureFailure('selection returned nothing') } }) });
  t.after(() => capture.dispose());
  const before = await capture.board.read();
  assert.equal((await capture.adopt()).code, 'CONFIRMATION');
  assert.equal(await capture.board.read(), before);

  const host = await fixture({ ui: mockUi({ adoptCoordinator: { throws: new AdoptionHostUiUnavailable('no selection surface') } }) });
  t.after(() => host.dispose());
  const hostBefore = await host.board.read();
  assert.equal((await host.adopt()).code, 'HOST');
  assert.equal(await host.board.read(), hostBefore);
});

test('a live old coordinator refuses before the question opens', async t => {
  const f = await fixture();
  t.after(() => f.dispose());
  // Occupy the saved old pair with an endpoint that answers for the same old identity.
  const { listen } = await import('../dist/transport.js');
  const live = await listen(0, async () => {}, () => ({ version: 1, sessionId: IDS.gone }));
  f.track(live);
  await f.board.write((await f.board.read()).replace(`"port": ${f.ports.coordinator}`, `"port": ${live.port}`));
  const result = await f.adopt();
  await live.close();
  assert.equal(result.code, 'OLD_CONNECTED');
  assert.equal(f.ui.prompts.length, 0);
});

test('Git, its absence, dirty state and the legacy claim have zero influence on the same config/answer', async t => {
  // On POSIX a fake `git` on PATH records any invocation: production adoption must never call it.
  // Windows has no POSIX shebang launcher; the no-repository case still proves the same contract there,
  // and the source has no child-process import in adoption/config at all.
  let marker;
  const prior = process.env.PATH, priorGit = process.env.GIT_DIR;
  if (process.platform !== 'win32') {
    marker = path.join((await createFixture()).home, 'git-was-called');
    const bin = path.dirname(marker);
    await writeFile(path.join(bin, 'git'), `#!/bin/sh\ntouch ${JSON.stringify(marker)}\nexit 1\n`);
    await chmod(path.join(bin, 'git'), 0o755);
    process.env.PATH = `${bin}${path.delimiter}${prior}`;
  }
  process.env.GIT_DIR = '/injected/nonsense';
  t.after(() => { process.env.PATH = prior; if (priorGit === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = priorGit; });
  for (const style of ['full', 'single', 'minified', 'irregular', 'unknownField', 'escaped']) {
    const f = await fixture({ style });
    t.after(() => f.dispose());
    const result = await f.adopt();
    assert.equal(result.code, 'OK', `${style}: ${result.lines.join('\n')}`);
    assert.equal(f.ui.prompts.length, 1);
    const board = (await f.boardConfig()).agents.find(agent => agent.coordinator);
    assert.equal(board.sessionId, IDS.fresh);
  }
  if (marker) await assert.rejects(readFile(marker), { code: 'ENOENT' }, 'adoption invoked Git');
});

test('the complete parsed config is preserved: unknown fields, escaped keys, jobs and array order', async t => {
  const f = await createFixture();
  t.after(() => f.dispose());
  await f.board.write(configText('unknownField', f.ports()));
  const before = JSON.parse(await f.board.read());
  const s = standalone(f, { port: 42235 });
  assert.equal((await s.workflow.run(s.context, 'adopt')).code, 'OK');
  const after = JSON.parse(await f.board.read());
  const expected = structuredClone(before);
  expected.agents[0].sessionId = IDS.fresh;
  expected.agents[0].port = 42235;
  assert.deepEqual(after, expected);
  assert.deepEqual(after.futureRoot, before.futureRoot);
  assert.deepEqual(after.agents[1].jobs, before.agents[1].jobs);
  assert.equal(Object.prototype.hasOwnProperty.call(after.agents[0], 'futureField'), true);
});

test('escaped keys and a literal own __proto__ member survive the full parse/serialize roundtrip', async t => {
  const f = await createFixture();
  t.after(() => f.dispose());
  await f.board.write(configText('escaped', f.ports()));
  const before = JSON.parse(await f.board.read());
  assert.equal(Object.prototype.hasOwnProperty.call(before.agents[0], '__proto__'), true);
  const s = standalone(f, { port: 42239 });
  assert.equal((await s.workflow.run(s.context, 'adopt')).code, 'OK');
  const after = JSON.parse(await f.board.read());
  assert.equal(after.agents[0].sessionId, IDS.fresh);
  assert.equal(Object.prototype.hasOwnProperty.call(after.agents[0], '__proto__'), true);
  assert.deepEqual(after.agents[0]['__proto__'], before.agents[0]['__proto__']);
  assert.equal(after.agents[0]['line\u0020break'], 'escaped key');
  assert.equal(after.agents[1].note, '\ud83d\ude80 kept');
});

test('a command outside projects home or behind an aliased cwd refuses with a named path error', async t => {
  const f = await createFixture();
  t.after(() => f.dispose());
  await f.board.write(configText('single', f.ports()));
  const outside = await f.extra.boardOutside();
  const s = standalone(f, { port: 42236 });
  s.context.cwd = outside;
  const result = await s.workflow.run(s.context, 'adopt');
  assert.equal(result.code, 'BOARD_PATH');
  assert.match(result.lines.join(' '), /outside projects home|not resolvable/i);
});

test('wrong launch role and non-interactive/busy contexts refuse without a question', async t => {
  const f = await fixture();
  t.after(() => f.dispose());
  // Wrong role: this process was launched as a developer, not the canonical Orchestrator.
  const developer = await fixture({ launch: 'developer' });
  t.after(() => developer.dispose());
  assert.equal((await developer.adopt()).code, 'AUTH');
  assert.equal(developer.ui.prompts.length, 0);

  const s = standalone(f, { port: 42237 });
  s.context.mode = 'print';
  assert.equal((await s.workflow.run(s.context, 'adopt')).code, 'MODE');
  assert.equal(s.ui.prompts.length, 0);

  s.context.mode = 'tui'; s.context.isIdle = () => false;
  assert.equal((await s.workflow.run(s.context, 'adopt')).code, 'BUSY');
  assert.equal(s.ui.prompts.length, 0);

  s.context.isIdle = () => true; s.context.isProjectTrusted = () => false;
  assert.equal((await s.workflow.run(s.context, 'adopt')).code, 'TRUST');
});

test('a replacement that fails local promotion keeps the published pair and never re-asks on retry', async t => {
  const f = await createFixture();
  t.after(() => f.dispose());
  await f.board.write(configText('full', f.ports()));
  const s = standalone(f, { port: 42238, promote: async () => 'injected load failure' });
  assert.equal((await s.workflow.run(s.context, 'adopt')).code, 'PROMOTION_PENDING');
  const published = await f.board.read();
  const retry = standalone(f, { port: 42238, ui: mockUi({ adoptCoordinator: 'decline' }) });
  assert.equal((await retry.workflow.run(retry.context, 'adopt')).code, 'CURRENT');
  assert.equal(retry.ui.prompts.length, 0);
  assert.equal(await f.board.read(), published);
});

test('status is read-only and never asks, promotes or writes', async t => {
  const f = await fixture();
  t.after(() => f.dispose());
  const before = await f.board.read();
  const status = await f.adopt('status');
  assert.equal(status.ok, true);
  assert.equal(f.ui.prompts.length, 0);
  assert.equal(await f.board.read(), before);
  assert.equal(f.runtime.responsibility, undefined);
});

test('board isolation refuses a child board and names paths; the empty-stray guidance stays human-only', async t => {
  const f = await fixture({ cwdRelative: 'app' });
  t.after(() => f.dispose());
  const nested = await f.extra.boardAt('app');
  const result = await f.adopt();
  assert.equal(result.code, 'BOARD_COUNT');
  const text = result.lines.join('\n');
  assert.ok(text.includes(path.join(nested, '.pi-intercom')));
  assert.ok(text.includes(path.join(f.home, '.pi-intercom')));
  assert.match(text, /confirmed empty/);
  assert.doesNotMatch(text, /rm -rf|deleted automatically|automatic cleanup/i);
});
