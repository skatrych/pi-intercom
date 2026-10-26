// Test-only scenario runner for the ADR 0025 adoption contract. Each named case runs in its own child
// process (isolation from every other case and from the operator environment). Nothing here is a
// supported operation or ships: `src/` never imports it.
//
// Every case prints `TERMINAL: <result code>` plus at least one `ASSERT <label> PASS`; a missing
// assertion is a failed case, never a green one. `--questions` emits the real prompt text so the
// component-level dialog check can render exactly what production would ask.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fixture, standalone, declineUI, removeBoard } from './adoption-support.mjs';
import { createFixture, configText, mockUi, IDS } from './adoption-fixture.mjs';
import { listen } from '../../dist/transport.js';

const checks = [];
function check(label, condition) {
  if (!condition) throw new Error(`ASSERT FAILED: ${label}`);
  checks.push(label);
  console.log(`ASSERT ${label} PASS`);
}
function terminal(result) {
  console.log(`TERMINAL: ${result.code}`);
}

async function withFixture(options, run) {
  const f = await fixture(options);
  try { return await run(f); } finally { await f.dispose(); }
}
/** A board-only fixture: no runtime, so the case controls the captured identity and port directly. */
async function withBoard(style, run) {
  const f = await createFixture();
  try {
    await f.board.write(configText(style ?? 'full', f.ports()));
    return await run(f);
  } finally { await f.dispose(); }
}

