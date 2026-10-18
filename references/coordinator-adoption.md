# Coordinator adoption

A board can outlive its coordinator session. `Intercom.adoptCoordinator` replaces that session's
id and port in place, and the human starts it with `/intercom-adopt` from an Orchestrator Pi
session. The role-local frontend discovers exactly one offer on `intercom:coordinator-adoption:v1`.
This package registers no adoption tool, HTTP writer, CLI, or slash command.

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

Until the active claim is committed and responsibility is loaded, coordinator tools, incoming
callbacks, report saves, and reminders stay closed. A report that was saved before its
notification was blocked stays on disk and is reported as stored but not notified. Nothing is
buffered for later, and nothing is sent again automatically.

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
