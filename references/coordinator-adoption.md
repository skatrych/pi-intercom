# Coordinator adoption backend (issue31)

`Intercom.adoptCoordinator` is the single deterministic coordinator-entry replacement path. The
human invokes `/intercom-adopt` from the **Orchestrator Pi TUI**, through the separately installed
Swactory role-local frontend. `/intercom-adopt status` is read-only; the accompanying skill only
explains the operation. This globally loaded fork backend registers no adoption tool, HTTP writer,
CLI, shell helper or slash command. There is no manual claim/config editing or terminal fallback.

The binding design is Swactory ADR0005, plan and templates at
[593e11940e47046179be890e055a3e3387ed931d](https://github.com/skatrych/swactory/tree/593e11940e47046179be890e055a3e3387ed931d/docs/adr).
The frontend discovers exactly one protocol1 offer on `swactory:coordinator-adoption:v1` through
Pi's supported synchronous event bus. The closure independently checks captured launch role,
current runtime/SessionManager/cwd, TUI, trust, idle state, persisted identity and its bound health
endpoint. Caller UI/identity/confirmation arguments grant no authority. A copied frontend, role
basename, worker metadata or instruction text cannot authorize a Developer/plain-Pi runtime.
Application role gating is not an OS sandbox against malicious same-user code.

## Deliberate decision and evidence

The expected projects home is `SWFACTORY_PROJECTS_HOME`, default `~/workspaces/projects`. Count
`.pi-intercom` directories on **cwd→home ancestors**, before config discovery or initialization.
Second/wrong/unsafe boards stop; no automatic cleanup. The skill's separate creation-time depth4
scan is not this ancestor check. No-board child cwd never creates a private board. Root bootstrap
requires its own UI decision and a committed first-coordinator declaration.

SessionManager/current persisted header/list in the actual session directory establish the new id;
the runtime ready endpoint and its health route establish the port. Neither is a model argument.
Registered-worker ids and port collisions stop. A connected old endpoint unconditionally stops.
Disconnected/unknown do not prove termination. The backend's captured Pi UI obtains an authority
reference, exactly `I confirm coordinator <old-sessionId> ended`, then affirmative consent to the
specific board/config/roster transition. Cancel/blank/false/stale preview changes nothing.

Under the common all-writer transaction, the workflow commits **prepared intent before replacement**,
losslessly patches only the coordinator sessionId/port tokens, commits active evidence, and loads
responsibility in place. Unknown tolerated fields, formatting, workers, pending close jobs, reports,
logs and session histories are preserved. No worker send/reload/restart, recovery, monitor, pane
operation, retention, report clear or resumed context is part of adoption. Pending jobs remain fenced.

`coordinator-claim.md` is fixed-schema tenure/transition evidence at the projects-home git root, not
memory or a scaffold. Tooling writes and path-scoped commits it on behalf of the human-confirmed
Orchestrator. Newest reachable claim commit, exact committed/worktree bytes, current board pair,
prepared-intent ancestry and local promotion are required; malformed/deleted newer evidence never
falls back to older approval. Unrelated pending work, staged changes, unsafe paths, commit hooks or
unverifiable results stop. No hook bypass, rollback, retry, normalization or second record writer.

## Recover by explicit reinvocation, not replay

Git evidence and config rename are not one atomic resource. Failure closes coordinator tools,
incoming callbacks, report-save and reminder readiness until active evidence **and** promotion.
Health/read-only adoption status remain available. Filesystem-lock contention returns `LOCKED`;
host/concurrent command contention is `BUSY`. Safety stops exit1; unsupported host/backend/usage exit2.

* Prepared+exact old config: same session, fresh direct human confirmation, refreshed committed intent,
  then one replacement. Changed roster/hash requires a new decision; mixed state stops.
* Prepared+exact expected new config: same-session consent finalizes evidence only, never re-swaps or
  asks the adopting endpoint to be dead. This includes dirty active bytes **exactly derived from the
  committed prepared anchor**; authority is never derived from dirt. Foreign/partial/semantic/staged
  dirt stops without modification. Fix an external commit blocker and reinvoke the same command.
* Committed active+matching pair: already active; an explicit same-command promotion retry writes
  neither config nor record. Promotion failure is `PROMOTION_PENDING`, not authority to act.

Requests admitted while closed fail `ADOPTION_NOT_READY` through HTTP400, before accepting/saving/
clearing reports or changing registration/config/lifecycle data. A saved report whose later
notification crosses epochs remains saved and explicitly reports **stored, notification blocked/not
submitted; inspect stored report before any resend**. No202 success for unsaved evidence, buffered
notifications, automatic replay or transport retry policy is added. A lost response/timeout remains
outcome-unknown (#53 is not solved). Closed-epoch timers stop without deferred delivery; only later
ordinary orchestration arms reminders. Newly sent traffic after readiness can be accepted normally.

Worker transmit reads config per send: the next send routes to the new pair, with no worker action.
After adoption, the first separate coordinator action verifies board/lease/tracker state over APIs;
then inspect stored evidence, report untouched jobs and re-brief assignments explicitly. A receipt or
self-reported summary is not approval. The complete human first-use checklist is in the role skill.

## Serialization / rollout limits

All ConfigStore initialize/update/configure/status/handoff/adoption publications share Pi's per-file
queue → process-local per-file queue → exclusive atomic `.pi-intercom/config.lock` directory. Every
ordinary update rechecks current coordinator authority after acquisition; existing unresolved claim
evidence fences ordinary writes too. Adoption compares the complete immutable preview before intent.
Synced, closed exclusive temps publish by no-replace link (initialization) or atomic rename (updates).
Every rename retry checks lifecycle, paths and owner token. Only the owner releases its lock.

No age/PID stealing, stale-lock reclamation or automatic retry. A process crash leaves a lock: stop
and report; human maintenance must establish owner death before clearing it. This is a cooperating
local-filesystem contract, not a distributed lock or a fence for legacy/malicious writers. Human
rollout must upgrade **all config-publishing processes** and establish the old coordinator ended.
Legacy workers do not publish config locally; no worker reload is needed for delivery. Installation
reload is separate from adoption. Agents do not merge, release, install or perform live adoption.

## Executable proof

```
env -u PI_ROLE_DIR -u PI_INTERCOM_WORKER_ROLE npm test
npm run typecheck
npm run check:package
PI_ADOPTION_HOST_ROOT=<absolute Pi1.2.0 package root> npm run test:adoption-host
node tests/fixtures/adoption-runner.mjs <fixed-case-name>
```

`npm test` explicitly wires the fixture runner, independent claim/bridge/runtime tests, HTTP readiness
phase/epoch/report-save/reminder barriers and barrier-controlled separate-process races/crashes.
Missing/unimplemented cases fail, never skip/green. Fixtures are isolated temporary git boards,
persisted session data and ephemeral loopback listeners; no live board/ports/auth/Pi workers/models.
The process-crash tests kill only their own disposable children, verify stale locks still stop other
writers, and perform explicit fixture-only lock maintenance after observing child exit. Product does
not reclaim locks. Config rename counts/inodes, raw worker spans, record commits and actual send
ports establish preservation and no-second-swap behavior, rather than trusting success prose.

The separately required `test:adoption-host` proves offline packed-source factory load via the
actual public Pi1.2.0 loader, real persisted SessionManager/custom-directory/list and event-bus
unsubscribe checks, plus the complete source typechecked against that host's public declarations.
It invokes no session_start, credentials, model, endpoint, worker or cancellation. Set the explicit
host root if `npm root -g` is not where that public host is installed; absence/mismatch is a failure,
not compatibility proof. The legacy cancellation probe is separate and is not run by this change.
