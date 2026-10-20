// Issue #9 question visibility and issue #12 single-decision adoption UX: first-declaration authorization,
// question content, named confirmation-surface failures, and the narrow first-declaration Git exception.
// Test-only; nothing here is shipped and no live board, installed role, or real coordinator is involved.
// Every case runs the real dist/ workflow against a disposable temporary projects-home repository with
// ephemeral loopback endpoints. What an operator actually sees is `adoption-ui.test.mjs`'s subject; this
// file proves which questions the workflow asks, in what order, what it writes for each answer, and what
// it refuses to write.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AdoptionDecisionCaptureFailure, AdoptionHostUiUnavailable, ENDED_WORDING, declarationEvidence, leftUnchanged, parseClaim, renderClaim } from '../dist/adoption.js';
import { patchCoordinatorEntry } from '../dist/config.js';
import { IDS, mockUi } from './fixtures/adoption-fixture.mjs';
import { fixture } from './fixtures/adoption-support.mjs';

const DECLARATION_KINDS = ['boardInitialize', 'firstCoordinatorDeclaration'];
const text = result => result.lines.join('\n');

/**
 * The default script: answer each branch's single decision affirmatively; one answer may be replaced per
 * case. The mock is the shared one, which has no `input` member at all: a workflow that still asked for
 * typed text would throw here, in every case, rather than only in whichever test looks for it.
 */
function answers(overrides = {}) {
  const merged = {
    boardInitialize: 'confirm', firstCoordinatorDeclaration: 'confirm', adoptTransition: 'confirm',
    renewAdoptionDecision: 'confirm', finalizeTransition: 'confirm', ...overrides,
  };
  return mockUi(merged);
}

