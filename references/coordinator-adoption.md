# Coordinator adoption backend (issue31)

`Intercom.adoptCoordinator` is the single deterministic coordinator-entry replacement path. The
human invokes `/intercom-adopt` from the **Orchestrator Pi TUI**, through the separately installed
Swactory role-local frontend. `/intercom-adopt status` is read-only; the accompanying skill only
explains the operation. This globally loaded fork backend registers no adoption tool, HTTP writer,
CLI, shell helper or slash command. There is no manual claim/config editing or terminal fallback.

The binding design is Swactory ADR0005, plan and templates at
[2b2d937089d830459ac68f10d970abb7f89a5ed4](https://github.com/skatrych/swactory/tree/2b2d937089d830459ac68f10d970abb7f89a5ed4/docs/adr),
including the independently approved D9, ConfigStore/runtime, private handoff-guard and legacy-absence decisions.
The frontend discovers exactly one protocol1 offer on `swactory:coordinator-adoption:v1` through
Pi's supported synchronous event bus. The closure independently checks captured launch role,
current runtime/SessionManager/cwd, TUI, trust, idle state, persisted identity and its bound health
endpoint. Caller UI/identity/confirmation arguments grant no authority. A copied frontend, role
basename, worker metadata or instruction text cannot authorize a Developer/plain-Pi runtime.
Application role gating is not an OS sandbox against malicious same-user code.

## Availability and prerequisites

The command frontend and explanatory skill are provided by the
[Swactory Orchestrator role integration](https://github.com/skatrych/swactory/tree/2b2d937089d830459ac68f10d970abb7f89a5ed4/pi-agent-config/roles/orchestrator).
They are separate from this backend package; no global command appears from installing this package
alone. The integration must load both the backend and exactly one compatible role-local frontend.
Human installation/rollout is separate from adoption. Start a fresh persisted Orchestrator session in
interactive, trusted, idle Pi, under the shared projects-home Git root. The index/worktree must be
clean (except the narrowly recognized workflow-generated active-record recovery). Upgrade all
config-publishing processes first; confirm the old session ended, not merely that its port is down.

## Deliberate decision and evidence

The expected projects home is `SWFACTORY_PROJECTS_HOME`, default `~/workspaces/projects`. Count
`.pi-intercom` directories on **cwd→home ancestors**, before config discovery or initialization.
Second/wrong/unsafe boards stop; no automatic cleanup. Orchestrator discovery is bounded to the
counted projects home (never above it), and a prospective no-board observer cannot create a board
via its log directory before deliberate bootstrap. The skill's separate creation-time depth4
scan is not this ancestor check. No-board child cwd never creates a private board. Root bootstrap
requires its own UI decision and a committed first-coordinator declaration.

SessionManager/current persisted header/list in the actual session directory establish the new id;
the runtime ready endpoint and its health route establish the port. Neither is a model argument.
Registered-worker ids and port collisions stop. A connected old endpoint unconditionally stops.
Disconnected/unknown do not prove termination. The backend's captured Pi UI obtains an authority
reference, exactly `I confirm coordinator <old-sessionId> ended`, then affirmative consent to the
specific board/config/roster transition. Its UUID and config hash are displayed before final consent;
the immutable decision is one-use and the ended timestamp is captured after the wording. Cancel/
blank/false/stale preview changes nothing.

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
unverifiable results stop. Every live final-effect guard revalidates the newest committed anchor,
not only cached approved bytes; restoring old worktree bytes after a newer malformed/deleted commit
cannot reopen authority. Missing worktree bytes do not erase committed-history ordinary-writer fences.
No hook bypass, rollback, retry, normalization or second record writer.

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
  neither config nor record. Promotion failure is `PROMOTION_PENDING`, not authority to act. Read-only
  status also reports that pending/not-ready state and explicit retry, never `proceed` before readiness.
* Foreign adopting session, including clean committed prepared evidence: `RECOVERY_REQUIRED`; preserve
  and report. No supersession wizard, new verb or manual repair writer is supplied.

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

## Current evidence and effect boundaries

The committed-evidence proof has one local implementation with synchronous final-effect and
asynchronous boot/locked-writer adapters. Each proof reads the newest reachable claim-changing commit,
its exact bytes, and the prepared object plus ancestry. No result survives an invocation: there is no
cross-await/epoch cache, TTL, history monitor, persistent Git process or opening-commit equality rule.
A newest committed exact restoration can pass a fresh complete proof; restoring only worktree bytes
under malformed/deleted/unavailable newer evidence cannot. Failed proof closes readiness until explicit
verified reconciliation; reopening cannot revive a previously admitted operation's old epoch.

Owned boundaries (asserted beside the regression tests):

* Coordinator request admission and read-only returns after snapshot/probe awaits (`worker_status`).
  List's admission is its final proof: no await or reentrant callback intervenes.
* Config admission inside the shared lock and final rename, including platform retries. Preparation
  checks lifecycle/epoch cheaply; final publication independently verifies current claim/pair/evidence.
* Report admission, final rename, and later notification are three separate full proofs. Directory/temp
  preparation checks lifecycle/epoch; unpublished staging is not accepted evidence and is cleaned on
  refusal. Already-saved bytes survive a later notification block, with the stored/not-notified error.
* Registration/resume caches, host delivery (including reminders), transport dispatch and runtime
  launch dispatch retain fresh proofs. The launch check follows observation callbacks and carries the
  original operation's epoch through runtime-side directory/probe/state awaits.

The existing synchronous config guard uses internal `authority` and `authority-refused` phases.
At locked admission and each final publication, runtime checks its original lifecycle/epoch, exact
ready bytes, safe paths, initialId/bound endpoint and loaded responsibility without duplicating Git;
the store independently supplies the complete evidence proof, even without a runtime callback.
Current-config read/parse/schema/permission and authority-path failures (including acquisition),
history/evidence discovery and final pair/proof refusals signal synchronously before cleanup/release
awaits. Notification cannot suppress or mask the originating refusal. Only the still-current
authority-enabled epoch closes; direct/non-Orchestrator callers retain their originating errors and
store fence. Lifecycle/deadline, lock contention/token/I/O, mutator/postvalidation and temporary,
rename or cleanup failures are not classified as tenure corruption.

Handoff's three store update guards and two synchronous target lookup sites check only disposed/ended,
exact pending-map ownership, deadline and the existing target/job/port/directory predicates. The
unchanged runtime/store update boundary owns authority there. All other handoff full guards remain
full, including nested calls, provider returns and beforeSubmit; there is no ambient preparation mode.
An in-memory job change already admitted before later staging failure is not retroactively undone.

Launch dispatch admits the existing composite adapter operation. Its internal session lookup, role
preflight, tab creation and pane submission may complete after later invalidation. This is not
per-subeffect cancellation; subsequent dispatch is refused, returned pane/tab/partial/unknown evidence
is preserved, and no cleanup/retry is added. Production launcher/transport APIs are unchanged.

Ordinary config reads use baseline `JSON.parse` and full validation. Duplicate-key/span checks remain
in strict adoption reads. Absent ordinary claims avoid Git only after an uncached ancestor/context
scan excludes `.git` (directory or worktree file), bare/damaged repository markers and configured Git
context; uncertainty still queries/fails closed. Windows comparisons normalize relevant environment
names only; POSIX remains case-sensitive and values are unchanged. Committed deletion history still
fences updates.

Verified legacy absence is local to one acquired ordinary update through its continuously held lock
and retries. Supported claim writers need that same lock. Every subsequent update rediscovers it,
including separate updates under a reentrant outer transaction: no store/runtime 'never adopted' cache.
External claim creation/commit/deletion or repository/context installation bypassing the mutex during
that one legacy write is not guaranteed immediate detection; the next update must discover it. There
is no bounded background detection if another update never occurs. A presence/config-byte check alone
cannot detect a transient add/delete cycle; full history rediscovery could, but that stronger guarantee
and synchronous legacy cost are not assigned. Established/adopted final proofs remain fully fresh.

## Executable proof

```
env -u PI_ROLE_DIR -u PI_INTERCOM_WORKER_ROLE npm test
npm run typecheck
npm run check:package
PI_ADOPTION_HOST_ROOT=<absolute Pi1.2.0 package root> npm run test:adoption-host
node tests/fixtures/adoption-runner.mjs <fixed-case-name>
```

`npm test` explicitly wires the fixture runner, independent claim/bridge/runtime tests, HTTP readiness
phase/epoch/report-save/reminder barriers, real-default-observer no-board/above-home boot guards,
one-use preview binding and barrier-controlled separate-process races/crashes. Independent-review
regressions exercise missing committed prepared/active evidence on ordinary/status/handoff publishers,
already-running malformed/deleted newest anchors with restored old bytes, final save/notification
guards, and failed-promotion status followed by explicit write-free retry.
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