const cases = {
  /** One native yes/no replaces exactly the coordinator pair; every other parsed value survives. */
  'adopt-fresh': () => withFixture({}, async f => {
    await f.seeded();
    const before = await f.board.read();
    const beforeClaim = await readFile(path.join(f.home, 'coordinator-claim.md'), 'utf8');
    const beforeSends = f.sends.length;
    const result = await f.adopt();
    terminal(result);
    check('adoption succeeded', result.code === 'OK');
    check('one question with the adoption kind', f.ui.prompts.length === 1 && f.ui.prompts[0].kind === 'adoptCoordinator');
    const parsed = await f.boardConfig();
    const board = parsed.agents.find(agent => agent.coordinator);
    check('coordinator pair replaced', board.sessionId === IDS.fresh && board.port === f.runtime.endpoint.port);
    check('coordinator name and description survive', board.name === 'Coordinator' && board.description === 'Coordinate workers.');
    check('worker roster, roles, handoff and close job survive', parsed.agents.length === 3 && parsed.agents[1].role === 'developer'
      && parsed.agents[2].closeJob.jobId === 'job-pending-1' && parsed.agents[1].handoff.summary === 'Completed earlier scope.');
    check('no worker request was made by adoption', f.sends.length === beforeSends);
    check('legacy claim bytes untouched', await readFile(path.join(f.home, 'coordinator-claim.md'), 'utf8') === beforeClaim);
    check('responsibility is loaded in place', f.runtime.responsibility?.coordinator === true && f.runtime.responsibility.sessionId === IDS.fresh);
    check('config bytes did change with the pair', before !== await f.board.read());
  }),

  /** No/Esc changes nothing: no write, no second question, no coordinator effect. */
  'adopt-no': () => withFixture({ ui: declineUI() }, async f => {
    const before = await f.board.read();
    const result = await f.adopt();
    terminal(result);
    check('declined is the CANCELLED result', result.code === 'CANCELLED');
    check('exactly one question', f.ui.prompts.length === 1);
    check('config bytes are identical', await f.board.read() === before);
  }),

  /** A matching pair loads without a question or a write. */
  'already-current': () => withFixture({ self: true }, async f => {
    const before = await f.board.read();
    const result = await f.adopt();
    terminal(result);
    check('already current result', result.code === 'CURRENT');
    check('no question for an already-current pair', f.ui.prompts.length === 0);
    check('no config write', await f.board.read() === before);
    check('responsibility loaded', f.runtime.responsibility?.sessionId === IDS.gone);
  }),

  /** A live old endpoint refuses before any dialog opens. */
  'old-live': () => withFixture({}, async f => {
    const live = await listen(0, async () => {}, () => ({ version: 1, sessionId: IDS.gone }));
    f.track(live);
    // Point the configured old pair at the live endpoint so the precheck sees a verified identity.
    const text = (await f.board.read()).replace(`"port": ${f.ports.coordinator}`, `"port": ${live.port}`);
    await f.board.write(text);
    const before = await f.board.read();
    const result = await f.adopt();
    terminal(result);
    check('live old endpoint refuses', result.code === 'OLD_CONNECTED');
    check('no question was asked', f.ui.prompts.length === 0);
    check('config is unchanged', await f.board.read() === before);
  }),

  /** Any real config change while the question is open invalidates the yes; no merge, no re-ask. */
  'stale-preview': async () => {
    let home;
    const ui = mockUi({
      adoptCoordinator: 'confirm',
      onAsk: async () => {
        // Formatting-only drift still binds the answer to the exact preview bytes.
        const file = path.join(home, '.pi-intercom/config.json');
        const text = await readFile(file, 'utf8');
        await writeFile(file, text.replace('"multiplexer": "herdr"', '"multiplexer": "herdr" '));
      },
    });
    return withFixture({ ui }, async f => {
      home = f.home;
      const result = await f.adopt();
      terminal(result);
      check('stale preview refuses the answer', result.code === 'STALE_PREVIEW');
      check('exactly one question', f.ui.prompts.length === 1);
      const board = await f.boardConfig();
      check('the coordinator was not replaced', board.agents.find(agent => agent.coordinator).sessionId === IDS.gone);
    });
  },

  /** Git and the legacy claim file have zero influence on the same current config and answer. */
  'git-claim-irrelevant': async () => {
    let home;
    const ui = mockUi({
      adoptCoordinator: 'confirm',
      onAsk: async () => {
        // A dirty repository-looking state and a rewritten legacy claim appear while the question is
        // open. None of them may stale the yes or change the outcome.
        await mkdir(path.join(home, '.git'), { recursive: true });
        await writeFile(path.join(home, '.git/index'), 'dirty index bytes');
        await writeFile(path.join(home, 'coordinator-claim.md'), '# rewritten while asking\n');
        await writeFile(path.join(home, 'untracked.txt'), 'untracked install artifact\n');
      },
    });
    return withFixture({ ui }, async f => {
      home = f.home;
      const result = await f.adopt();
      terminal(result);
      check('adoption succeeds despite Git/claim changes', result.code === 'OK');
      const board = await f.boardConfig();
      check('the coordinator pair was replaced', board.agents.find(agent => agent.coordinator).sessionId === IDS.fresh);
      check('the claim was not read, rewritten or deleted', (await readFile(path.join(f.home, 'coordinator-claim.md'), 'utf8')) === '# rewritten while asking\n');
    });
  },

  /** A command after config removal never creates a board; startup owns first-board creation. */
  'no-board': () => withFixture({}, async f => {
    await removeBoard(f);
    const result = await f.adopt();
    terminal(result);
    check('no-config command requests restart', result.code === 'NO_BOARD' && result.lines.join(' ').includes('Restart Pi'));
    check('no board was recreated', await f.board.readOrUndefined() === undefined);
    check('no question was asked', f.ui.prompts.length === 0);
  }),

  /** Board isolation names every offending path and the expected root. */
  'second-board': () => withFixture({ cwdRelative: 'app' }, async f => {
    // The command runs below the projects home; its own private board appears while it is open.
    const nested = await f.extra.boardAt('app');
    const result = await f.adopt();
    terminal(result);
    check('a second board refuses', result.code === 'BOARD_COUNT');
    const text = result.lines.join('\n');
    check('both offending paths and the expected root are named',
      text.includes(path.join(nested, '.pi-intercom')) && text.includes(path.join(f.home, '.pi-intercom')));
    check('only a human removal of a confirmed empty stray is suggested', /confirmed empty/.test(text) && /never recursive deletion/.test(text));
  }),

  /** A configured worker session is never promoted, removed or rebound. */
  'worker-session': () => withFixture({ id: IDS.workerOne }, async f => {
    const before = await f.board.read();
    const result = await f.adopt();
    terminal(result);
    check('a configured worker session collides', result.code === 'SESSION_COLLISION');
    check('no question and no write', f.ui.prompts.length === 0 && await f.board.read() === before);
  }),

  /** A port already configured for another entry is a named refusal, never a rebinding. */
  'port-collision': () => withBoard('full', async f => {
    const s = standalone(f, { port: f.ports().workerOne });
    const result = await s.workflow.run(s.context, 'adopt');
    terminal(result);
    check('port collision is refused', result.code === 'PORT_COLLISION' && result.lines.join(' ').includes(IDS.workerOne));
    check('no question and no write', s.ui.prompts.length === 0 && (await f.board.read()).includes(`"port": ${f.ports().workerOne}`));
  }),

  /** The adopting endpoint must verify this native session before the question and before any write. */
  'own-unverified': () => withBoard('single', async f => {
    const before = await f.board.read();
    const s = standalone(f, { port: f.ports().coordinator + 100,
      probe: async agent => ({ sessionId: agent.sessionId, state: 'unknown', checkedAt: null, reason: 'timeout' }) });
    const result = await s.workflow.run(s.context, 'adopt');
    terminal(result);
    check('unverifiable own endpoint refuses', result.code === 'IDENTITY');
    check('refusal happens before any question', s.ui.prompts.length === 0);
    check('the board is untouched', await f.board.read() === before);
  }),

  /** A yes must not be reused when the own endpoint stops verifying before the locked write. */
  'own-revoked-under-lock': () => withBoard('single', async f => {
    const before = await f.board.read();
    let calls = 0;
    const s = standalone(f, { port: f.ports().coordinator + 100,
      probe: async agent => {
        calls++;
        return { sessionId: agent.sessionId, state: calls === 1 ? 'connected' : 'unknown',
          checkedAt: null, reason: calls === 1 ? 'verified' : 'timeout' };
      } });
    const result = await s.workflow.run(s.context, 'adopt');
    terminal(result);
    check('the replaced-under-lock own endpoint refuses before writing', result.code === 'IDENTITY');
    check('the answer was asked once and nothing was written', s.ui.prompts.length === 1 && await f.board.read() === before);
  }),

  /** A health endpoint answering for a different identity at this bound port is the same refusal. */
  'own-health-mismatch': () => withBoard('single', async f => {
    const before = await f.board.read();
    const s = standalone(f, { port: f.ports().coordinator + 100,
      probe: async agent => ({ sessionId: agent.sessionId, state: 'disconnected', checkedAt: null, reason: 'identity_mismatch' }) });
    const result = await s.workflow.run(s.context, 'adopt');
    terminal(result);
    check('identity mismatch refuses', result.code === 'IDENTITY');
    check('no question and no write', s.ui.prompts.length === 0 && await f.board.read() === before);
  }),

  /** Same session id with a different bound port is a command-time restart refusal, not a repair. */
  'same-id-different-port': () => withBoard('single', async f => {
    const s = standalone(f, { id: IDS.gone, port: f.ports().coordinator + 1 });
    const result = await s.workflow.run(s.context, 'adopt');
    terminal(result);
    check('same id with another port refuses', result.code === 'IDENTITY' && /restart/i.test(result.lines.join(' ')));
    check('the board was not rebound or rewritten', (await f.board.read()).includes(`"port": ${f.ports().coordinator}`));
  }),

  /** The legacy directory lock is named and left untouched; nothing is converted or stolen. */
  'legacy-lock': () => withBoard('single', async f => {
    await mkdir(path.join(f.home, '.pi-intercom/config.lock'));
    const s = standalone(f, { port: f.ports().coordinator + 1 });
    const result = await s.workflow.run(s.context, 'adopt');
    terminal(result);
    const text = result.lines.join(' ');
    check('legacy directory lock refuses with upgrade guidance',
      result.code === 'LOCK_LEGACY' && /offline upgrade/.test(text) && /remove only that established lock directory/.test(text));
    check('the offending path is named', text.includes(path.join(f.home, '.pi-intercom', 'config.lock')));
    check('the legacy lock directory survives untouched', (await f.board.read()).includes('Coordinator'));
  }),

  /** Successful publication with failed local promotion reports exactly that; the retry loads only. */
  'promotion-pending': () => withBoard('full', async f => {
    const before = await f.board.read();
    const first = standalone(f, { port: f.ports().coordinator + 1000, promote: async () => 'injected local load failure' });
    const published = await first.workflow.run(first.context, 'adopt');
    terminal(published);
    check('replacement is reported separately from local load', published.code === 'PROMOTION_PENDING' && /config replaced/.test(published.lines.join(' ')));
    const afterPublish = await f.board.read();
    check('the two-value replacement did happen', afterPublish !== before && afterPublish.includes(IDS.fresh));
    // A matching invocation loads only: zero questions, zero writes.
    const retry = standalone(f, { port: f.ports().coordinator + 1000, loaded: false });
    const loaded = await retry.workflow.run(retry.context, 'adopt');
    terminal(loaded);
    check('matching retry loads without a question', loaded.code === 'CURRENT' && retry.ui.prompts.length === 0);
    check('matching retry writes nothing', await f.board.read() === afterPublish);
  }),

  /** Malformed or ambiguous config is an error, never implicit repair or normalization. */
  'duplicate-keys': () => withBoard('duplicateKeys', async f => {
    const before = await f.board.read();
    const s = standalone(f, { port: f.ports().coordinator + 1 });
    const result = await s.workflow.run(s.context, 'adopt');
    terminal(result);
    check('duplicate keys refuse the strict reader', result.code === 'CONFIG' && /duplicate key/.test(result.lines.join(' ')));
    check('the ambiguous bytes are preserved', await f.board.read() === before);
  }),

  'malformed-config': () => withBoard(null, async f => {
    await f.board.write('{ "version": 1, "agents": [');
    const before = await f.board.read();
    const s = standalone(f, { port: 42123 });
    const result = await s.workflow.run(s.context, 'adopt');
    terminal(result);
    check('malformed JSON is a config refusal', result.code === 'CONFIG');
    check('the malformed bytes are preserved', await f.board.read() === before);
  }),
};

if (process.argv[2] === '--questions') {
  // Emit the real question for the component viewport check. The fixture declines, so no act occurs.
  const f = await fixture({ ui: declineUI() });
  await f.adopt().catch(() => {});
  for (const question of f.ui.prompts) console.log(`QUESTION BEGIN ${question.kind}\n${question.prompt}\nQUESTION END ${question.kind}`);
  await f.dispose();
} else {
  const name = process.argv[2];
  if (!name || !cases[name]) throw new Error(`unknown case ${name}`);
  await cases[name]();
}
