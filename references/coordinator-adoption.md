# Coordinator adoption

A board can outlive its coordinator session. `Intercom.adoptCoordinator` replaces that session's
id and port in place, and the human starts it with `/intercom-adopt` from an Orchestrator Pi
session. The role-local frontend discovers exactly one offer on `intercom:coordinator-adoption:v1`.
This package registers no adoption tool, HTTP writer, CLI, or slash command. There is no manual
claim or config editing, and no terminal fallback: the command is the only writer.

The worker roster, pending close jobs, reports, logs, and session history stay. The next worker
send reads the new pair from config. Adoption does not message workers, reload them, restart
them, or clear reports.

## Availability and prerequisites

`/intercom-adopt` comes from the separately installed Orchestrator role integration. Installing
this package alone does not add the command.

Use a fresh, persisted Orchestrator session: interactive, trusted, and idle, with its working
directory under the shared projects home (`PI_INTERCOM_PROJECTS_HOME`, default
`~/workspaces/projects`). That home is a Git repository. The index and worktree are clean, except
one recognized recovery: active claim bytes that are an exact derivative of the committed
prepared anchor. Upgrade every process that publishes board config before taking over. A down
port does not prove the old session ended.

## What the command does

1. Count `.pi-intercom` directories from the current directory up to the projects home, before
   creating or discovering a board. A second, wrong, or unsafe board stops the command. A child
   directory with no board does not create a private one. Creating the root board requires its
   own confirmation.
2. Read the new session id from Pi's persisted session list, and the port from this process's
   ready health endpoint. A registered worker id, or a port already in use, stops the command.
   A reachable old coordinator also stops it. An unreachable endpoint does not prove the old
   process exited.
3. Ask, through this process's own Pi UI, for an authority reference and the exact sentence
   `I confirm coordinator <old-sessionId> ended`, then for consent to the displayed board,
   transition id, and config hash. The decision is one-use. Cancel, a blank answer, or a preview
   that changed while the dialog was open writes nothing.
4. Under the shared config lock, commit a prepared claim, patch only the coordinator `sessionId`
   and `port` tokens, commit the active claim, and load responsibility in this process.

`/intercom-adopt status` is read-only. It says to proceed only when this process holds the
matching active claim and has loaded responsibility.

Evidence is re-proved, not remembered. Every live final-effect guard requires the newest reachable
claim commit, the exact committed and worktree bytes, the current board pair, prepared-intent
ancestry of that commit, and this process's own local promotion. Checking that no newer claim is
malformed is not sufficient; a stale epoch, cached byte comparison, or presence check is never
approval.

## Recovery

The claim commit and the config rename are not one atomic write. Run the same command again.
It does not replay a notification that was blocked halfway through.

| Evidence you find | What the same command does |
|---|---|
| Prepared claim, config still the old pair | Asks again, refreshes the prepared claim, then replaces the pair once. |
| Prepared claim, config already the expected new pair | Finalizes the active claim. It does not swap the pair again. |
| Active claim, responsibility not loaded | Loads responsibility. It writes neither config nor the claim. Status stays `PROMOTION_PENDING` until that load succeeds. |
| Prepared claim from a different session | Stops with `RECOVERY_REQUIRED` and leaves the files for a person to route. There is no supersession command. |
| Config lock left by a dead process | Stops with `LOCKED`. A person confirms the owner is gone before removing the lock. |

Recovery matches exact config bytes and the displayed config hash, not merely the old/new pair. A
roster change that keeps the same pair is a new decision, and mixed, partial, foreign, semantic, or
staged state stops without modification.

Until the active claim is committed and responsibility is loaded, coordinator tools, incoming
callbacks, report saves, and reminders stay closed; read-only health and adoption status stay
served. Requests admitted while closed fail `ADOPTION_NOT_READY` as HTTP 400, before accepting,
saving, or clearing a report, and before any registration, config, or lifecycle change. There is no
`202` and no success for evidence that was not saved. A report saved before its notification was
blocked stays on disk and is reported as stored but not notified; inspect the stored report before
any resend. A lost response or timeout stays outcome-unknown: nothing is buffered, replayed, or
retried automatically, and a closed-epoch reminder stops until ordinary orchestration arms it
again.

After adoption, the first separate coordinator action re-inspects the board, lease, and tracker
state over the supported APIs, then reads stored evidence, leaves untouched jobs alone, and
re-briefs assignments explicitly. A tool receipt or a worker's self-reported summary is not
approval.

## Serialization

Every config publication takes the same path: Pi's per-file queue, then this process's per-file
queue, then an exclusive `.pi-intercom/config.lock` directory. Adoption re-reads the raw config
and the newest committed claim under that lock before it writes. Only the owner releases its
lock. Nothing clears a lock by process age or pid. A crashed writer leaves the lock until a
person establishes that the owner is dead.

An ordinary update rechecks the current coordinator after it acquires the lock. A legacy board
with no claim history can still be updated. The next update discovers a claim that appeared
during that write. The store does not remember "this board was never adopted."

## Limits

- Arguments from the caller cannot confirm the change, name a session, or choose a port. The
  backend reads those from the captured Pi context.
