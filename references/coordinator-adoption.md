# Coordinator adoption (ADR 0025)

Status: implemented source behavior for fork 0.9.x; the command is offered only through the separately
installed Orchestrator role integration. This reference supersedes the claim/Git evidence flow of
ADR 0009/0012. [ADR 0025](../docs/adr/0025-git-independent-adoption.md) records the lasting decision.

## Availability and prerequisites

- A Pi process launched as the canonical **Orchestrator** role, in a trusted project under the shared
  projects home, with an idle interactive UI.
- `/intercom-adopt` comes from the installed role integration, not from this package alone.
- Every process that writes this board's config must run a version with this lock. Mixed old/new
  writers are not supported: older code looks for the obsolete lock **directory** and does not
  serialize with the new guard.
- No Git repository, clean tree, session file, claim file, or extra confirmation is required.

## First board: no adoption at all

A canonical Orchestrator startup at the projects home with no config creates the first board with an
atomic no-replace write, then loads responsibility. There is no command, question, claim, or separate
confirmation. A competing initializer never overwrites the winner; a loser reads that board and holds
without authority. A child directory with no board is held and gets no private board. An empty
`.pi-intercom` directory is an allowed absence. Existing malformed/unreadable config is an error and is
never repaired or overwritten. A `/intercom-adopt` invocation that finds no config requests a restart:
it never creates a board.

## Existing board: one native confirmation

`/intercom-adopt status` is read-only. `/intercom-adopt`:

1. re-checks the launch role, interactive/trusted context, idle host, canonical projects-home/cwd/root,
   board count, and this runtime's captured session id plus **actually bound** port;
2. refuses configured session or port collisions, naming the conflicting entry, pair and board path;
3. probes the configured old coordinator. A matching live endpoint refuses before any question;
4. asks **exactly one** native No-first yes/no showing the board root, the old pair, this session's
   pair, and that only those two parsed values change while every other parsed value is preserved;
5. on yes, under the all-writer lock, re-reads the config, compares the exact preview bytes, identity,
   board layout and collisions, re-probes the old endpoint, and publishes only if nothing drifted;
6. atomically replaces the coordinator `sessionId` and `port`, then loads responsibility in place.

Declining (No, Esc, dismissal) writes nothing and authorizes nothing; a fresh invocation is a new
decision. No answer is typed, stored, renewed, or reused. An already-matching pair needs no question
and no write: it is a load-only path. A registered worker session is never promoted, removed, or
rebound.

## JSON handling

The strict reader parses the complete JSON with `JSON.parse`, rejects duplicate keys at any depth
(including escaped aliases) and values that cannot roundtrip (overflow, negative zero), and validates
the whole object without stripping tolerated unknown fields. The writer validates, serializes, and
re-reads the result, requiring deep equality with the intended object. Formatting may normalize;
name, description, workers, jobs, closes, handoffs, array order and unknown parsed values survive.
The raw preview bytes still bind the human answer: any intervening change, even formatting-only,
invalidates it.

## Serialization and crash behavior

Every config writer and initializer uses one crash-released native file lock on the permanent regular
`.pi-intercom/config.lock` (pinned `fs-native-extensions@1.5.2`: Linux `F_OFD_SETLK`, macOS `flock`,
Windows `LockFileEx`), plus the existing process queue and async-local nesting. The guard file is
never unlinked, renamed or replaced, and its existence is not ownership. A crashed holder is released
by the kernel; Windows cleanup may be delayed. Contention and unsupported bindings/filesystems refuse
with no weaker fallback; there is no PID/age stealing and no compare-then-rename CAS. A legacy lock
**directory** is refused with the exact path and offline whole-board upgrade guidance, left untouched.

This is cooperating local-process serialization on supported local filesystems. It is not distributed
fencing, hostile-same-user protection, recall of submitted OS work, or a new power-loss guarantee.
Network/remote filesystems and unsupported prebuild/libc/ABI combinations are not claimed.

## Boot-only port recovery

A configured coordinator whose saved port is unavailable binds an OS-selected fallback and, at startup
only, publishes the **verified** bound port under the same lock before responsibility load, handoff
recovery, observer maintenance, reminders, registration/config callbacks, tools, or sends. It refuses
when this endpoint does not verify this native session, when the saved pair still answers, or when
config/identity/root/lifecycle drift is observed after an await. A same-port startup performs no
write. A command never repairs a same-id/different-port mismatch: restart on a non-conflicting port.
Automatic recovery accepts the documented risk of an unreachable duplicate process using the same
session id; it does not detect or solve duplicate launches.

## Refusals and recovery

| State | Outcome |
|---|---|
| No/Esc/dismiss, unreadable capture, unavailable dialog | named refusal; nothing written; fresh invocation for a new decision |
| Wrong role, non-TUI, untrusted, busy | named refusal before any question |
| Second/wrong board, unsafe root/config path | named paths plus the expected root; only a human may remove a confirmed empty unintended stray |
| Live old endpoint, session/port collision | refused before or inside the transaction; no rebinding |
| Config changed after the preview | stale preview; no merge and no second question in the invocation |
| Native contention / legacy lock directory / provider unavailable | distinct named refusals; retry later or perform the reviewed offline upgrade |
| Publication succeeded, local load failed | *config replaced, local promotion pending*; matching retry loads only, zero questions/writes |
| Publication/process interruption | config is old or new complete JSON; a later invocation reads the current board, never replays stored consent |
| Replaced during a queued report/callback/reminder | later coordinator effects are refused; an already saved report stays saved and is reported as stored-but-not-notified |

Legacy `coordinator-claim.md` is ignored in every state, including malformed, missing, symlinked or
changed while a question is open. Do not delete it as part of adoption; a separately requested cleanup
is optional. Do not edit board JSON to bypass a refusal.

## Proof

```
env -u PI_ROLE_DIR -u PI_INTERCOM_WORKER_ROLE npm test
npm run typecheck
npm run check:package
```

`npm test` includes the adoption fixture table (`node tests/fixtures/adoption-runner.mjs <case>`),
the native-lock separate-process tests (contention, crash release, child non-inheritance, fail-closed
provider/guard replacement), runtime first-board/boot-recovery tests, and the contract/UX/bridge
regressions. Fixtures use disposable projects-home directories and loopback listeners; no Git
repository, live board, installed role, model call or worker is involved. There is no package-level
host smoke requirement for adoption.