/** Every externally visible effect an adoption could produce, captured as one comparable snapshot. */
async function surface(f) {
  const read = async file => { try { return await readFile(file, 'utf8'); } catch { return undefined; } };
  return {
    board: await read(f.configPath()),
    claim: await read(f.claimPath()),
    head: (await f.git(['rev-parse', 'HEAD'])).stdout.trim(),
    commits: Number((await f.git(['rev-list', '--count', 'HEAD'])).stdout.trim()),
    index: (await f.git(['diff', '--cached', '--name-only', '-z'])).stdout.split('\0').filter(Boolean),
    status: (await f.git(['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '--untracked-files=all', '-z'])).stdout.split('\0').filter(Boolean),
    ignore: await read(path.join(f.home, '.gitignore')),
    ready: f.state.ready,
  };
}
/** A refusal must leave every one of those effects exactly as it was. */
function assertNothingChanged(before, after) {
  assert.equal(after.board, before.board, 'a refused invocation changed the board');
  assert.equal(after.claim, before.claim, 'a refused invocation wrote or normalized the claim path');
  assert.equal(after.head, before.head, 'a refused invocation moved HEAD');
  assert.equal(after.commits, before.commits, 'a refused invocation created a commit');
  assert.deepEqual(after.index, before.index, 'a refused invocation touched the real index');
  assert.deepEqual(after.status, before.status, 'a refused invocation changed working-tree state');
  assert.equal(after.ignore, before.ignore, 'a refused invocation changed ignore rules');
  assert.equal(after.ready, false, 'a refused invocation opened action readiness');
}
/** The scratch an operator actually leaves behind: a backup directory and a nested scratch clone. */
async function scratch(f) {
  await mkdir(path.join(f.home, 'backup-2026-10-18'), { recursive: true });
  const backup = path.join(f.home, 'backup-2026-10-18', 'config.json.bak');
  await writeFile(backup, '{ "not": "the board" }\n');
  const clone = path.join(f.home, 'scratch', 'notes');
  await mkdir(clone, { recursive: true });
  await f.git(['init', '-q'], clone);
  const notes = path.join(clone, 'todo.md');
  await writeFile(notes, 'unrelated scratch clone\n');
  return [backup, notes];
}
const fingerprint = files => Promise.all(files.map(async file => `${(await stat(file)).mtimeMs}:${await readFile(file, 'utf8')}`));
const changedPaths = async f => (await f.git(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'])).stdout.trim();
const has = (prompts, kind) => prompts.some(prompt => prompt.kind === kind);
const promptFor = (prompts, kind) => (prompts.find(prompt => prompt.kind === kind) ?? { prompt: '<absent>' }).prompt;

/**
 * Commit a prepared intent for this session, in the state a crashed adoption actually leaves behind.
 * `prepared-before` is the committed intent with the old board still published; `prepared-after` is the
 * same intent with the replacement already published, which is the finalization branch.
 */
async function seedPrepared(f, which) {
  const before = await f.board.read();
  const boardEntry = (await f.board.parsed()).agents.find(agent => agent.coordinator);
  const after = patchCoordinatorEntry(before, f.id, f.endpoint.port).after;
  const intent = {
    ...(await f.declaration()),
    phase: 'prepared',
    coordinator: { sessionId: f.id, port: f.endpoint.port },
    authority: { kind: 'adoption', record: 'fixture anchored authority', confirmedEndedAt: '2026-10-16T09:00:00.000Z', wording: ENDED_WORDING(IDS.gone) },
    previous: { sessionId: IDS.gone, port: boardEntry.port, claimDate: null },
    configBeforeSha256: f.sha256(before),
    configAfterSha256: f.sha256(after),
    leftUnchanged: leftUnchanged(await f.board.scan()),
  };
  await f.claim.writeAndCommit(intent);
  if (which === 'prepared-after') await f.board.write(after);
  return intent;
}

// ---- AC1: the first board is one visible yes/no -------------------------------------------------

test('AC1 first board: one visible yes/no, no text question, generated schema-valid evidence', async t => {
  const f = await fixture({ noBoard: true });
  try {
    const before = await surface(f);
    const result = await f.workflow().run(f.context, 'adopt');
    assert.equal(result.code, 'DECLARED', text(result));
    const kinds = f.ui.prompts.map(prompt => prompt.kind);
    assert.deepEqual(kinds, ['boardInitialize'], `expected exactly the boardInitialize decision, saw ${kinds.join(', ')}`);
    const prompt = f.ui.prompts[0].prompt;
    for (const required of [f.home, f.id, String(f.endpoint.port), 'coordinator-claim.md', 'commit it alone', 'action readiness']) {
      assert.ok(prompt.includes(required), `the first-board question must show ${required}: ${prompt}`);
    }
    const record = parseClaim(await f.claim.read());
    assert.equal(record.authority.kind, 'first-coordinator declaration');
    assert.equal(record.authority.confirmedEndedAt, null, 'a declaration never records a termination timestamp');
    assert.equal(record.phase, 'active');
    assert.equal(record.previous, null);
    assert.equal(record.intentCommit, null);
    assert.equal(record.previousRecordCommit, null);
    assert.equal(record.configBeforeSha256, record.configAfterSha256);
    assert.equal(record.coordinator.sessionId, f.id);
    assert.equal(record.coordinator.port, f.endpoint.port);
    assert.match(record.authority.record, new RegExp(`boardRoot SHA256 ${f.sha256(f.home)}`));
    assert.ok(record.authority.record.includes(f.id) && record.authority.record.includes(String(f.endpoint.port)));
    assert.match(record.authority.record, /Implementation-generated evidence, not a typed external reference/);
    assert.ok(record.authority.wording.length > 0 && !record.authority.wording.includes('I confirm coordinator'),
      'generated wording describes the yes/no decision and never imitates the termination sentence');
    assert.equal(await changedPaths(f), 'coordinator-claim.md', 'the generated commit changes only the claim');
    assert.equal(f.state.ready, true, 'committed evidence plus promotion opens readiness');
    const after = await surface(f);
    assert.notEqual(after.claim, before.claim);
    assert.equal(after.commits, before.commits + 1);
    assert.deepEqual(after.index, [], 'the workflow leaves no staged content behind');
  } finally { await f.dispose(); }
});

// A dismissal and a No are one outcome at this seam, and deliberately so: the adapter in
// `adoption-ui.test.mjs` is where a host cancellation becomes `false`, and it proves both routes reach
// that same safe answer. What the domain must guarantee is that `false` writes nothing.
test('AC1 first board declined: no board, config, claim, commit, or readiness', async t => {
  const f = await fixture({ noBoard: true });
  try {
    const scripted = answers({ boardInitialize: 'decline' });
    f.context.ui = scripted.ui;
    const before = await surface(f);
    const result = await f.workflow().run(f.context, 'adopt');
    assert.equal(result.code, 'CANCELLED', text(result));
    assert.match(text(result), /first-board initialization/);
    assert.deepEqual(scripted.prompts.map(prompt => prompt.kind), ['boardInitialize'], 'a declined board asks nothing else');
    assert.equal(await stat(f.configPath()).then(() => true, () => false), false, 'a declined decision must not create a board');
    assertNothingChanged(before, await surface(f));
  } finally { await f.dispose(); }
});

// ---- AC2: an existing self board declares itself by yes/no --------------------------------------

test('AC2 existing self board with no claim history: explicit declaration, no typed record', async t => {
  const f = await fixture({ self: true });
  try {
    const before = await surface(f);
    const result = await f.workflow().run(f.context, 'adopt');
    assert.equal(result.code, 'DECLARED', text(result));
    assert.deepEqual(f.ui.prompts.map(prompt => prompt.kind), ['firstCoordinatorDeclaration']);
    const prompt = f.ui.prompts[0].prompt;
    for (const required of [f.home, f.id, String(f.endpoint.port), 'is NOT replaced', 'first declaration, not an adoption']) {
      assert.ok(prompt.includes(required), `the declaration question must show ${required}: ${prompt}`);
    }
    assert.ok(prompt.includes(f.sha256(before.board)), 'declaration shows the exact config hash');
    for (const worker of (await f.board.parsed()).agents.filter(agent => !agent.coordinator)) {
      assert.ok(prompt.includes(worker.name), 'declaration names each untouched worker');
      if (worker.closeJob) assert.ok(prompt.includes(`${worker.name}/${worker.closeJob.state}`), 'declaration shows each close-job fence');
    }
    const record = parseClaim(await f.claim.read());
    assert.equal(record.authority.kind, 'first-coordinator declaration');
    assert.equal(record.coordinator.port, f.endpoint.port);
    assert.equal(await changedPaths(f), 'coordinator-claim.md');
    const after = await surface(f);
    assert.equal(after.board, before.board, 'a declaration never replaces the board config');
    assert.equal(after.ignore, before.ignore);
    assert.equal(f.state.ready, true);
  } finally { await f.dispose(); }
});

test('AC2 self declaration declined writes nothing', async t => {
  const f = await fixture({ self: true });
  try {
    f.context.ui = answers({ firstCoordinatorDeclaration: 'decline' }).ui;
    const before = await surface(f);
    const result = await f.workflow().run(f.context, 'adopt');
    assert.equal(result.code, 'CANCELLED', text(result));
    assert.match(text(result), /first-coordinator declaration/);
    assertNothingChanged(before, await surface(f));
  } finally { await f.dispose(); }
});

for (const [label, prepare, expected] of [
  ['a committed claim naming another pair', async f => f.claim.writeAndCommit(await f.declaration({ sessionId: 'committed-record', port: 41777 })), 'CLAIM_OTHER'],
  ['a committed claim disagreeing only on port', async f => f.claim.writeAndCommit(await f.declaration({ sessionId: f.id, port: 41778 })), 'CLAIM_OTHER'],
  ['a newer committed claim', async f => {
    await f.claim.writeAndCommit(await f.declaration());
    await f.claim.writeAndCommit(await f.declaration({ sessionId: 'newer-record', port: 41779 }));
  }, 'CLAIM_OTHER'],
  ['a malformed committed claim', async f => { await f.claim.write('# Coordinator claim\n\n```json\n{ "not": "canonical" }\n```\n'); await f.claim.commit(); }, 'RECORD'],
  ['an uncommitted worktree claim', async f => f.claim.write('# Coordinator claim\n\n```json\n{}\n```\n'), 'RECORD'],
  ['a deleted worktree claim with committed history', async f => { await f.claim.writeAndCommit(await f.declaration()); await f.gitOk(['rm', '-q', 'coordinator-claim.md']); }, 'RECORD'],
]) {
  test(`AC2 claim history is never reclassified as a first declaration: ${label}`, async t => {
    const f = await fixture({ self: true });
    try {
      await prepare(f);
      const before = await surface(f);
      const result = await f.workflow().run(f.context, 'adopt');
      assert.equal(result.code, expected, text(result));
      for (const kind of DECLARATION_KINDS) {
        assert.ok(!has(f.ui.prompts, kind), `${kind} must never be offered where claim history exists`);
      }
      assert.ok(!has(f.ui.prompts, 'authorityRecord') && !has(f.ui.prompts, 'endedWording'), 'no text gate is opened on a refused history branch');
      assert.equal((await surface(f)).commits, before.commits, 'a refusal never commits');
    } finally { await f.dispose(); }
  });
}

// ---- AC4: the backend-selected target, never a model- or operator-chosen one --------------------

test('AC4 current, board, and claim-record ids all differ: the one decision names the board entry, and so does the evidence', async t => {
  const f = await fixture();
  try {
    await f.claim.writeAndCommit(await f.declaration({ sessionId: 'committed-record-coordinator', port: 41666 }));
    // Read the board entry before the run: an accepted adoption replaces it, and the point of this case
    // is which of the three pairs the backend selected.
    const boardEntry = (await f.board.parsed()).agents.find(agent => agent.coordinator);
    const scripted = answers();
    f.context.ui = scripted.ui;
    const before = await surface(f);
    const result = await f.workflow().run(f.context, 'adopt');
    assert.equal(result.code, 'OK', text(result));
    assert.deepEqual(scripted.prompts.map(prompt => prompt.kind), ['adoptTransition'],
      'one decision is asked, whatever a disagreeing claim record happens to say');
    const prompt = scripted.prompts[0].prompt;
    assert.ok(prompt.includes(ENDED_WORDING(IDS.gone)), 'the attestation offered names the configured board coordinator');
    assert.ok(prompt.includes(String(boardEntry.port)), 'with that coordinator\'s actual port');
    assert.ok(prompt.includes('committed-record-coordinator'), 'a differing claim-record id is shown as separate context');
    assert.ok(prompt.includes('41666'), 'including its port, so the three pairs are distinguishable');
    assert.ok(!prompt.includes(ENDED_WORDING('committed-record-coordinator')), 'the claim-record id is never the selected target');
    assert.ok(!prompt.includes(ENDED_WORDING(f.id)), 'the current session is never the selected target');
    assert.ok(prompt.includes(f.id) && prompt.includes('This session'), 'the current session is labelled as itself');
    const record = parseClaim(await f.claim.read());
    assert.equal(record.previous.sessionId, IDS.gone, 'the committed previous is the backend-selected board entry');
    assert.equal(record.previous.port, boardEntry.port, 'including its port');
    assert.equal(record.authority.wording, ENDED_WORDING(IDS.gone), 'and the recorded attestation is the one the yes accepted');
    assert.ok(!text(result).includes('committed-record-coordinator port'), 'a refusal is not needed to keep the record honest');
    assert.notEqual((await surface(f)).commits, before.commits, 'the accepted transition did commit');
  } finally { await f.dispose(); }
});

test('AC4 supported prepared renewal selects its validated previous coordinator', async t => {
  const f = await fixture();
  try {
    const before = await f.board.read();
    const boardEntry = (await f.board.parsed()).agents.find(agent => agent.coordinator);
    const after = patchCoordinatorEntry(before, f.id, f.endpoint.port).after;
    const scripted = answers();
    f.context.ui = scripted.ui;
    const intent = {
      ...(await f.declaration()),
      phase: 'prepared',
      coordinator: { sessionId: f.id, port: f.endpoint.port },
      authority: { kind: 'adoption', record: 'fixture prepared intent', confirmedEndedAt: '2026-10-16T09:00:00.000Z', wording: ENDED_WORDING(IDS.gone) },
      previous: { sessionId: IDS.gone, port: boardEntry.port, claimDate: null },
      configBeforeSha256: f.sha256(before),
      configAfterSha256: f.sha256(after),
      leftUnchanged: leftUnchanged(await f.board.scan()),
    };
    await f.claim.writeAndCommit(intent);
    const start = await surface(f);
    const result = await f.workflow().run(f.context, 'adopt');
    assert.equal(result.code, 'OK', text(result));
    assert.deepEqual(scripted.prompts.map(prompt => prompt.kind), ['renewAdoptionDecision'], 'renewal is its own one decision');
    const prompt = scripted.prompts[0].prompt;
    assert.ok(prompt.includes(ENDED_WORDING(IDS.gone)), 'the renewal target is the recorded previous coordinator');
    assert.ok(prompt.includes('committed prepared intent'), 'and the question says where that target came from');
    assert.ok(prompt.includes(intent.transitionId), 'the question names the transition it is renewing, not a new one');
    assert.ok(!prompt.includes(ENDED_WORDING(f.id)), 'the adopting session is never the termination target');
    const record = parseClaim(await f.claim.read());
    assert.equal(record.transitionId, intent.transitionId, 'the same transition, not a second attempt');
    assert.equal(record.previous.sessionId, IDS.gone, 'still bound to the recorded previous pair');
    assert.notEqual((await surface(f)).commits, start.commits, 'a renewal refreshes the authority evidence for that existing transition');
  } finally { await f.dispose(); }
});

// ---- AC5: a refusal or an unreadable decision names its branch and writes nothing -----------------

const FAILURES = [
  { name: 'board initialization declined', kind: 'boardInitialize', setup: { noBoard: true }, code: 'CANCELLED', step: 'first-board initialization' },
  { name: 'first declaration declined', kind: 'firstCoordinatorDeclaration', setup: { self: true }, code: 'CANCELLED', step: 'first-coordinator declaration' },
  { name: 'adoption declined with no claim on file', kind: 'adoptTransition', setup: {}, code: 'ADOPTION_REQUIRED', step: 'adoptTransition' },
  { name: 'prepared renewal declined', kind: 'renewAdoptionDecision', setup: 'prepared-before', code: 'CANCELLED', step: 'renewAdoptionDecision' },
  { name: 'finalization declined', kind: 'finalizeTransition', setup: 'prepared-after', code: 'CANCELLED', step: 'finalizeTransition' },
];
for (const scenario of FAILURES) {
  test(`AC5 declined: ${scenario.name}`, async t => {
    const f = await fixture(scenario.setup);
    try {
      if (typeof scenario.setup === 'string') await seedPrepared(f, scenario.setup);
      const scripted = answers({ [scenario.kind]: 'decline' });
      f.context.ui = scripted.ui;
      const before = await surface(f);
      const result = await f.workflow().run(f.context, 'adopt');
      assert.equal(result.code, scenario.code, text(result));
      assert.deepEqual(scripted.prompts.map(prompt => prompt.kind), [scenario.kind], 'a refusal asks nothing else');
      const refusal = text(result);
      if (scenario.step !== scenario.kind) assert.ok(refusal.includes(scenario.step), `the refusal must name the step: ${refusal}`);
      // The identities the removed preliminary question used to print must survive in the refusal.
      for (const identity of [f.id, String(f.endpoint.port)]) {
        assert.ok(refusal.includes(identity), `a declined adoption still reports ${identity}: ${refusal}`);
      }
      assertNothingChanged(before, await surface(f));
      assert.equal(f.state.ready, false, 'a decline never opens action readiness');
    } finally { await f.dispose(); }
  });
}

test('AC5 a declined adoption with a committed claim keeps the CLAIM_OTHER context, not a bare cancellation', async t => {
  const f = await fixture();
  try {
    await f.claim.writeAndCommit(await f.declaration({ sessionId: 'committed-record-coordinator', port: 41666 }));
    const scripted = answers({ adoptTransition: 'decline' });
    f.context.ui = scripted.ui;
    const before = await surface(f);
    const result = await f.workflow().run(f.context, 'adopt');
    assert.equal(result.code, 'CLAIM_OTHER', text(result));
    const boardEntry = (await f.board.parsed()).agents.find(agent => agent.coordinator);
    for (const identity of [f.id, String(f.endpoint.port), IDS.gone, String(boardEntry.port), 'committed-record-coordinator', '41666']) {
      assert.ok(text(result).includes(identity), `the refusal reports this session, the board entry and the record: ${identity}`);
    }
    assertNothingChanged(before, await surface(f));
  } finally { await f.dispose(); }
});

/**
 * The confirmation surface can fail in two distinct ways, and issue #12 keeps them distinct: a host that
 * cannot render the question at all, and a host whose answer cannot be read. Neither is a No, and neither
 * is ever a yes.
 */
function brokenSurface(kindToBreak, error) {
  const scripted = answers();
  const ui = {
    confirm: async options => {
      scripted.prompts.push({ kind: options.kind, prompt: options.prompt });
      if (options.kind !== kindToBreak) return true;
      throw error;
    },
  };
  return { ui, prompts: scripted.prompts };
}

for (const [kind, step, prepared] of [
  ['boardInitialize', 'first-board initialization'], ['firstCoordinatorDeclaration', 'first-coordinator declaration'], ['adoptTransition', 'adoption decision'],
  ['renewAdoptionDecision', 'adoption decision renewal', 'prepared-before'],
  ['finalizeTransition', 'finalization', 'prepared-after'], ['finalizeTransition', 'finalization', 'derived-active'],
]) {
  async function prepareFailure(f) {
    if (!prepared) return;
    const intent = await seedPrepared(f, prepared === 'prepared-before' ? prepared : 'prepared-after');
    if (prepared === 'derived-active') {
      const commit = (await f.git(['rev-parse', 'HEAD'])).stdout.trim();
      await writeFile(f.claimPath(), renderClaim({ ...intent, phase: 'active', intentCommit: commit }));
    }
  }
  test(`AC5 an unreadable ${kind} decision names its step, not a generic host error`, async t => {
    const f = await fixture(kind === 'boardInitialize' ? { noBoard: true } : kind === 'firstCoordinatorDeclaration' ? { self: true } : {});
    try {
      await prepareFailure(f);
      f.context.ui = brokenSurface(kind, new AdoptionDecisionCaptureFailure('the selection dialog returned "maybe"')).ui;
      const before = await surface(f);
      const result = await f.workflow().run(f.context, 'adopt');
      assert.equal(result.code, 'CONFIRMATION', text(result));
      assert.ok(text(result).includes(step), `the refusal must name the step: ${text(result)}`);
      assert.match(text(result), /could not be read/i, 'and say the answer was unreadable');
      assert.match(text(result), /neither a yes nor a No/, 'and refuse to guess a direction for it');
      assertNothingChanged(before, await surface(f));
      assert.equal(f.state.ready, false, 'action readiness stays closed');
    } finally { await f.dispose(); }
  });

  test(`AC5 an unrenderable ${kind} decision is a named HOST refusal with no fallback surface`, async t => {
    const f = await fixture(kind === 'boardInitialize' ? { noBoard: true } : kind === 'firstCoordinatorDeclaration' ? { self: true } : {});
    try {
      await prepareFailure(f);
      const scripted = brokenSurface(kind, new AdoptionHostUiUnavailable('this Pi UI provides no supported visible selection surface'));
      f.context.ui = scripted.ui;
      const before = await surface(f);
      const result = await f.workflow().run(f.context, 'adopt');
      assert.equal(result.code, 'HOST', text(result));
      assert.ok(text(result).includes(step), `the refusal must name the step: ${text(result)}`);
      assert.match(text(result), /no text input was opened in its place/, 'and say what it did not do');
      assertNothingChanged(before, await surface(f));
      if (kind !== 'boardInitialize') assert.equal(await stat(f.configPath()).then(() => true, () => false), true, 'and the host failure wrote no board either');
      assert.equal((await surface(f)).commits, before.commits);
      assert.equal(f.state.ready, false);
    } finally { await f.dispose(); }
  });
}

test('AC5 a fresh invocation asks the single decision again; nothing is remembered as consent', async t => {
  const f = await fixture();
  try {
    const first = answers({ adoptTransition: 'decline' });
    f.context.ui = first.ui;
    assert.equal((await f.workflow().run(f.context, 'adopt')).code, 'ADOPTION_REQUIRED');
    const before = await surface(f);
    const second = answers({ adoptTransition: 'decline' });
    f.context.ui = second.ui;
    const result = await f.workflow().run(f.context, 'adopt');
    assert.equal(result.code, 'ADOPTION_REQUIRED', text(result));
    assert.deepEqual(second.prompts.map(prompt => prompt.kind), ['adoptTransition'], 'asked again, exactly once, on the fresh preview');
    assertNothingChanged(before, await surface(f));
  } finally { await f.dispose(); }
});

test('AC5 a yes answered on one preview is not consent for a board that changed underneath it', async t => {
  const f = await fixture();
  try {
    const scripted = answers();
    const inner = scripted.ui.confirm;
    let drifted;
    f.context.ui = {
      confirm: async options => {
        const answer = await inner(options);
        // The answer was yes; the board it was given about is then replaced before the transaction.
        if (options.kind === 'adoptTransition' && drifted === undefined) {
          const raw = await f.board.read();
          drifted = raw.replace('"multiplexer": "herdr"', '"multiplexer": "herdr",\n  "driftedWhileOpen": 1');
          await f.board.write(drifted);
        }
        return answer;
      },
    };
    const headBefore = (await f.git(['rev-parse', 'HEAD'])).stdout.trim();
    const commitsBefore = Number((await f.git(['rev-list', '--count', 'HEAD'])).stdout.trim());
    const result = await f.workflow().run(f.context, 'adopt');
    assert.equal(result.code, 'STALE_PREVIEW', text(result));
    assert.deepEqual(scripted.prompts.map(prompt => prompt.kind), ['adoptTransition'], 'the stale preview is refused, not re-asked and not re-answered');
    assert.equal(await f.board.read(), drifted, 'the drifted board is left exactly as the concurrent writer left it');
    assert.equal((await f.git(['rev-parse', 'HEAD'])).stdout.trim(), headBefore, 'the stale yes committed nothing');
    assert.equal(Number((await f.git(['rev-list', '--count', 'HEAD'])).stdout.trim()), commitsBefore);
    assert.equal(await stat(f.claimPath()).then(() => true, () => false), false, 'and wrote no evidence');
    assert.equal(f.state.ready, false);
  } finally { await f.dispose(); }
});
test('AC6 one yes completes the adoption, and the recorded evidence is truthful about its own origin', async t => {
  const f = await fixture();
  try {
    const scripted = answers();
    f.context.ui = scripted.ui;
    const result = await f.workflow().run(f.context, 'adopt');
    assert.equal(result.code, 'OK', text(result));
    assert.deepEqual(scripted.prompts.map(prompt => prompt.kind), ['adoptTransition'], 'one decision, in one step');
    const record = parseClaim(await f.claim.read());
    assert.equal(record.authority.wording, ENDED_WORDING(IDS.gone), 'the canonical attestation the yes accepted is what is recorded');
    assert.equal(record.authority.kind, 'adoption');
    assert.match(record.authority.confirmedEndedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/, 'with a real timestamp');
    assert.equal(record.previous.sessionId, IDS.gone, 'bound to the backend-selected previous session');
    assert.ok(scripted.prompts[0].prompt.includes(record.transitionId), 'the transition the question named is the one committed');
    // AC3: the record must say what actually happened, and nothing that did not.
    const authority = record.authority.record;
    assert.match(authority, /^Human answered yes to the single adoption decision/, 'it names the decision it came from');
    assert.match(authority, /Implementation-generated evidence of that decision, not a typed statement and not an external reference\./, 'and says it was generated');
    assert.ok(authority.includes(IDS.fresh) && authority.includes(IDS.gone), 'both pairs appear');
    assert.ok(authority.includes(`config SHA256 `), 'the config hash the answer was given about is recorded with it');
    assert.ok(authority.includes(record.transitionId), 'the transition id appears');
    assert.ok(authority.includes(`boardRoot SHA256 ${f.sha256(f.home)}`), 'and the board root as its hash');
    assert.ok(authority.length <= 2000, 'inside the schema bound');
    assert.ok(!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(authority), 'no control character in committed evidence');
    assert.equal(f.state.ready, true);
  } finally { await f.dispose(); }
});

test('AC6 a first declaration still records no termination and no timestamp', async t => {
  const f = await fixture({ self: true });
  try {
    const result = await f.workflow().run(f.context, 'adopt');
    assert.equal(result.code, 'DECLARED', text(result));
    const record = parseClaim(await f.claim.read());
    assert.equal(record.authority.kind, 'first-coordinator declaration');
    assert.equal(record.authority.confirmedEndedAt, null, 'nothing ended, so no termination is claimed');
    assert.ok(!record.authority.wording.includes('I confirm coordinator'), 'a declaration never borrows the adoption attestation');
    assert.equal(record.previous, null);
  } finally { await f.dispose(); }
});

test('AC6 prepared-after finalization performs no replacement and does not rewrite the anchored evidence', async t => {
  const f = await fixture();
  try {
    await seedPrepared(f, 'prepared-after');
    const before = await f.claim.read();
    const anchored = parseClaim(before);
    const scripted = answers();
    f.context.ui = scripted.ui;
    const result = await f.workflow().run(f.context, 'adopt');
    assert.equal(result.code, 'RECOVERED', text(result));
    assert.deepEqual(scripted.prompts.map(prompt => prompt.kind), ['finalizeTransition'], 'one decision, and it is the finalization one');
    const prompt = scripted.prompts[0].prompt;
    assert.ok(prompt.includes(f.home) && prompt.includes(f.id), 'the question still shows the root and this session');
    assert.match(prompt, /without replacement/, 'and says it authorizes no replacement');
    assert.ok(prompt.includes(anchored.configAfterSha256) && prompt.includes(anchored.configBeforeSha256), 'finalization shows both relevant config hashes');
    for (const worker of anchored.leftUnchanged) {
      assert.ok(prompt.includes(worker.name), 'finalization names each untouched worker');
      if (worker.closeJob) assert.ok(prompt.includes(`${worker.name}/${worker.closeJob.state}`), 'finalization shows each close-job fence');
    }
    assert.ok(prompt.includes('not regenerated from this answer'), 'finalization does not promise newly generated authority');
    const after = parseClaim(await f.claim.read());
    assert.equal(after.phase, 'active');
    assert.equal(after.authority.record, anchored.authority.record, 'the anchored authority record is preserved byte-for-byte');
    assert.equal(after.authority.wording, anchored.authority.wording, 'and so is the anchored attestation');
    assert.equal(after.authority.confirmedEndedAt, anchored.authority.confirmedEndedAt, 'with its original timestamp');
    assert.equal(after.transitionId, anchored.transitionId, 'the same transition, finalized');
    assert.ok(after.intentCommit, 'citing its intent commit');
  } finally { await f.dispose(); }
});

test('AC6 a verified live old coordinator still refuses adoption before any question', async t => {
  const f = await fixture();
  try {
    const boardPort = (await f.board.parsed()).agents.find(agent => agent.coordinator).port;
    const live = f.track(await f.listen(0, async () => { throw new Error('no worker traffic in this fixture'); },
      () => ({ version: 1, sessionId: IDS.gone })));
    await f.board.write((await f.board.read()).replace(String(boardPort), String(live.port)));
    const before = await surface(f);
    const result = await f.workflow().run(f.context, 'adopt');
    assert.equal(result.code, 'OLD_CONNECTED', text(result));
    assert.match(text(result), /still verifies at its endpoint/);
    assert.deepEqual(f.ui.prompts.map(prompt => prompt.kind), [], 'a live coordinator is refused before any decision is offered');
    assertNothingChanged(before, await surface(f));
  } finally { await f.dispose(); }
});

// ---- AC7: unrelated untracked content stops blocking a first declaration -------------------------

for (const state of ['a', 'b']) {
  test(`AC7 state (${state}) first declaration proceeds past unrelated backup and scratch-clone content`, async t => {
    const f = await fixture(state === 'a' ? { noBoard: true } : { self: true });
    try {
      const files = await scratch(f);
      const bytes = await fingerprint(files);
      const before = await surface(f);
      const result = await f.workflow().run(f.context, 'adopt');
      assert.equal(result.code, 'DECLARED', text(result));
      assert.deepEqual(await fingerprint(files), bytes, 'scratch bytes or times changed');
      assert.equal(await changedPaths(f), 'coordinator-claim.md', 'the claim is the only changed path');
      const after = await surface(f);
      assert.deepEqual(after.index, before.index, 'the real index must stay as it was');
      assert.equal(after.ignore, before.ignore, 'ignore rules must not change');
      assert.ok(after.status.some(entry => entry.startsWith('??\0') === false && entry.startsWith('?? backup-2026-10-18/config.json.bak')),
        'the scratch content is still there, untracked and untouched');
      assert.ok(after.status.some(entry => entry.startsWith('?? scratch/notes/')) || after.status.some(entry => entry.includes('scratch/notes')),
        'the nested scratch clone is still there, untracked and untouched');
    } finally { await f.dispose(); }
  });
}

test('AC7 the same scratch still blocks ordinary adoption', async t => {
  const f = await fixture();
  try {
    await scratch(f);
    const before = await surface(f);
    const result = await f.workflow().run(f.context, 'adopt');
    assert.equal(result.code, 'GIT', text(result));
    assert.match(text(result), /untracked content:/);
    assert.ok(text(result).includes('backup-2026-10-18'), 'the blocked path is named');
    assertNothingChanged(before, await surface(f));
  } finally { await f.dispose(); }
});

test('AC7 recovery keeps the strict policy against the same scratch', async t => {
  const f = await fixture();
  try {
    const before = await f.board.read();
    const boardEntry = (await f.board.parsed()).agents.find(agent => agent.coordinator);
    const after = patchCoordinatorEntry(before, f.id, f.endpoint.port).after;
    await f.claim.writeAndCommit({
      ...(await f.declaration()),
      phase: 'prepared',
      coordinator: { sessionId: f.id, port: f.endpoint.port },
      authority: { kind: 'adoption', record: 'fixture prepared intent', confirmedEndedAt: '2026-10-16T09:00:00.000Z', wording: ENDED_WORDING(IDS.gone) },
      previous: { sessionId: IDS.gone, port: boardEntry.port, claimDate: null },
      configBeforeSha256: f.sha256(before),
      configAfterSha256: f.sha256(after),
      leftUnchanged: leftUnchanged(await f.board.scan()),
    });
    await f.board.write(after);
    await scratch(f);
    const result = await f.workflow().run(f.context, 'adopt');
    assert.equal(result.code, 'RECOVERY_REQUIRED', text(result));
    assert.match(text(result), /untracked content:/);
    assert.ok(text(result).includes('backup-2026-10-18'));
  } finally { await f.dispose(); }
});

// ---- AC8: the protected surface, the index, and tracked work remain refused ----------------------

const BLOCKERS = [
  { name: 'an unrelated staged path', states: ['a', 'b'], prepare: async f => {
    await writeFile(path.join(f.home, 'staged.md'), 'staged by someone else\n');
    await f.gitOk(['add', 'staged.md']);
  }, pattern: /staged index content: staged\.md/ },
  // Staged, then dropped from the worktree only: the index entry survives as `AD`, which is the one shape
  // where a staged claim is reached at all, since an uncommitted worktree claim is a record problem refused earlier.
  { name: 'a staged claim', states: ['b'], prepare: async f => {
    await f.claim.write(f.renderClaim(await f.declaration()));
    await f.gitOk(['add', 'coordinator-claim.md']);
    await unlink(f.claimPath());
  }, pattern: /staged index content: coordinator-claim\.md/ },
  { name: 'an unrelated tracked modification', states: ['a', 'b'], prepare: async f => writeFile(path.join(f.home, 'AGENTS.md'), '# changed by someone else\n'), pattern: /tracked worktree changes: AGENTS\.md/ },
  { name: 'an unresolved git operation', states: ['a', 'b'], prepare: async f => writeFile(path.join(f.home, '.git', 'MERGE_HEAD'), `${'a'.repeat(40)}\n`), pattern: /unresolved git operation: MERGE_HEAD/ },
  { name: 'unrecognised content inside the protected board namespace', states: ['b'], prepare: async f => {
    await mkdir(path.join(f.home, '.pi-intercom'), { recursive: true });
    await writeFile(path.join(f.home, '.pi-intercom', 'stranger.txt'), 'ignored by rule, and still refused\n');
  }, pattern: /\.pi-intercom[/\\]stranger\.txt/ },
  { name: 'a symlink inside the protected board namespace', states: ['b'], prepare: async f => {
    await mkdir(path.join(f.home, '.pi-intercom'), { recursive: true });
    await symlink(path.join(f.home, 'handoff.md'), path.join(f.home, '.pi-intercom', 'config.json.bak'));
  }, pattern: /\.pi-intercom[/\\]config\.json\.bak|unrecognised file/ },
];
for (const state of ['a', 'b']) {
  for (const blocker of BLOCKERS.filter(entry => entry.states.includes(state))) {
    test(`AC8 state (${state}) refuses ${blocker.name}`, async t => {
      const f = await fixture(state === 'a' ? { noBoard: true } : { self: true });
      try {
        await blocker.prepare(f);
        const before = await surface(f);
        const result = await f.workflow().run(f.context, 'adopt');
        assert.equal(result.code, 'GIT', text(result));
        assert.match(text(result), blocker.pattern, `the blocked path must be named: ${text(result)}`);
        assert.match(text(result), /nothing is written|will not commit, clean, ignore, or reset anything else/);
        assert.equal((await surface(f)).commits, before.commits, 'a blocked declaration never commits');
      } finally { await f.dispose(); }
    });
  }
}

test('AC8 unrelated look-alike paths are not protected, and expected runtime files are allowed', async t => {
  const f = await fixture({ self: true });
  try {
    await mkdir(path.join(f.home, '.pi-intercom-backup'), { recursive: true });
    await writeFile(path.join(f.home, '.pi-intercom-backup', 'note.txt'), 'unrelated\n');
    await writeFile(path.join(f.home, 'coordinator-claim.md.bak'), 'unrelated\n');
    await mkdir(path.join(f.home, '.pi-intercom', 'logs'), { recursive: true });
    await writeFile(path.join(f.home, '.pi-intercom', 'logs', `writer-${'11111111-1111-4111-8111-111111111111'}.jsonl`), '{"version":1}\n');
    await mkdir(path.join(f.home, '.pi-intercom', 'reports'), { recursive: true });
    await writeFile(path.join(f.home, '.pi-intercom', 'reports', `${'a'.repeat(64)}.json`), '{"version":1}\n');
    const result = await f.workflow().run(f.context, 'adopt');
    assert.equal(result.code, 'DECLARED', text(result));
    assert.equal(await changedPaths(f), 'coordinator-claim.md');
  } finally { await f.dispose(); }
});

test('AC8 a protected-path change injected while the decision is open is refused before the commit', async t => {
  const f = await fixture({ self: true });
  try {
    const before = await surface(f);
    const inner = f.context.ui;
    f.context.ui = {
      input: options => inner.input(options),
      confirm: async options => {
        const answer = await inner.confirm(options);
        if (answer && options.kind === 'firstCoordinatorDeclaration') {
          await writeFile(path.join(f.home, 'AGENTS.md'), '# changed while the decision was open\n');
        }
        return answer;
      },
    };
    const result = await f.workflow().run(f.context, 'adopt');
    assert.equal(result.code, 'GIT', text(result));
    assert.match(text(result), /tracked worktree changes: AGENTS\.md/);
    assert.equal((await surface(f)).commits, before.commits, 'the last-moment recheck refused before committing');
  } finally { await f.dispose(); }
});

// ---- AC9: accurate diagnostics for every status category ----------------------------------------

test('AC9 a rename names source and destination, and a staged-and-modified path names both facts', async t => {
  const f = await fixture();
  try {
    await f.gitOk(['mv', 'handoff.md', 'assignments.md']);
    await writeFile(path.join(f.home, 'notes.md'), 'staged\n');
    await f.gitOk(['add', 'notes.md']);
    await writeFile(path.join(f.home, 'notes.md'), 'staged, then modified again\n');
    const reported = text(await f.workflow().run(f.context, 'adopt'));
    assert.match(reported, /staged index content: [^\n]*assignments\.md/, 'the rename destination is index content');
    assert.match(reported, /handoff\.md -> assignments\.md/, 'and the rename names its source as well as its destination');
    assert.match(reported, /staged index content: [^\n]*notes\.md/, 'a newly added path is index content');
    assert.match(reported, /tracked worktree changes: [^\n]*notes\.md/, 'and the same path is also reported as worktree work');
    assert.ok(!reported.includes('untracked content:'), 'nothing here is untracked, so nothing may be called untracked');
  } finally { await f.dispose(); }
});

test('AC9 exotic path names are classified and reported exactly, never reclassified', async t => {
  const f = await fixture();
  try {
    const TAB = String.fromCharCode(9), NL = String.fromCharCode(10), QUOTE = String.fromCharCode(34);
    const exotic = [
      'a directory with spaces/two  spaces.md',
      'ünïcøde-目录.md',
      `tab${TAB}name.md`,
      `quote${QUOTE}name.md`,
      `newline${NL}name.md`,
    ];
    await mkdir(path.join(f.home, 'a directory with spaces'), { recursive: true });
    for (const name of exotic) await writeFile(path.join(f.home, name), 'untracked\n');
    const reported = text(await f.workflow().run(f.context, 'adopt'));
    const list = reported.match(/untracked content: ([^\u2014\n]+)/)[1].trim();
    // The display form escapes control characters, quotes and backslashes; decoding it must return exactly
    // the paths that exist. Decoding the documented rendering is the oracle here, never a re-encoding.
    const backslash = String.fromCharCode(92);
    const decode = value => value.replace(new RegExp(`${backslash}${backslash}x([0-9a-f]{2})`, 'g'), (_all, hex) => String.fromCharCode(parseInt(hex, 16)));
    const listed = list.split(', ').map(decode);
    for (const name of exotic) assert.ok(listed.includes(name), `round-trip lost ${JSON.stringify(name)}: ${JSON.stringify(list)}`);
    assert.equal(listed.length, exotic.length, 'one reported entry per real path: nothing was split into invented filenames');
    assert.ok(!/[\x00-\x1f]/.test(list), 'a control character is never emitted raw, which would break one-line-per-fact');
    assert.ok(!reported.includes('tracked worktree changes:'), 'none of this is tracked, so none of it may be called a tracked change');
    assert.ok(!reported.includes('staged index content:'), 'and none of it is index content');
  } finally { await f.dispose(); }
});

test('AC9 an exotic path in each real category keeps its own category', async t => {
  const f = await fixture();
  try {
    const TAB = String.fromCharCode(9);
    await writeFile(path.join(f.home, 'staged ünïcøde.md'), 'index content\n');
    await f.gitOk(['add', 'staged ünïcøde.md']);
    const tracked = `tracked${TAB}tab.md`;
    await writeFile(path.join(f.home, tracked), 'committed\n');
    await f.gitOk(['add', '--', tracked]);
    await f.gitOk(['-c', 'user.email=fixture@example', '-c', 'user.name=fixture', 'commit', '-q', '--only', tracked, '-m', 'fixture: tracked exotic path']);
    await writeFile(path.join(f.home, tracked), 'committed, then modified\n');
    const reported = text(await f.workflow().run(f.context, 'adopt'));
    assert.match(reported, /staged index content:/);
    assert.ok(reported.includes('staged ünïcøde.md'), 'the index entry is named in its own category');
    assert.match(reported, /tracked worktree changes:/);
    assert.ok(!reported.includes('untracked content:'), 'neither of these is untracked, so neither may be reported as untracked');
  } finally { await f.dispose(); }
});

test('AC6 a self board naming this session at a different port refuses instead of declaring', async t => {
  const f = await fixture({ self: true });
  try {
    const before = await surface(f);
    const entry = (await f.board.parsed()).agents.find(agent => agent.coordinator);
    const other = f.track(await f.listen(0, async () => { throw new Error('no worker traffic in this fixture'); }, () => ({ version: 1, sessionId: f.id })));
    await f.board.write((await f.board.read()).replace(String(entry.port), String(other.port)));
    const result = await f.workflow().run(f.context, 'adopt');
    assert.equal(result.code, 'IDENTITY', text(result));
    assert.match(text(result), /the pair is not verified/);
    assert.deepEqual(f.ui.prompts.map(prompt => prompt.kind), [], 'no declaration is offered for an unverified pair');
    assert.equal(await stat(f.claimPath()).then(() => true, () => false), false, 'no claim is written');
    assert.equal((await surface(f)).commits, before.commits, 'nothing is committed');
    assert.equal(f.state.ready, false, 'action readiness stays closed');
  } finally { await f.dispose(); }
});

test('AC9 generated evidence stays inside the unchanged claim schema at the extremes', async t => {
  const f = await fixture({ self: true });
  try {
    const evidence = declarationEvidence(f.home, { sessionId: 's'.repeat(256), port: 65535, sessionFile: path.join(f.home, 'session.jsonl') });
    assert.ok(evidence.record.length <= 2000 && evidence.wording.length <= 2000, 'generated evidence must stay within the unchanged 2000-character schema limit');
    assert.ok(evidence.record.includes('s'.repeat(256)) && evidence.record.includes(f.sha256(f.home)));
    const record = {
      schemaVersion: 1, transitionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', phase: 'active', boardRoot: f.home,
      coordinator: { sessionId: 's'.repeat(256), port: 65535 }, date: '2026-10-18',
      authority: { kind: 'first-coordinator declaration', record: evidence.record, confirmedEndedAt: null, wording: evidence.wording },
      previous: null, previousRecordCommit: null, configBeforeSha256: '0'.repeat(64), configAfterSha256: '0'.repeat(64),
      intentCommit: null, leftUnchanged: [], rebriefSource: 'handoff.md (open assignments)',
    };
    assert.doesNotThrow(() => parseClaim(f.renderClaim(record)), 'the real parser accepts the generated bytes');
    assert.throws(() => parseClaim(f.renderClaim({ ...record, authority: { ...record.authority, record: `${evidence.record}${'-'.repeat(2000)}` } })), /authority/);
  } finally { await f.dispose(); }
});