- A malformed or deleted newer claim does not fall back to an older approval, even when the
  worktree file looks like the previously approved bytes.
- A missing claim file is not "never adopted" when committed history still shows a prepared or
  active claim. Ordinary config writes stay closed.
- There is no hook bypass, rollback, automatic retry, or second writer for the claim.
- This is a cooperating local-filesystem contract. It is not a distributed lock, and it is not a
  fence against legacy processes with their own writer or a malicious same-user process. An
  installation reload is separate from adoption.
- Agents do not install this, merge it, or run a live adoption.

## Proof

```
env -u PI_ROLE_DIR -u PI_INTERCOM_WORKER_ROLE npm test
npm run typecheck
npm run check:package
PI_ADOPTION_HOST_ROOT=<absolute Pi 1.2.0 package root> npm run test:adoption-host
node tests/fixtures/adoption-runner.mjs <case-name>
```

`npm test` runs the adoption fixture table, the contract and bridge checks, and one regression
for each distinct fence. A missing case fails. Fixtures use temporary Git boards and loopback
listeners. The host check loads the packed source through public Pi 1.2.0. It does not start a
session, model, worker, or live board.

## Timing evidence stays in history

The reduced D9 differential archive, its runner, and its npm script are not carried in this tree.
This commit's parent removed them (`145c4c18d197a8494114c20b20a78dfa833fb358`); the last commit that
still holds them, and the locator below, is `1835e793231a086022d5c96aa8c32af51da858ce`. No `src/` or
`dist/` byte differs between that commit and this one. Recover with
`git show 1835e793231a086022d5c96aa8c32af51da858ce:<path>`.

- Measured source and dist commit for every figure: `7778d4f605855b06cea35a11deef789b073c11da`.
  Baseline and original archives were fingerprinted at `e5b817a7b309dd28c2b56efc25506aa431fc0e68`
  (54 committed dist files) and `f04c1f42bbc4359aa0ad7d2c39c60f9cd29cdb10` (57).
- Method, environment, seeded order, quantile rule (`sorted[min(n-1, floor(n*q))]`), the reduced
  5-process × 12-sample × 2-warmup matrix, the ablations, and each file's byte count and SHA-256 of
  the committed gzip bytes: `git show 1835e793:references/coordinator-adoption.md`, sections
  `Measured differential`, `Measured smaller alternatives`, `Focused sample, cold access, churn,
  refusal, recovery, handoff`, and `Raw records and reproduction`. The reproduction command there
  names the removed runner `tests/adoption-differential.mjs`; it is not restored in this tree.
- The 15 gzip members live under `tests/fixtures/` at that commit, each named
  `adoption-d9-<cell>.jsonl.gz`: `warm-2`, `warm-16`, `warm-64`, `cold-list`, `cold-status`,
  `cold-worker-status-probe`, `cold-overlap`, `focused`, `churn`, `refusal-missing`,
  `refusal-newer`, `recovery`, `handoff-counts`, `handoff-before`, `alternatives`.
- Accepted cells, handler p50/p95 ms from the warm default-observer matrix (baseline p50 A/B, then
  candidate p50, p95, A/A, paired delta, Git sync/async):

  | Profile | Mode | Operation | baseline p50 | candidate p50 | p95 | A/A | delta | Git |
  |---|---|---|---:|---:|---:|---:|---:|---|
  | 2w/h0 | ordinary-nonrepo | status | 0.465 / 0.469 | 1.275 | 2.376 | 0.046 | 0.816 | 0/0 |
  | 2w/h0 | ordinary-repo | status | 0.503 / 0.512 | 2.911 | 6.352 | 0.050 | 2.419 | 0/1 |
  | 2w/h0 | adopted | list | 0.213 / 0.216 | 6.871 | 9.795 | 0.062 | 6.662 | 4/0 |
  | 2w/h0 | adopted | report | 0.964 / 0.953 | 21.284 | 27.618 | 0.161 | 20.357 | 12/0 |
  | 2w/h0 | adopted | status | 0.533 / 0.538 | 28.993 | 36.511 | 0.083 | 28.512 | 12/4 |
  | 2w/h0 | adopted | overlap | 2.015 / 1.997 | 100.979 | 117.907 | 0.184 | 98.910 | 48/8 |
  | 64w/h1024 | ordinary-repo | status | 0.742 / 0.755 | 21.045 | 24.576 | 0.100 | 20.133 | 0/1 |
  | 64w/h1024 | adopted | list | 0.277 / 0.282 | 8.269 | 10.677 | 0.050 | 8.026 | 4/0 |
  | 64w/h1024 | adopted | status | 0.778 / 0.759 | 34.604 | 42.706 | 0.107 | 33.653 | 12/4 |
  | 64w/h1024 | adopted | overlap | 2.569 / 2.498 | 120.758 | 152.173 | 0.184 | 119.162 | 48/8 |

  Each gap above is larger than its A/A band. Those figures are a measured record, not a waiver, a
  zero-cost claim, or an irreducible floor. The acceptance decision for them is the PR #8 review
  record (comment `6241350142`), external to this repository. Re-running or re-accepting these
  numbers is not part of `npm test`, and these safety tests do not revalidate them.
