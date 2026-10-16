#!/usr/bin/env node
// Test-only adoption proof runner. NOT a supported operation.
//
// One case name from the approved fixtures table, executed against disposable temporary fixtures, with
// the expected outcome asserted. There are no free-form arguments: identity, ports, paths, confirmation,
// and outcomes cannot be supplied or overridden.
//
// Decision kinds are the stable ones the command itself uses: boardInitialize, adoptTransition,
// authorityRecord, endedWording, finalizeTransition.

import { runCase } from './adoption-cases.mjs';

const WORDING = '{old}';
/** The accepted path: every decision answered affirmatively, wording typed exactly. */
const YES = () => ({
  boardInitialize: 'confirm',
  adoptTransition: 'confirm',
  authorityRecord: 'confirm',
  endedWording: { kind: 'prompt', value: WORDING },
  finalizeTransition: 'confirm',
});
/** Refuse one decision while answering the rest, so each no-write exit is isolated. */
const decline = (...kinds) => {
  const answers = YES();
  for (const kind of kinds) answers[kind] = 'decline';
  return answers;
};
/** Answer every decision but type the ended confirmation this way ('{old}' expands to the exact wording). */
const typed = value => ({ ...YES(), endedWording: { kind: 'prompt', value } });

const CASES = {
  // ---- AC1: count and classification. A second board matters when the upward walk from cwd reaches it.
  'count-home': { own: 'coordinator', claim: 'matching', run: 'status', expect: { code: 'OK', exit: 0 } },
  'count-second': { own: 'fresh', extraBoard: 'app', cwdChild: true, expect: { code: 'BOARD_COUNT_TWO', exit: 1 } },
  'count-second-empty': { own: 'fresh', extraBoardEmpty: 'app', cwdChild: true, expect: { code: 'BOARD_COUNT_TWO', exit: 1 } },
  'count-wrong': { own: 'coordinator', claim: 'none', boardAtChild: true, cwdChild: true, run: 'status', expect: { code: 'OK', exit: 0 } },
  'count-symlink': { own: 'coordinator', claim: 'matching', symlinkEscape: true, run: 'status', expect: { code: 'BOARD_PATH', exit: 1 } },
  'outside-home': { own: 'fresh', cwdOutside: true, expect: { code: 'BOARD_PATH', exit: 1 } },
  'no-board-child': { own: 'fresh', noBoard: true, cwdChild: true, expect: { code: 'NO_BOARD', exit: 0 } },
  'no-board-root-declined': { own: 'fresh', noBoard: true, answers: decline('boardInitialize'), expect: { code: 'CANCELLED', exit: 1 } },
  'no-board-root-confirmed': {
    own: 'fresh', noBoard: true, answers: YES(), expect: { code: 'DECLARED', exit: 0 },
    note: 'a fresh board for an anonymous session has no predecessor, so AC2 stays impossible and AC3/AC4 are not applicable: no identity comparison, no collision probe, no confirmation. A created board is never a takeover and registered workers are never promoted.',
  },

  // ---- AC2: the five claim-gate outcomes.
  'claim-absent-self': { own: 'coordinator', claim: 'none', answers: YES(), expect: { code: 'DECLARED', exit: 0 } },
  'claim-active-self': { own: 'coordinator', claim: 'matching', expect: { code: 'CLAIM_OK', exit: 0 } },
  'claim-other-declined': { own: 'fresh', claim: 'matching', answers: decline('adoptTransition'), expect: { code: 'CLAIM_OTHER', exit: 1 } },
  'claim-absent-anonymous': { own: 'fresh', claim: 'none', answers: YES(), expect: { code: 'OK', exit: 0 }, assert: ['only-coordinator-tokens-differ', 'roster-recorded', 'zero-worker-requests'] },
  'claim-malformed': { own: 'fresh', claim: 'malformed', answers: YES(), expect: { code: 'RECORD', exit: 1 } },
  'claim-uncommitted': { own: 'coordinator', claim: 'matching-uncommitted', expect: { code: 'RECORD', exit: 1 } },
  'claim-board-disagree': { own: 'coordinator', claim: 'board-disagree', expect: { code: 'CLAIM_MISMATCH', exit: 1 } },
  'claim-port-disagree': { own: 'coordinator', claim: 'port-disagree', expect: { code: 'CLAIM_MISMATCH', exit: 1 } },

  // ---- AC3/AC4: identity, collisions, probe, wording, interaction.
  'fresh-anonymous': { own: 'fresh', answers: YES(), expect: { code: 'OK', exit: 0 }, assert: ['only-coordinator-tokens-differ', 'roster-recorded', 'zero-worker-requests', 'no-coordinator-tool-needed'] },
  'registered-worker': { own: 'worker', answers: YES(), expect: { code: 'SESSION_COLLISION', exit: 1 }, assert: ['board-unchanged'] },
  'port-collision': { own: 'fresh', ports: own => ({ workerTwo: own }), answers: YES(), expect: { code: 'PORT_COLLISION', exit: 1 }, assert: ['board-unchanged', 'intent-not-committed'] },
  'session-unpersisted': { own: 'fresh', session: 'unpersisted', expect: { code: 'SESSION_UNPERSISTED', exit: 1 } },
  'wrong-header': { own: 'fresh', session: 'wrong-header', expect: { code: 'IDENTITY', exit: 1 } },
  'store-missing-id': { own: 'fresh', session: 'store-missing', expect: { code: 'IDENTITY', exit: 1 } },
  'custom-session-dir': { own: 'fresh', session: 'custom-dir', answers: YES(), expect: { code: 'OK', exit: 0 } },
  'new-health-mismatch': { own: 'fresh', ownHealth: 'mismatch', expect: { code: 'IDENTITY', exit: 1 } },
  'old-connected': { own: 'fresh', oldEndpoint: 'matching', expect: { code: 'OLD_CONNECTED', exit: 1 }, assert: ['board-unchanged', 'intent-not-committed'] },
  'old-refused': { own: 'fresh', oldEndpoint: 'refused', answers: YES(), expect: { code: 'OK', exit: 0 } },
  'old-unknown': { own: 'fresh', oldEndpoint: 'malformed', answers: YES(), expect: { code: 'OK', exit: 0 } },
  'old-connected-after-dialog': { own: 'fresh', oldEndpoint: 'after-dialog', reconnect: true, answers: YES(), expect: { code: 'OLD_CONNECTED', exit: 1 }, assert: ['board-unchanged', 'intent-not-committed'] },
  'confirm-blank': { own: 'fresh', answers: typed(''), expect: { code: 'CONFIRMATION', exit: 1 }, assert: ['board-unchanged', 'intent-not-committed'] },
  'confirm-wrong-id': { own: 'fresh', answers: typed('the previous coordinator has stopped'), expect: { code: 'CONFIRMATION', exit: 1 }, assert: ['board-unchanged', 'intent-not-committed'] },
  'confirm-cancel': { own: 'fresh', answers: typed(undefined), expect: { code: 'CANCELLED', exit: 1 } },
  'confirm-false': { own: 'fresh', answers: typed(false), expect: { code: 'CANCELLED', exit: 1 } },
  'confirm-forged-args': { own: 'fresh', forgedArguments: true, answers: YES(), expect: { code: 'USAGE', exit: 1 }, assert: ['board-unchanged'] },
  'authority-blank': { own: 'fresh', answers: { ...YES(), authorityRecord: '' }, expect: { code: 'CONFIRMATION', exit: 1 }, assert: ['board-unchanged', 'intent-not-committed'] },
  'authority-cancel': { own: 'fresh', answers: { ...YES(), authorityRecord: undefined }, expect: { code: 'CANCELLED', exit: 1 }, assert: ['board-unchanged', 'intent-not-committed'] },
  'adopt-declined': { own: 'fresh', answers: decline('adoptTransition'), expect: { code: 'ADOPTION_REQUIRED', exit: 1 }, assert: ['board-unchanged', 'intent-not-committed'] },
  'no-ui': { own: 'fresh', noUi: true, expect: { code: 'MODE', exit: 1 } },
  'untrusted': { own: 'fresh', untrusted: true, answers: YES(), expect: { code: 'TRUST', exit: 1 } },
  'busy-host': { own: 'fresh', busy: true, answers: YES(), expect: { code: 'BUSY', exit: 1 } },
  'foreign-launch-role': { own: 'fresh', role: 'developer', answers: YES(), expect: { code: 'AUTH', exit: 1 }, assert: ['board-unchanged'] },

  // ---- Stale input: anything that changes while decisions are open.
  'roster-changed': { own: 'fresh', during: 'roster', answers: YES(), expect: { code: 'STALE_PREVIEW', exit: 1 }, assert: ['board-unchanged', 'intent-not-committed'] },
  'record-changed': { own: 'fresh', during: 'record', answers: YES(), expect: { code: 'RECORD', exit: 1 }, assert: ['board-unchanged', 'intent-not-committed'] },
  'root-changed': { own: 'fresh', during: 'root', answers: YES(), expect: { code: 'STALE_PREVIEW', exit: 1 } },
  'generation-changed': { own: 'fresh', during: 'generation', answers: YES(), expect: { code: 'SESSION_CHANGED', exit: 1 }, assert: ['board-unchanged', 'intent-not-committed'] },

  // ---- AC6: roster preservation and accepted config shapes.
  'two-workers-pending': { own: 'fresh', answers: YES(), expect: { code: 'OK', exit: 0 }, assert: ['pending-job-listed', 'only-coordinator-tokens-differ'] },
  'minified-config': { own: 'fresh', config: 'minified', answers: YES(), expect: { code: 'OK', exit: 0 }, assert: ['only-coordinator-tokens-differ'] },
  'unknown-field': { own: 'fresh', config: 'unknown-field', answers: YES(), expect: { code: 'OK', exit: 0 }, assert: ['only-coordinator-tokens-differ'] },
  'irregular-format': { own: 'fresh', config: 'irregular', answers: YES(), expect: { code: 'OK', exit: 0 }, assert: ['only-coordinator-tokens-differ'] },
  'duplicate-keys': { own: 'fresh', config: 'duplicate-keys', answers: YES(), expect: { code: 'CONFIG', exit: 1 } },
  'bad-version': { own: 'fresh', config: 'bad-version', answers: YES(), expect: { code: 'CONFIG', exit: 1 } },
  'bad-schema': { own: 'fresh', config: 'bad-schema', answers: YES(), expect: { code: 'CONFIG', exit: 1 } },
  'history-preserved': { own: 'fresh', seed: true, answers: YES(), expect: { code: 'OK', exit: 0 }, assert: ['history-preserved'] },

  // ---- Transaction: lock, publication failure, active-evidence failure, recovery, promotion.
  'lock-contended': { own: 'fresh', lock: 'contended', answers: YES(), expect: { code: 'LOCKED', exit: 1 } },
  'stale-lock': { own: 'fresh', lock: 'stale', answers: YES(), expect: { code: 'OK', exit: 0 } },
  'foreign-token': { own: 'fresh', lock: 'foreign', answers: YES(), expect: { code: 'LOCKED', exit: 1 } },
  'commit-rejected': { own: 'fresh', hook: 'reject', answers: YES(), expect: { code: 'GIT', exit: 1 }, assert: ['board-unchanged', 'intent-not-committed'] },
  'publish-failed': { own: 'fresh', publish: 'fail', answers: YES(), expect: { code: 'PUBLISH', exit: 1 }, assert: ['no-active-evidence'] },
  'session-changed-rename': { own: 'fresh', publish: 'invalidate', answers: YES(), expect: { code: 'SESSION_CHANGED', exit: 1 } },
  'eperm-then-session-changed': { own: 'fresh', publish: 'eperm-then-invalidate', answers: YES(), expect: { code: 'SESSION_CHANGED', exit: 1 } },
  'active-commit-failed': {
    own: 'fresh', hook: 'active', answers: YES(), expect: { code: 'GIT', exit: 1 },
    assert: ['exactly-one-swap'], note: 'config stays adopted; no rollback; the claim stays a committed prepared intent, so a second invocation is a deterministic recovery rather than a fresh attempt.',
  },
  'active-commit-failed-rerun': {
    own: 'fresh', hook: 'active', preparedSwap: true, reinvoke: true, answers: YES(),
    expect: { phase1: { code: 'GIT', exit: 1 }, phase2: { code: 'GIT', exit: 1 } },
    assert: ['exactly-one-swap', 'refreshed-intent', 'one-transition-id'],
    note: 'same transition id, no second swap, no second attempt.',
  },
  'dirty-foreign': { own: 'fresh', preparedSwap: true, dirty: 'foreign', expect: { code: 'RECOVERY_REQUIRED', exit: 1 } },
  'dirty-partial': { own: 'fresh', preparedSwap: true, dirty: 'partial', expect: { code: 'RECOVERY_REQUIRED', exit: 1 } },
  'dirty-semantic': { own: 'fresh', preparedSwap: true, dirty: 'semantic', expect: { code: 'RECOVERY_REQUIRED', exit: 1 } },
  'dirty-staged': { own: 'fresh', preparedSwap: true, dirty: 'staged', expect: { code: 'RECOVERY_REQUIRED', exit: 1 } },
  'dirty-intent': { own: 'fresh', preparedSwap: true, dirty: 'intent', expect: { code: 'RECOVERY_REQUIRED', exit: 1 } },
  'dirty-config': { own: 'fresh', preparedSwap: true, dirty: 'config', expect: { code: 'RECOVERY_REQUIRED', exit: 1 } },
  'dirty-session': { own: 'fresh', preparedSwap: true, dirty: 'session', expect: { code: 'RECOVERY_REQUIRED', exit: 1 } },
  'clean-advance': {
    own: 'fresh', preparedSwap: true, answers: YES(), expect: { code: 'RECOVERED', exit: 0 },
    assert: ['exactly-one-swap', 'no-second-swap'],
    note: 'own prepared evidence is accepted without a new confirmation; the transition commits and promotion is reported.',
  },
  'promotion-failed': {
    own: 'fresh', preparedSwap: true, promote: 'fail', reinvoke: true, answers: YES(),
    expect: { phase1: { code: 'PROMOTION_PENDING', exit: 1 }, phase2: { code: 'PROMOTION_PENDING', exit: 1 } },
    assert: ['no-extra-config-write', 'no-extra-record-commit'],
  },

  // ---- AC7: host and interaction. These need a real Runtime and a live loopback endpoint.
  'bootstrap-claim-callbacks': { runtime: true, runtimeCase: 'bootstrap-claim-callbacks', expect: { code: 'ASSERTIONS', exit: 0 } },
  'declaration-claim-callbacks': { runtime: true, runtimeCase: 'declaration-claim-callbacks', expect: { code: 'ASSERTIONS', exit: 0 } },
  'adoption-claim-callbacks': { runtime: true, runtimeCase: 'adoption-claim-callbacks', expect: { code: 'ASSERTIONS', exit: 0 } },
  'clean-advance-claim-callbacks': { runtime: true, runtimeCase: 'clean-advance-claim-callbacks', expect: { code: 'ASSERTIONS', exit: 0 } },
  'promotion-failed-claim-callbacks': { runtime: true, runtimeCase: 'promotion-failed-claim-callbacks', expect: { code: 'ASSERTIONS', exit: 0 } },
  'callbacks-400': { runtime: true, runtimeCase: 'callbacks-400', expect: { code: 'ASSERTIONS', exit: 0 } },
  'callbacks-suppressed': { runtime: true, runtimeCase: 'callbacks-suppressed', expect: { code: 'ASSERTIONS', exit: 0 } },
  'callbacks-not-started': { runtime: true, runtimeCase: 'callbacks-not-started', expect: { code: 'ASSERTIONS', exit: 0 } },
  'callbacks-queued-report': { runtime: true, runtimeCase: 'callbacks-queued-report', expect: { code: 'ASSERTIONS', exit: 0 } },
  'send-destination-changes': { runtime: true, runtimeCase: 'send-destination-changes', expect: { code: 'ASSERTIONS', exit: 0 } },
  'promoted-endpoint': { runtime: true, runtimeCase: 'promoted-endpoint', expect: { code: 'ASSERTIONS', exit: 0 } },

  // ---- Race table. Each needs two live participants.
  'race-outer-queue': { race: true, expect: { code: 'ASSERTIONS', exit: 0 } },
  'race-process-queue': { race: true, expect: { code: 'ASSERTIONS', exit: 0 } },
  'race-filesystem': { race: true, expect: { code: 'ASSERTIONS', exit: 0 } },
  'race-claim-cleanup': { race: true, expect: { code: 'ASSERTIONS', exit: 0 } },
  'race-two-adopters': { race: true, expect: { code: 'ASSERTIONS', exit: 0 } },
  'race-reminder-handoff-restart': { race: true, expect: { code: 'ASSERTIONS', exit: 0 } },
  'race-kill-intents': { race: true, expect: { code: 'ASSERTIONS', exit: 0 } },

  // ---- Crash table. Each kills a child at a boundary and proves the recovery classification.
  'crash-before-intent': { race: true, crash: 'before-intent', expect: { code: 'ASSERTIONS', exit: 0 } },
  'crash-after-intent': { race: true, crash: 'after-intent', expect: { code: 'ASSERTIONS', exit: 0 } },
  'crash-after-config': { race: true, crash: 'after-config', expect: { code: 'ASSERTIONS', exit: 0 } },
  'crash-after-claim': { race: true, crash: 'after-claim', expect: { code: 'ASSERTIONS', exit: 0 } },
  'crash-after-promotion': { race: true, crash: 'after-promotion', expect: { code: 'ASSERTIONS', exit: 0 } },
};

/**
 * Cases whose proof is not complete. They are reachable, but they refuse to report success, so an absent
 * assertion can never be mistaken for a passing one. Each must be resolved or removed, never deleted
 * silently: the approved plan requires these branches to be proven.
 */
const NOT_PROVEN = [
  'publish-failed', 'session-changed-rename', 'eperm-then-session-changed',
  'active-commit-failed', 'active-commit-failed-rerun',
  'dirty-foreign', 'dirty-partial', 'dirty-semantic', 'dirty-staged', 'dirty-intent', 'dirty-config', 'dirty-session',
  'clean-advance', 'promotion-failed',
];

const name = process.argv[2];
if (!name || !Object.hasOwn(CASES, name)) {
  console.error(`FIXTURE USAGE: one case name from the approved table is required; got ${JSON.stringify(name ?? null)}`);
  console.error(`KNOWN CASES: ${Object.keys(CASES).join(', ')}`);
  process.exit(2);
}
for (const argument of process.argv.slice(3)) {
  console.error(`FIXTURE USAGE: no free-form arguments are accepted (ignored ${JSON.stringify(argument)})`);
  process.exit(2);
}
if (NOT_PROVEN.includes(name)) {
  console.log(`NOT_PROVEN: ${name} — proof incomplete; this case reports no verdict`);
  process.exit(0);
}
await runCase(name, CASES[name]);
