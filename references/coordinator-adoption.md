# Coordinator adoption backend

`Intercom.adoptCoordinator` is the single deterministic coordinator-entry replacement path. The
human invokes `/intercom-adopt` from the **Orchestrator Pi TUI**, through the separately installed
host integration. `/intercom-adopt status` is read-only; the host integration only
explains the operation. This globally loaded backend registers no adoption tool, HTTP writer,
CLI, shell helper or slash command. There is no manual claim/config editing or terminal fallback.

The frontend discovers exactly one protocol1 offer on `intercom:coordinator-adoption:v1` through
Pi's supported synchronous event bus. The closure independently checks captured launch role,
current runtime/SessionManager/cwd, TUI, trust, idle state, persisted identity and its bound health
endpoint. Caller UI/identity/confirmation arguments grant no authority. A copied frontend, role
basename, worker metadata or instruction text cannot authorize a Developer/plain-Pi runtime.
Application role gating is not an OS sandbox against malicious same-user code.

## Availability and prerequisites

The command frontend and its explanation are provided by the host integration.
They are separate from this backend package; no global command appears from installing this package
alone. The integration must load both the backend and exactly one compatible role-local frontend.
Human installation/rollout is separate from adoption. Start a fresh persisted Orchestrator session in
interactive, trusted, idle Pi, under the shared projects-home Git root. The index/worktree must be
clean (except the narrowly recognized workflow-generated active-record recovery). Upgrade all
config-publishing processes first; confirm the old session ended, not merely that its port is down.

## Deliberate decision and evidence

The expected projects home is `PI_INTERCOM_PROJECTS_HOME`, default `~/workspaces/projects`. Count
`.pi-intercom` directories on **cwd→home ancestors**, before config discovery or initialization.
Second/wrong/unsafe boards stop; no automatic cleanup. Orchestrator discovery is bounded to the
counted projects home (never above it), and a prospective no-board observer cannot create a board
via its log directory before deliberate bootstrap. The host integration's separate creation-time depth4
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
self-reported summary is not approval. The complete human first-use checklist is in the host integration.

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

## Measured differential

These figures are the finished offline differential for source and dist commit
`7778d4f605855b06cea35a11deef789b073c11da`. Each parent fingerprinted the candidate source, dist,
and runner bytes and verified every committed dist file in the baseline and original archives
against `git show` of `e5b817a7b309dd28c2b56efc25506aa431fc0e68` (54 files) and
`f04c1f42bbc4359aa0ad7d2c39c60f9cd29cdb10` (57 files). This evidence section and the gzip records do
not change those fingerprinted bytes. The plain-language adoption section already in `README.md` at
that commit stays as written.

Environment on every parent metadata line: Node v24.21.0, Git 2.47.3, Linux
`6.12.88+deb13-cloud-amd64` x64, filesystem `ext2/ext3`, CPU affinity `0-3`. There is no GPU workload. Each task is an
independent process. Inside a process, baseline A, baseline B, original, and candidate use separate
temporary boards. Repetition order is a seeded LCG (`run*101+workers`, multiplier 1664525, increment
1013904223). Sample index `i` pairs the i-th measured repetition of each variant after that shuffle;
the four variants did not share one clock. Handler time is call wall time. End-to-end time continues
through the default observer flush when that observer is installed. Quantiles use the runner rule
`sorted[min(n-1, floor(n*q))]`, so an even-count p50 is the upper central rank. A pooled p50/p95/max
uses every warm sample in the cell. A run median is that p50 for one process. The A/A figure is the
median across five runs of the within-run median `|baselineA-baselineB|`. The paired delta is the
median across five runs of the within-run median `candidate - mean(baselineA, baselineB)`.

The main matrix is five processes per cell, 12 warm samples, and 2 warmups. That is a reduced
sample. It is smaller than a 100-sample-per-operation acceptance matrix. The runner default remains
100 samples and 5 warmups; these parents passed `--samples 12 --warmup 2` except where a control
below names another size. `--workers` selects the runner's fixed bundles, and the three parents ran
sequentially:

- 2 workers, 0 unrelated empty commits, and 0 claim-restoration pairs when opted in.
- 16 workers, 32 unrelated empty commits, and 8 claim-restoration pairs when opted in.
- 64 workers, 1024 unrelated empty commits, and 32 claim-restoration pairs when opted in.

Roster size and history depth move together. A larger worker count in this matrix is also a deeper
unrelated history. Declared and adopted rows opt in only original and candidate. Baseline A/B on
those rows are the same calls on the unfenced e5b817a runtime, which has no claim safety. Ordinary
rows run all four variants as ordinary writers. A lower baseline time is therefore a safety
difference as well as a time difference.

Warm parents started at 2026-10-17T12:46:10Z, 12:53:31Z, and 13:01:31Z and finished all 120 tasks: 3
profiles, 2 observers, 4 modes, and 5 runs. Every warm task asserted one normalized functional trace
across all four variants. Normalization covers only root, session id, UUID, port, timestamp, and
age. Seeded historical log, report, and session bytes matched exactly. The 120 tasks produce six
trace hashes, one for each profile and observer. Within a profile and observer, all four modes and
all five runs share that hash, so the normalized ordinary, declared, and adopted results match one
another. The default and noop observers do not share a hash. No warm sample refused. Cold-only
parents omit that common trace by flag; the warm matrix is the functional comparison.

### Gaps that remain open

Acceptance of the remaining handler-time gap is unresolved. These measurements do not establish a
regression waiver, a zero-cost result, or an irreducible floor. Git call counts describe the runs.
They are not a tolerance band.

Ordinary non-repository status, default observer, performs 0 synchronous and 0 asynchronous Git
calls on the candidate:

Small profile, history depth 0. Baseline A/B pooled p50 0.465 / 0.469 ms (p95 0.871 / 0.807).
Original p50/p95 2.724 / 4.054 ms. Candidate p25/p50/p75/p95/max 1.237 / 1.275 / 1.322 / 2.376 /
6.289 ms. Five candidate run medians: 1.275 1.273 1.304 1.260 1.304. End-to-end p50/p95 1.511 /
2.764 ms. Paired delta 0.816 ms, run range 0.775–0.861. A/A 0.046 ms, run range 0.039–0.088. Git 0
sync / 0 async; sync-ms p50 0.000; async-ms p50 0.000; max synchronous Git span 0.000 ms; max guard
span 0.127 ms; 1 ms event-loop heartbeat p95/max 0.890 / 1.353 ms.

Middle profile, history depth 32. Baseline A/B pooled p50 0.529 / 0.519 ms (p95 0.610 / 0.878).
Original p50/p95 2.938 / 3.712 ms. Candidate p25/p50/p75/p95/max 1.277 / 1.318 / 1.371 / 1.712 /
2.212 ms. Five candidate run medians: 1.318 1.306 1.331 1.292 1.359. End-to-end p50/p95 1.555 /
1.955 ms. Paired delta 0.805 ms, run range 0.795–0.821. A/A 0.040 ms, run range 0.032–0.066. Git 0
sync / 0 async; sync-ms p50 0.000; async-ms p50 0.000; max synchronous Git span 0.000 ms; max guard
span 0.081 ms; 1 ms event-loop heartbeat p95/max 0.775 / 1.087 ms.

Large profile, history depth 1024. Baseline A/B pooled p50 0.683 / 0.678 ms (p95 1.146 / 1.050).
Original p50/p95 3.478 / 4.519 ms. Candidate p25/p50/p75/p95/max 1.437 / 1.488 / 1.601 / 1.944 /
3.741 ms. Five candidate run medians: 1.505 1.513 1.512 1.500 1.463. End-to-end p50/p95 1.718 /
2.188 ms. Paired delta 0.771 ms, run range 0.766–0.865. A/A 0.057 ms, run range 0.048–0.070. Git 0
sync / 0 async; sync-ms p50 0.000; async-ms p50 0.000; max synchronous Git span 0.000 ms; max guard
span 0.109 ms; 1 ms event-loop heartbeat p95/max 0.802 / 1.069 ms.

The paired delta stays near 0.8 ms on every profile, above an A/A band near 0.05 ms. The cost is inside the process and does not grow with unrelated history in this matrix.

Ordinary repository status performs one asynchronous Git query and zero synchronous Git calls:

History depth 0. Baseline A/B pooled p50 0.503 / 0.512 ms (p95 0.923 / 1.018). Original p50/p95
2.942 / 6.183 ms. Candidate p25/p50/p75/p95/max 2.755 / 2.911 / 3.381 / 6.352 / 6.738 ms. Five
candidate run medians: 2.926 2.892 2.874 2.789 5.043. End-to-end p50/p95 3.140 / 6.730 ms. Paired
delta 2.419 ms, run range 2.278–4.221. A/A 0.050 ms, run range 0.039–0.076. Git 0 sync / 1 async;
sync-ms p50 0.000; async-ms p50 1.684; max synchronous Git span 0.000 ms; max guard span 0.165 ms; 1
ms event-loop heartbeat p95/max 0.912 / 1.796 ms.

History depth 32. Baseline A/B pooled p50 0.564 / 0.544 ms (p95 0.986 / 0.866). Original p50/p95
4.263 / 5.933 ms. Candidate p25/p50/p75/p95/max 3.740 / 4.057 / 4.857 / 6.345 / 7.416 ms. Five
candidate run medians: 4.282 3.875 3.851 3.677 5.006. End-to-end p50/p95 4.332 / 6.647 ms. Paired
delta 3.311 ms, run range 3.139–4.456. A/A 0.086 ms, run range 0.049–0.094. Git 0 sync / 1 async;
sync-ms p50 0.000; async-ms p50 2.677; max synchronous Git span 0.000 ms; max guard span 0.137 ms; 1
ms event-loop heartbeat p95/max 0.932 / 1.457 ms.

History depth 1024. Baseline A/B pooled p50 0.742 / 0.755 ms (p95 1.081 / 1.031). Original p50/p95
21.785 / 24.530 ms. Candidate p25/p50/p75/p95/max 20.644 / 21.045 / 21.826 / 24.576 / 25.999 ms.
Five candidate run medians: 22.383 20.837 20.406 21.742 20.800. End-to-end p50/p95 21.287 / 25.051
ms. Paired delta 20.133 ms, run range 19.694–21.557. A/A 0.100 ms, run range 0.055–0.140. Git 0 sync
/ 1 async; sync-ms p50 0.000; async-ms p50 19.392; max synchronous Git span 0.000 ms; max guard span
0.116 ms; 1 ms event-loop heartbeat p95/max 0.686 / 1.468 ms.

At history depth 0 the paired delta is 2.419 ms. At the bundled depth of 1024 unrelated empty
commits the candidate p50 is 21.045 ms and the paired delta is 20.133 ms, while A/A is 0.100 ms. The
same single async query is history-sensitive. Overlap on that large ordinary-repository profile
carries 2 async queries and a candidate p50 of 42.793 ms, paired delta 40.930 ms.

Ordinary list, report, clear, registration, local worker status, worker-status probe, coordinator
send, and message do not exceed their A/A medians on any measured profile. Status, sequential load,
and overlap exceed the A/A median on every ordinary profile. Sequential load is two requests in
series and includes a status publication. Overlap is four concurrent requests and includes status.
Worker transmit is the remaining ordinary exception, and its excess stays at the edge of the band:
2w ordinary-nonrepo delta 0.065 vs A/A 0.064; 64w ordinary-nonrepo delta 0.108 vs A/A 0.098; 64w
ordinary-repo delta 0.078 vs A/A 0.050.

Adopted paths, default observer. Baseline A/B are unfenced. Git counts were constant across all 60
samples in each cell. Every declared and adopted cell in the default-observer matrix, including
operations not repeated in this paragraph, has a paired delta above its A/A median.

List. 2w p50 6.871 (p95 9.795, max 10.157, run medians 6.871 9.418 6.820 6.856 6.869, e2e p50 6.876,
original p50 13.379, baseline A/B 0.213/0.216, delta 6.662, A/A 0.062, git 4/0, sync-ms 6.451,
async-ms 0.000, guard max 9.881) 16w p50 7.462 (p95 10.123, max 15.755, run medians 7.719 7.963
7.300 7.270 7.422, e2e p50 7.468, original p50 14.567, baseline A/B 0.256/0.232, delta 7.212, A/A
0.066, git 4/0, sync-ms 6.920, async-ms 0.000, guard max 15.467) 64w p50 8.269 (p95 10.677, max
11.129, run medians 8.261 8.181 8.324 9.173 8.419, e2e p50 8.275, original p50 16.262, baseline A/B
0.277/0.282, delta 8.026, A/A 0.050, git 4/0, sync-ms 7.484, async-ms 0.000, guard max 10.645)

Report. 2w p50 21.284 (p95 27.618, max 30.132, run medians 21.151 21.750 21.305 21.246 21.477, e2e
p50 21.490, original p50 95.093, baseline A/B 0.964/0.953, delta 20.357, A/A 0.161, git 12/0, sync ms 19.440, async-ms 0.000, guard max 10.085) 16w p50 22.758 (p95 31.803, max 35.667, run medians
29.629 25.129 24.605 22.360 22.455, e2e p50 22.953, original p50 101.914, baseline A/B 0.999/1.007,
delta 23.591, A/A 0.168, git 12/0, sync-ms 20.597, async-ms 0.000, guard max 13.114) 64w p50 25.405
(p95 30.498, max 31.600, run medians 25.563 26.917 25.334 25.234 27.159, e2e p50 25.716, original
p50 114.975, baseline A/B 1.046/1.092, delta 24.448, A/A 0.157, git 12/0, sync-ms 22.494, async-ms
0.000, guard max 11.929)

Status. 2w p50 28.993 (p95 36.511, max 37.167, run medians 28.685 28.993 32.640 28.745 29.085, e2e
p50 29.345, original p50 70.252, baseline A/B 0.533/0.538, delta 28.512, A/A 0.083, git 12/4, sync ms 19.750, async-ms 6.428, guard max 10.430) 16w p50 30.105 (p95 34.013, max 34.992, run medians
30.096 30.224 29.902 32.957 29.680, e2e p50 30.542, original p50 72.966, baseline A/B 0.606/0.589,
delta 29.529, A/A 0.111, git 12/4, sync-ms 20.425, async-ms 6.591, guard max 9.521) 64w p50 34.604
(p95 42.706, max 52.780, run medians 34.365 39.775 34.462 34.652 34.587, e2e p50 35.010, original
p50 83.450, baseline A/B 0.778/0.759, delta 33.653, A/A 0.107, git 12/4, sync-ms 22.865, async-ms
7.322, guard max 15.012)

Overlap, four request units. 2w p50 100.979 (p95 117.907, max 143.069, run medians 100.519 106.232
100.795 101.461 101.180, e2e p50 101.281, original p50 339.067, baseline A/B 2.015/1.997, delta
98.910, A/A 0.184, git 48/8, sync-ms 80.875, async-ms 26.951, guard max 12.656) 16w p50 106.453 (p95
143.217, max 178.697, run medians 113.412 105.681 106.010 107.214 105.922, e2e p50 106.744, original
p50 353.046, baseline A/B 2.173/2.137, delta 103.912, A/A 0.172, git 48/8, sync-ms 84.495, async-ms
28.141, guard max 17.303) 64w p50 120.758 (p95 152.173, max 178.531, run medians 121.675 125.032
120.276 119.886 122.358, e2e p50 121.079, original p50 401.514, baseline A/B 2.569/2.498, delta
119.162, A/A 0.184, git 48/8, sync-ms 93.487, async-ms 31.384, guard max 15.613)

At the small adopted profile, status throughput is 33.260 completed requests per second of end-to-end time, and overlap throughput is 38.502 request-units per second. Baseline A overlap throughput
on that cell is 1884.852. Candidate adopted times are lower than original f04c1f4 on these paths.
The gap versus unfenced baseline remains large on every profile and sits outside the A/A band.
Declared rows in the complete matrix sit between ordinary and adopted and use fewer Git calls than
the active-evidence proof.

The noop observer changes candidate call p50 by at most 3.174 ms in this matrix (16 workers,
declared overlap: default 56.846, noop 53.672). Small-profile adopted status end-to-end p50 is
29.345 ms with the default observer and 29.052 ms with the noop observer. The adopted gap versus
baseline is present with either observer.

The 1 ms event-loop heartbeat measures timer lag during the call, including the timer's own
granularity. It is a stall indicator for the measured process, not a separate user-facing latency
probe.

### Measured smaller alternatives

These ablations ran in the alternatives parent: 5 processes, 100 samples, 5 warmups, default
observer, and the 2-worker profiles. The timed operation matrix was empty; the ablation then called
the real status or list path. They are diagnostic. A lower time here is not a proposed design and is
not a shippable implementation.

Ordinary non-repository status through the actual candidate store: run medians 1.152 1.133 1.126
1.199 1.151; pooled p25/p50/p75/p95/max 1.105 / 1.152 / 1.211 / 1.393 / 7.737 ms (n=500). The same
calls through an unfenced baseline store: run medians 0.390 0.387 0.380 0.405 0.401; pooled
p25/p50/p75/p95/max 0.378 / 0.393 / 0.412 / 0.469 / 4.483 ms. That substitution removes cooperating-process exclusion and authority protection.

Actual full list proof: run medians 6.768 6.692 6.543 6.785 6.805; pooled p25/p50/p75/p95/max 6.614
/ 6.731 / 6.887 / 7.781 / 9.574 ms (n=500).

Epoch-only list, which skips the evidence proof: run medians 0.095 0.086 0.082 0.084 0.086; pooled
p25/p50/p75/p95/max 0.083 / 0.086 / 0.094 / 0.121 / 0.354 ms (n=500).

Latest-commit-only list, which does not read the prepared-intent object: run medians 1.850 1.689
1.738 1.785 1.776; pooled p25/p50/p75/p95/max 1.719 / 1.764 / 1.825 / 1.962 / 3.225 ms (n=500).

After those samples, each of the five adopted processes deleted the committed intent object. The
latest-only ablation admitted the missing intent on all five processes. Restoring the actual full
guard then rejected list on all five processes. The latest-only and epoch-only times are smaller
because they drop required evidence checks.

### Focused sample, cold access, churn, refusal, recovery, handoff

Focused sensitivity used the large adopted profile, default observer, 5 processes, 100 warm samples,
and 5 warmups, for status and overlap only.

status: focused pooled p50/p95/max 34.880 / 42.645 / 59.272 ms, run medians 35.037 34.878 34.707
34.696 34.989. The 12-sample warm cell pooled p50/p95/max 34.604 / 42.706 / 52.780, run medians
34.365 39.775 34.462 34.652 34.587. Git remained 12/4.

overlap: focused pooled p50/p95/max 126.910 / 149.659 / 201.491 ms, run medians 127.125 128.239
127.580 125.647 126.933. The 12-sample warm cell pooled p50/p95/max 120.758 / 152.173 / 178.531, run
medians 121.675 125.032 120.276 119.886 122.358. Git remained 48/8.

The larger status sample centers on the same band as the reduced warm sample. Overlap's focused p50
is a few milliseconds higher, and its maximum is higher. The reduced matrix does not hide a
different status regime. It also does not stand in for the larger sample as an acceptance set.

Cold parents used a fresh process, `--cold-only true`, 0 samples, 0 warmup, 5 runs, workers 2 and
64, the default observer, and one operation each, so an earlier operation in the same task could not
warm the measured method. Startup Git had already run. This is not an empty OS page cache.

list: 2w ordinary-nonrepo candidate median 0.552 [0.461, 0.668] baseline-A median 0.490; 2w adopted
candidate median 7.392 [7.230, 9.250] baseline-A median 0.584; 64w ordinary-nonrepo candidate median
0.662 [0.605, 0.705] baseline-A median 0.574; 64w adopted candidate median 8.928 [8.561, 9.699]
baseline-A median 0.609.

status: 2w ordinary-nonrepo candidate median 1.453 [1.431, 1.598] baseline-A median 0.568; 2w
adopted candidate median 28.329 [27.877, 29.339] baseline-A median 0.677; 64w ordinary-nonrepo
candidate median 1.637 [1.616, 1.757] baseline-A median 0.779; 64w adopted candidate median 34.875
[33.752, 39.999] baseline-A median 0.871.

worker_status_probe: 2w ordinary-nonrepo candidate median 5.894 [5.209, 11.825] baseline-A median
6.322; 2w adopted candidate median 25.474 [25.324, 30.796] baseline-A median 5.380;
64w ordinary-nonrepo candidate median 15.179 [15.027, 22.453] baseline-A median 14.985; 64w adopted candidate
median 45.658 [41.003, 48.628] baseline-A median 16.628.

overlap: 2w ordinary-nonrepo candidate median 4.171 [4.112, 5.060] baseline-A median 3.430; 2w
adopted candidate median 96.512 [96.191, 115.925] baseline-A median 3.019; 64w ordinary-nonrepo
candidate median 4.859 [4.771, 5.722] baseline-A median 3.657; 64w adopted candidate median 122.368
[115.584, 159.356] baseline-A median 3.753.

List, status, and overlap first-access medians sit near their warm p50 values. Probe first-access
medians are higher, on baseline as well as on the candidate, and the five-run ranges are wider.

Churn used the large profile, default observer, ordinary-repository and adopted modes,
list/status/overlap, 12 samples, 2 warmups, and 5 runs. Every tenth warm repetition of each variant
creates an unrelated empty commit outside the timed call.

ordinary-repo list: churn p50/p95 0.265 / 0.404 versus warm 0.264 / 0.424. Outside-call commit
p50/max 3.433 / 4.588 ms (n=10).

ordinary-repo status: churn p50/p95 21.115 / 22.466 versus warm 21.045 / 24.576. Outside-call commit
p50/max 3.277 / 4.164 ms (n=10).

ordinary-repo overlap: churn p50/p95 42.858 / 45.840 versus warm 42.793 / 49.814. Outside-call
commit p50/max 3.474 / 3.730 ms (n=10).

adopted list: churn p50/p95 8.323 / 9.056 versus warm 8.269 / 10.677. Outside-call commit p50/max
3.302 / 3.520 ms (n=10).

adopted status: churn p50/p95 35.305 / 40.488 versus warm 34.604 / 42.706. Outside-call commit
p50/max 3.317 / 3.909 ms (n=10).

adopted overlap: churn p50/p95 124.828 / 179.425 versus warm 120.758 / 152.173. Outside-call commit
p50/max 3.612 / 5.050 ms (n=10).

Timed results stay in the warm band. The commit cost is excluded from the timed call by the runner.
Adopted overlap's churn p95 is higher than its warm p95.

Refusal parents used the small adopted profile, default observer, all 12 operations, 2 warm samples,
0 warmup, and 5 runs, after the common functional trace. Damage was then applied as an adopted
negative. Baseline A/B have no claim fence, so they completed every timed call: 120/120 each, in
both the missing-worktree and newer-malformed modes. Original and candidate refused 120/120 in both
modes. Of those refusals, 110 were direct `ADOPTION_NOT_READY` errors and 10 were that error wrapped
as HTTP 400. Missing-worktree wording on both original and candidate was `committed claim/board pair
or local responsibility changed`. Newer malformed-then-restored bytes kept that wording on original
and used `committed evidence changed or became unavailable` on the candidate. The runner then
required original and candidate config, messages, and historical report bytes to be unchanged.
Candidate refusal handler p50 was 0.252 ms for each damage mode across the pooled refused samples.

Recovery used adopted mode, workers 2 and 64, default observer, 5 runs, and no hot-path samples. A
fixture hook rejected the active commit; the same session then reinvoked adoption after the hook was
removed. The parent completed only when original and candidate returned `RECOVERED`. Baseline does
not opt in, so those rows have no adoption timing.

One-shot adoption milliseconds: 2w original failed-attempt 96.182 95.155 91.077 99.642 91.020;
recovery handler 69.906 77.322 71.845 92.942 69.435. 2w candidate failed-attempt 85.325 98.811
86.730 103.037 85.663; recovery handler 64.703 70.670 65.617 77.886 67.093. 64w original failed attempt 171.061 187.161 168.035 175.806 166.890; recovery handler 69.586 79.229 71.162 75.479
71.783. 64w candidate failed-attempt 170.682 187.915 167.232 171.911 175.291; recovery handler
69.620 78.271 69.080 72.479 71.953. These attempts are not the steady-state status or list cost.

Handoff attribution used 5 adopted runs at 2 workers and no hot-path samples. Counts were identical
across the five runs. Async Git stayed 4 on every path. Final candidate `7778d4f` synchronous counts
were request 12, transition 4, and report 20, all attributed to the store proof (`other`); caller
and mutation Git were 0. Call-time ranges were request 28.001–28.882 ms, transition 14.075–16.284
ms, and report 40.159–41.434 ms. Whole-original f04c1f4 on the same parent was request 52,
transition 44, and report 60 synchronous, with 20 counted in the caller guard on each path.

The component-before parent is a disposable tree whose candidate metadata head is null. Its
fingerprinted `src/handoff.ts` and `dist/handoff.js` match f04c1f4
(`6bed7a0275bb0fa34a9ee54edb25cc86dcbf3a7c3275678ddea130c1e05d7347` and
`55b17a812e7131289cf355568c1c8d7b85f83e37ce02d533d0cf7f51da5d3b12`). The other fingerprinted runtime
and config bytes match `7778d4f`. That copy measured request/transition/report synchronous Git at
32/28/44, with caller 20 on each path. The private handoff split accounts for the drop from 32/28/44
to 12/4/20. It leaves the store proof and the 4 async calls in place. The before copy was removed
after the parent exited. Its rows are `adoption-d9-handoff-before.jsonl.gz`.

### Complete warm matrix, default observer

Each cell pools 60 handler samples. Delta and A/A are the five-run medians defined above, in
milliseconds. `C run` is the minimum and maximum of the five candidate run medians. Git is the
synchronous/asynchronous count and was a single value in every cell.


| Profile | Mode | Operation | A p50 | B p50 | Original p50 | C p25 | C p50 | C p75 | C p95 | C max | C run | C e2e p50 | A/A | Delta | Git |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---|
| 2w/h0 | ordinary-nonrepo | list | 0.155 | 0.144 | 0.195 | 0.150 | 0.174 | 0.197 | 0.218 | 0.236 | 0.164–0.185 | 0.176 | 0.041 | 0.025 | 0/0 |
| 2w/h0 | ordinary-nonrepo | report | 0.782 | 0.794 | 0.884 | 0.776 | 0.808 | 0.849 | 1.074 | 1.237 | 0.785–0.864 | 0.924 | 0.038 | 0.020 | 0/0 |
| 2w/h0 | ordinary-nonrepo | clear | 0.759 | 0.760 | 0.820 | 0.751 | 0.781 | 0.822 | 0.981 | 1.130 | 0.751–0.853 | 0.887 | 0.037 | 0.031 | 0/0 |
| 2w/h0 | ordinary-nonrepo | status | 0.465 | 0.469 | 2.724 | 1.237 | 1.275 | 1.322 | 2.376 | 6.289 | 1.260–1.304 | 1.511 | 0.046 | 0.816 | 0/0 |
| 2w/h0 | ordinary-nonrepo | registration | 0.257 | 0.263 | 0.299 | 0.246 | 0.273 | 0.294 | 0.326 | 0.392 | 0.260–0.289 | 0.451 | 0.023 | 0.009 | 0/0 |
| 2w/h0 | ordinary-nonrepo | worker_status | 2.951 | 3.027 | 3.006 | 2.885 | 3.012 | 3.165 | 3.978 | 4.085 | 2.902–3.291 | 3.015 | 0.177 | 0.002 | 0/0 |
| 2w/h0 | ordinary-nonrepo | worker_status_probe | 3.534 | 3.556 | 3.712 | 3.540 | 3.629 | 3.876 | 4.407 | 4.696 | 3.525–3.938 | 3.632 | 0.181 | 0.052 | 0/0 |
| 2w/h0 | ordinary-nonrepo | worker_transmit | 1.618 | 1.618 | 1.827 | 1.559 | 1.680 | 1.925 | 3.709 | 4.338 | 1.563–2.647 | 1.822 | 0.064 | 0.065 | 0/0 |
| 2w/h0 | ordinary-nonrepo | coordinator_send | 0.956 | 0.964 | 1.083 | 0.952 | 1.029 | 1.078 | 1.818 | 5.415 | 0.969–1.158 | 1.180 | 0.097 | 0.068 | 0/0 |
| 2w/h0 | ordinary-nonrepo | message | 0.173 | 0.167 | 0.209 | 0.153 | 0.189 | 0.229 | 0.274 | 0.284 | 0.172–0.230 | 0.302 | 0.048 | 0.015 | 0/0 |
| 2w/h0 | ordinary-nonrepo | sequential_load | 1.175 | 1.197 | 3.523 | 1.904 | 1.973 | 2.076 | 2.812 | 2.971 | 1.956–2.240 | 2.198 | 0.054 | 0.792 | 0/0 |
| 2w/h0 | ordinary-nonrepo | overlap | 1.855 | 1.849 | 6.068 | 2.726 | 2.802 | 2.907 | 3.504 | 4.557 | 2.686–2.896 | 3.123 | 0.099 | 0.965 | 0/0 |
| 2w/h0 | ordinary-repo | list | 0.172 | 0.162 | 0.200 | 0.152 | 0.176 | 0.197 | 0.245 | 0.248 | 0.171–0.213 | 0.179 | 0.033 | 0.010 | 0/0 |
| 2w/h0 | ordinary-repo | report | 0.785 | 0.784 | 0.862 | 0.765 | 0.800 | 0.845 | 1.255 | 1.333 | 0.763–0.889 | 0.916 | 0.037 | 0.017 | 0/0 |
| 2w/h0 | ordinary-repo | clear | 0.768 | 0.760 | 0.839 | 0.737 | 0.780 | 0.839 | 1.055 | 1.604 | 0.731–0.890 | 0.884 | 0.039 | 0.021 | 0/0 |
| 2w/h0 | ordinary-repo | status | 0.503 | 0.512 | 2.942 | 2.755 | 2.911 | 3.381 | 6.352 | 6.738 | 2.789–5.043 | 3.140 | 0.050 | 2.419 | 0/1 |
| 2w/h0 | ordinary-repo | registration | 0.272 | 0.265 | 0.298 | 0.255 | 0.277 | 0.311 | 0.393 | 0.525 | 0.261–0.333 | 0.444 | 0.033 | 0.016 | 0/0 |
| 2w/h0 | ordinary-repo | worker_status | 3.006 | 2.998 | 3.088 | 2.903 | 2.946 | 3.447 | 4.181 | 5.348 | 2.842–3.658 | 2.949 | 0.103 | -0.009 | 0/0 |
| 2w/h0 | ordinary-repo | worker_status_probe | 3.554 | 3.570 | 3.681 | 3.483 | 3.621 | 3.823 | 5.108 | 5.568 | 3.522–3.812 | 3.624 | 0.160 | 0.073 | 0/0 |
| 2w/h0 | ordinary-repo | worker_transmit | 1.611 | 1.593 | 1.772 | 1.574 | 1.645 | 1.752 | 2.533 | 4.596 | 1.586–1.741 | 1.790 | 0.086 | 0.034 | 0/0 |
| 2w/h0 | ordinary-repo | coordinator_send | 0.968 | 0.955 | 1.072 | 0.959 | 0.993 | 1.031 | 1.334 | 5.481 | 0.975–1.053 | 1.135 | 0.089 | 0.037 | 0/0 |
| 2w/h0 | ordinary-repo | message | 0.177 | 0.171 | 0.203 | 0.160 | 0.187 | 0.209 | 0.243 | 0.360 | 0.174–0.210 | 0.304 | 0.033 | 0.016 | 0/0 |
| 2w/h0 | ordinary-repo | sequential_load | 1.215 | 1.216 | 3.658 | 3.438 | 3.567 | 3.707 | 4.213 | 5.251 | 3.549–3.706 | 3.821 | 0.070 | 2.362 | 0/1 |
| 2w/h0 | ordinary-repo | overlap | 1.884 | 1.868 | 5.874 | 5.535 | 5.623 | 6.119 | 7.094 | 7.745 | 5.564–6.452 | 5.840 | 0.097 | 3.794 | 0/2 |
| 2w/h0 | declared | list | 0.202 | 0.198 | 6.818 | 3.461 | 3.525 | 3.624 | 4.039 | 4.446 | 3.459–3.628 | 3.529 | 0.037 | 3.332 | 2/0 |
| 2w/h0 | declared | report | 0.927 | 0.939 | 47.713 | 10.880 | 11.173 | 11.736 | 13.936 | 20.333 | 11.016–12.136 | 11.369 | 0.101 | 10.166 | 6/0 |
| 2w/h0 | declared | clear | 0.891 | 0.906 | 48.164 | 10.978 | 11.128 | 11.359 | 12.705 | 13.114 | 10.990–11.360 | 11.333 | 0.074 | 10.276 | 6/0 |
| 2w/h0 | declared | status | 0.523 | 0.525 | 35.426 | 14.889 | 15.152 | 15.689 | 17.344 | 20.473 | 14.976–16.676 | 15.501 | 0.081 | 14.558 | 6/2 |
| 2w/h0 | declared | registration | 0.308 | 0.316 | 13.734 | 10.337 | 10.624 | 11.098 | 13.389 | 14.893 | 10.337–12.620 | 10.912 | 0.046 | 10.304 | 6/0 |
| 2w/h0 | declared | worker_status | 3.082 | 3.094 | 13.670 | 9.952 | 10.237 | 10.665 | 15.849 | 18.078 | 10.058–12.476 | 10.244 | 0.176 | 7.242 | 4/0 |
| 2w/h0 | declared | worker_status_probe | 3.670 | 3.672 | 18.103 | 14.130 | 14.387 | 14.862 | 17.221 | 19.509 | 14.082–14.698 | 14.392 | 0.284 | 10.778 | 6/0 |
| 2w/h0 | declared | worker_transmit | 1.794 | 1.826 | 50.291 | 12.150 | 12.564 | 13.241 | 14.971 | 15.842 | 12.150–13.213 | 12.727 | 0.196 | 10.711 | 6/0 |
| 2w/h0 | declared | coordinator_send | 1.024 | 1.012 | 15.373 | 8.176 | 8.419 | 9.091 | 11.498 | 13.716 | 8.333–9.092 | 8.586 | 0.099 | 7.387 | 4/0 |
| 2w/h0 | declared | message | 0.215 | 0.212 | 7.249 | 7.045 | 7.232 | 7.877 | 8.941 | 10.427 | 7.045–7.766 | 7.421 | 0.049 | 7.141 | 4/0 |
| 2w/h0 | declared | sequential_load | 1.317 | 1.336 | 84.997 | 26.343 | 26.942 | 28.950 | 36.393 | 42.505 | 26.686–29.470 | 27.440 | 0.151 | 25.790 | 12/2 |
| 2w/h0 | declared | overlap | 1.980 | 1.993 | 168.279 | 51.165 | 51.925 | 54.127 | 59.624 | 72.622 | 50.931–54.127 | 52.262 | 0.201 | 50.111 | 24/4 |
| 2w/h0 | adopted | list | 0.213 | 0.216 | 13.379 | 6.724 | 6.871 | 7.216 | 9.795 | 10.157 | 6.820–9.418 | 6.876 | 0.062 | 6.662 | 4/0 |
| 2w/h0 | adopted | report | 0.964 | 0.953 | 95.093 | 20.876 | 21.284 | 22.242 | 27.618 | 30.132 | 21.151–21.750 | 21.490 | 0.161 | 20.357 | 12/0 |
| 2w/h0 | adopted | clear | 0.892 | 0.922 | 93.761 | 20.928 | 21.178 | 21.638 | 27.029 | 29.022 | 21.052–22.553 | 21.393 | 0.143 | 20.310 | 12/0 |
| 2w/h0 | adopted | status | 0.533 | 0.538 | 70.252 | 28.437 | 28.993 | 29.713 | 36.511 | 37.167 | 28.685–32.640 | 29.345 | 0.083 | 28.512 | 12/4 |
| 2w/h0 | adopted | registration | 0.316 | 0.337 | 27.531 | 20.401 | 20.698 | 21.104 | 27.040 | 28.525 | 20.450–23.608 | 21.035 | 0.052 | 20.360 | 12/0 |
| 2w/h0 | adopted | worker_status | 3.163 | 3.204 | 23.870 | 16.819 | 17.569 | 19.274 | 24.800 | 30.068 | 16.935–22.679 | 17.574 | 0.243 | 14.372 | 8/0 |
| 2w/h0 | adopted | worker_status_probe | 3.805 | 3.872 | 32.167 | 24.559 | 25.086 | 27.220 | 30.720 | 33.106 | 24.569–28.018 | 25.093 | 0.320 | 21.219 | 12/0 |
| 2w/h0 | adopted | worker_transmit | 1.870 | 1.895 | 98.751 | 22.483 | 22.966 | 24.274 | 27.458 | 30.771 | 22.456–25.730 | 23.146 | 0.192 | 21.299 | 12/0 |
| 2w/h0 | adopted | coordinator_send | 1.026 | 1.043 | 29.062 | 14.992 | 15.313 | 16.345 | 18.696 | 25.333 | 14.944–16.495 | 15.483 | 0.100 | 14.374 | 8/0 |
| 2w/h0 | adopted | message | 0.225 | 0.220 | 13.987 | 13.709 | 13.971 | 15.565 | 18.836 | 19.252 | 13.677–16.673 | 14.205 | 0.054 | 13.954 | 8/0 |
| 2w/h0 | adopted | sequential_load | 1.349 | 1.343 | 169.540 | 50.566 | 51.445 | 55.062 | 61.399 | 73.921 | 51.196–55.062 | 51.735 | 0.179 | 51.181 | 24/4 |
| 2w/h0 | adopted | overlap | 2.015 | 1.997 | 339.067 | 100.179 | 100.979 | 104.904 | 117.907 | 143.069 | 100.519–106.232 | 101.281 | 0.184 | 98.910 | 48/8 |
| 16w/h32 | ordinary-nonrepo | list | 0.168 | 0.169 | 0.248 | 0.155 | 0.179 | 0.196 | 0.236 | 0.288 | 0.160–0.201 | 0.182 | 0.039 | 0.022 | 0/0 |
| 16w/h32 | ordinary-nonrepo | report | 0.814 | 0.824 | 0.973 | 0.808 | 0.855 | 0.949 | 1.195 | 3.285 | 0.812–0.991 | 0.979 | 0.068 | 0.037 | 0/0 |
| 16w/h32 | ordinary-nonrepo | clear | 0.799 | 0.795 | 0.944 | 0.791 | 0.824 | 0.914 | 1.117 | 1.621 | 0.767–0.945 | 0.936 | 0.046 | 0.043 | 0/0 |
| 16w/h32 | ordinary-nonrepo | status | 0.529 | 0.519 | 2.938 | 1.277 | 1.318 | 1.371 | 1.712 | 2.212 | 1.292–1.359 | 1.555 | 0.040 | 0.805 | 0/0 |
| 16w/h32 | ordinary-nonrepo | registration | 0.298 | 0.292 | 0.361 | 0.269 | 0.299 | 0.337 | 0.499 | 0.568 | 0.250–0.367 | 0.470 | 0.042 | 0.004 | 0/0 |
| 16w/h32 | ordinary-nonrepo | worker_status | 5.163 | 5.220 | 5.351 | 5.084 | 5.265 | 5.571 | 6.571 | 6.968 | 5.111–6.084 | 5.268 | 0.181 | 0.009 | 0/0 |
| 16w/h32 | ordinary-nonrepo | worker_status_probe | 5.740 | 5.817 | 6.257 | 5.755 | 6.154 | 6.921 | 8.557 | 10.197 | 5.620–7.415 | 6.157 | 0.477 | 0.210 | 0/0 |
| 16w/h32 | ordinary-nonrepo | worker_transmit | 1.637 | 1.648 | 1.948 | 1.607 | 1.686 | 1.939 | 2.248 | 7.388 | 1.590–2.061 | 1.827 | 0.067 | 0.039 | 0/0 |
| 16w/h32 | ordinary-nonrepo | coordinator_send | 1.015 | 1.013 | 1.210 | 1.002 | 1.038 | 1.084 | 1.228 | 1.285 | 1.009–1.067 | 1.186 | 0.052 | 0.022 | 0/0 |
| 16w/h32 | ordinary-nonrepo | message | 0.193 | 0.196 | 0.256 | 0.178 | 0.204 | 0.229 | 0.314 | 0.353 | 0.196–0.247 | 0.320 | 0.032 | 0.021 | 0/0 |
| 16w/h32 | ordinary-nonrepo | sequential_load | 1.345 | 1.318 | 4.160 | 2.051 | 2.190 | 2.368 | 3.153 | 3.337 | 2.036–2.427 | 2.429 | 0.096 | 0.813 | 0/0 |
| 16w/h32 | ordinary-nonrepo | overlap | 2.137 | 2.109 | 7.372 | 3.036 | 3.213 | 3.585 | 4.614 | 6.272 | 3.135–3.561 | 3.586 | 0.115 | 1.030 | 0/0 |
| 16w/h32 | ordinary-repo | list | 0.182 | 0.195 | 0.257 | 0.172 | 0.189 | 0.235 | 0.326 | 0.503 | 0.174–0.257 | 0.196 | 0.035 | 0.013 | 0/0 |
| 16w/h32 | ordinary-repo | report | 0.865 | 0.879 | 1.117 | 0.830 | 0.946 | 1.164 | 1.800 | 5.083 | 0.789–1.546 | 1.062 | 0.084 | 0.041 | 0/0 |
| 16w/h32 | ordinary-repo | clear | 0.925 | 0.926 | 1.094 | 0.820 | 0.952 | 1.108 | 1.318 | 2.242 | 0.767–1.189 | 1.076 | 0.098 | 0.010 | 0/0 |
| 16w/h32 | ordinary-repo | status | 0.564 | 0.544 | 4.263 | 3.740 | 4.057 | 4.857 | 6.345 | 7.416 | 3.677–5.006 | 4.332 | 0.086 | 3.311 | 0/1 |
| 16w/h32 | ordinary-repo | registration | 0.282 | 0.290 | 0.335 | 0.273 | 0.289 | 0.316 | 0.370 | 0.392 | 0.275–0.315 | 0.466 | 0.037 | 0.010 | 0/0 |
| 16w/h32 | ordinary-repo | worker_status | 5.548 | 5.502 | 5.575 | 5.209 | 5.463 | 5.941 | 8.849 | 10.483 | 5.163–6.188 | 5.466 | 0.424 | 0.012 | 0/0 |
| 16w/h32 | ordinary-repo | worker_status_probe | 5.697 | 5.820 | 6.100 | 5.701 | 5.980 | 6.454 | 8.847 | 10.183 | 5.707–6.622 | 5.984 | 0.214 | 0.170 | 0/0 |
| 16w/h32 | ordinary-repo | worker_transmit | 1.635 | 1.640 | 1.976 | 1.617 | 1.756 | 2.027 | 2.238 | 2.603 | 1.628–2.110 | 1.905 | 0.096 | 0.084 | 0/0 |
| 16w/h32 | ordinary-repo | coordinator_send | 1.031 | 1.006 | 1.223 | 1.011 | 1.050 | 1.131 | 1.650 | 1.921 | 0.993–1.207 | 1.209 | 0.081 | 0.015 | 0/0 |
| 16w/h32 | ordinary-repo | message | 0.192 | 0.188 | 0.249 | 0.179 | 0.194 | 0.225 | 0.259 | 0.454 | 0.183–0.225 | 0.312 | 0.040 | 0.020 | 0/0 |
| 16w/h32 | ordinary-repo | sequential_load | 1.314 | 1.304 | 4.850 | 4.451 | 4.594 | 5.249 | 8.193 | 9.566 | 4.511–6.709 | 4.821 | 0.077 | 3.253 | 0/1 |
| 16w/h32 | ordinary-repo | overlap | 2.049 | 1.964 | 7.761 | 7.262 | 7.490 | 8.755 | 11.901 | 14.199 | 7.322–11.219 | 7.731 | 0.196 | 5.411 | 0/2 |
| 16w/h32 | declared | list | 0.232 | 0.220 | 7.164 | 3.615 | 3.678 | 3.759 | 5.476 | 5.768 | 3.629–3.757 | 3.683 | 0.051 | 3.481 | 2/0 |
| 16w/h32 | declared | report | 0.926 | 0.935 | 49.622 | 11.363 | 11.561 | 11.852 | 13.914 | 14.683 | 11.435–11.735 | 11.770 | 0.092 | 10.635 | 6/0 |
| 16w/h32 | declared | clear | 0.935 | 0.933 | 50.153 | 11.478 | 11.624 | 11.984 | 13.622 | 16.264 | 11.573–11.936 | 11.807 | 0.111 | 10.724 | 6/0 |
| 16w/h32 | declared | status | 0.566 | 0.585 | 37.249 | 15.622 | 15.813 | 16.414 | 18.165 | 20.329 | 15.678–16.786 | 16.124 | 0.081 | 15.240 | 6/2 |
| 16w/h32 | declared | registration | 0.331 | 0.338 | 14.438 | 10.659 | 10.967 | 11.216 | 14.162 | 15.136 | 10.714–11.830 | 11.260 | 0.064 | 10.587 | 6/0 |
| 16w/h32 | declared | worker_status | 5.225 | 5.239 | 16.366 | 12.320 | 12.676 | 13.136 | 14.169 | 18.475 | 12.439–13.193 | 12.680 | 0.211 | 7.271 | 4/0 |
| 16w/h32 | declared | worker_status_probe | 5.852 | 5.766 | 20.667 | 16.806 | 17.343 | 17.887 | 19.845 | 22.496 | 16.868–17.869 | 17.348 | 0.345 | 11.267 | 6/0 |
| 16w/h32 | declared | worker_transmit | 1.814 | 1.885 | 51.912 | 12.716 | 12.999 | 13.825 | 16.156 | 18.656 | 12.779–14.483 | 13.179 | 0.266 | 11.284 | 6/0 |
| 16w/h32 | declared | coordinator_send | 1.024 | 1.060 | 15.863 | 8.349 | 8.541 | 8.726 | 9.955 | 12.405 | 8.505–8.676 | 8.685 | 0.101 | 7.465 | 4/0 |
| 16w/h32 | declared | message | 0.218 | 0.224 | 7.338 | 7.219 | 7.268 | 7.408 | 8.347 | 9.729 | 7.258–7.341 | 7.489 | 0.032 | 7.067 | 4/0 |
| 16w/h32 | declared | sequential_load | 1.385 | 1.412 | 88.580 | 27.471 | 27.783 | 28.666 | 32.028 | 35.103 | 27.735–28.988 | 28.139 | 0.166 | 26.636 | 12/2 |
| 16w/h32 | declared | overlap | 2.190 | 2.211 | 183.117 | 53.697 | 56.846 | 62.254 | 74.311 | 79.268 | 53.914–62.975 | 57.272 | 0.265 | 54.722 | 24/4 |
| 16w/h32 | adopted | list | 0.256 | 0.232 | 14.567 | 7.270 | 7.462 | 7.998 | 10.123 | 15.755 | 7.270–7.963 | 7.468 | 0.066 | 7.212 | 4/0 |
| 16w/h32 | adopted | report | 0.999 | 1.007 | 101.914 | 22.317 | 22.758 | 25.566 | 31.803 | 35.667 | 22.360–29.629 | 22.953 | 0.168 | 23.591 | 12/0 |
| 16w/h32 | adopted | clear | 0.952 | 0.950 | 99.747 | 22.026 | 22.385 | 22.722 | 25.031 | 26.652 | 22.110–22.599 | 22.594 | 0.132 | 21.421 | 12/0 |
| 16w/h32 | adopted | status | 0.606 | 0.589 | 72.966 | 29.680 | 30.105 | 31.383 | 34.013 | 34.992 | 29.680–32.957 | 30.542 | 0.111 | 29.529 | 12/4 |
| 16w/h32 | adopted | registration | 0.348 | 0.359 | 28.815 | 21.454 | 21.730 | 22.100 | 25.689 | 28.457 | 21.530–22.068 | 22.043 | 0.060 | 21.326 | 12/0 |
| 16w/h32 | adopted | worker_status | 5.388 | 5.414 | 27.203 | 19.713 | 20.241 | 20.766 | 23.221 | 25.082 | 20.079–22.058 | 20.246 | 0.279 | 14.844 | 8/0 |
| 16w/h32 | adopted | worker_status_probe | 5.930 | 5.969 | 35.553 | 27.866 | 28.285 | 28.799 | 31.787 | 34.597 | 27.966–28.471 | 28.290 | 0.410 | 22.326 | 12/0 |
| 16w/h32 | adopted | worker_transmit | 1.903 | 1.933 | 103.515 | 23.651 | 24.070 | 25.227 | 26.903 | 30.942 | 23.863–24.667 | 24.244 | 0.257 | 22.183 | 12/0 |
| 16w/h32 | adopted | coordinator_send | 1.085 | 1.077 | 30.878 | 15.846 | 16.072 | 16.964 | 19.022 | 26.617 | 15.915–16.286 | 16.224 | 0.103 | 15.014 | 8/0 |
| 16w/h32 | adopted | message | 0.243 | 0.238 | 14.831 | 14.560 | 14.790 | 15.641 | 16.984 | 19.258 | 14.492–15.824 | 14.984 | 0.047 | 14.451 | 8/0 |
| 16w/h32 | adopted | sequential_load | 1.448 | 1.476 | 181.029 | 53.598 | 55.057 | 58.815 | 68.822 | 76.128 | 53.598–59.103 | 55.423 | 0.166 | 55.150 | 24/4 |
| 16w/h32 | adopted | overlap | 2.173 | 2.137 | 353.046 | 105.032 | 106.453 | 114.417 | 143.217 | 178.697 | 105.681–113.412 | 106.744 | 0.172 | 103.912 | 48/8 |
| 64w/h1024 | ordinary-nonrepo | list | 0.232 | 0.240 | 0.389 | 0.227 | 0.249 | 0.266 | 0.365 | 0.507 | 0.234–0.263 | 0.250 | 0.041 | 0.014 | 0/0 |
| 64w/h1024 | ordinary-nonrepo | report | 0.906 | 0.899 | 1.270 | 0.893 | 0.922 | 0.952 | 1.037 | 1.087 | 0.909–0.973 | 1.037 | 0.055 | 0.023 | 0/0 |
| 64w/h1024 | ordinary-nonrepo | clear | 0.861 | 0.867 | 1.233 | 0.869 | 0.896 | 0.948 | 1.115 | 1.249 | 0.877–0.925 | 1.007 | 0.049 | 0.038 | 0/0 |
| 64w/h1024 | ordinary-nonrepo | status | 0.683 | 0.678 | 3.478 | 1.437 | 1.488 | 1.601 | 1.944 | 3.741 | 1.463–1.513 | 1.718 | 0.057 | 0.771 | 0/0 |
| 64w/h1024 | ordinary-nonrepo | registration | 0.306 | 0.308 | 0.485 | 0.310 | 0.332 | 0.348 | 0.374 | 0.661 | 0.314–0.355 | 0.496 | 0.034 | 0.025 | 0/0 |
| 64w/h1024 | ordinary-nonrepo | worker_status | 12.192 | 12.274 | 12.570 | 12.193 | 12.429 | 12.602 | 12.923 | 13.910 | 12.376–12.644 | 12.432 | 0.374 | 0.199 | 0/0 |
| 64w/h1024 | ordinary-nonrepo | worker_status_probe | 12.821 | 12.866 | 13.297 | 12.745 | 13.030 | 13.491 | 14.963 | 15.649 | 12.748–13.231 | 13.033 | 0.379 | 0.076 | 0/0 |
| 64w/h1024 | ordinary-nonrepo | worker_transmit | 1.779 | 1.774 | 2.459 | 1.807 | 1.885 | 2.005 | 2.491 | 3.820 | 1.839–1.979 | 2.027 | 0.098 | 0.108 | 0/0 |
| 64w/h1024 | ordinary-nonrepo | coordinator_send | 1.139 | 1.120 | 1.592 | 1.121 | 1.166 | 1.221 | 1.604 | 1.659 | 1.129–1.190 | 1.307 | 0.079 | 0.037 | 0/0 |
| 64w/h1024 | ordinary-nonrepo | message | 0.233 | 0.238 | 0.381 | 0.214 | 0.248 | 0.282 | 0.333 | 0.390 | 0.227–0.274 | 0.360 | 0.044 | 0.042 | 0/0 |
| 64w/h1024 | ordinary-nonrepo | sequential_load | 1.508 | 1.509 | 4.659 | 2.224 | 2.347 | 2.411 | 3.090 | 3.237 | 2.304–2.405 | 2.599 | 0.114 | 0.801 | 0/0 |
| 64w/h1024 | ordinary-nonrepo | overlap | 2.357 | 2.344 | 7.643 | 3.258 | 3.314 | 3.445 | 4.205 | 4.265 | 3.249–3.464 | 3.643 | 0.126 | 0.984 | 0/0 |
| 64w/h1024 | ordinary-repo | list | 0.244 | 0.248 | 0.449 | 0.232 | 0.264 | 0.294 | 0.424 | 0.527 | 0.237–0.313 | 0.268 | 0.045 | 0.029 | 0/0 |
| 64w/h1024 | ordinary-repo | report | 0.915 | 0.896 | 1.298 | 0.887 | 0.922 | 1.023 | 1.128 | 1.494 | 0.870–1.059 | 1.040 | 0.054 | 0.018 | 0/0 |
| 64w/h1024 | ordinary-repo | clear | 0.880 | 0.883 | 1.264 | 0.867 | 0.916 | 1.085 | 1.526 | 2.081 | 0.864–1.253 | 1.024 | 0.061 | 0.026 | 0/0 |
| 64w/h1024 | ordinary-repo | status | 0.742 | 0.755 | 21.785 | 20.644 | 21.045 | 21.826 | 24.576 | 25.999 | 20.406–22.383 | 21.287 | 0.100 | 20.133 | 0/1 |
| 64w/h1024 | ordinary-repo | registration | 0.334 | 0.334 | 0.514 | 0.319 | 0.351 | 0.383 | 0.454 | 0.961 | 0.323–0.375 | 0.540 | 0.035 | 0.013 | 0/0 |
| 64w/h1024 | ordinary-repo | worker_status | 12.288 | 12.401 | 12.718 | 12.178 | 12.528 | 12.971 | 16.054 | 18.968 | 12.097–13.089 | 12.532 | 0.344 | 0.101 | 0/0 |
| 64w/h1024 | ordinary-repo | worker_status_probe | 12.875 | 12.717 | 13.061 | 12.743 | 12.920 | 13.214 | 13.945 | 17.717 | 12.703–13.467 | 12.924 | 0.308 | 0.218 | 0/0 |
| 64w/h1024 | ordinary-repo | worker_transmit | 1.747 | 1.731 | 2.389 | 1.765 | 1.815 | 1.866 | 1.998 | 2.566 | 1.791–1.859 | 1.959 | 0.050 | 0.078 | 0/0 |
| 64w/h1024 | ordinary-repo | coordinator_send | 1.151 | 1.178 | 1.752 | 1.122 | 1.195 | 1.332 | 1.951 | 2.550 | 1.160–1.311 | 1.333 | 0.070 | 0.011 | 0/0 |
| 64w/h1024 | ordinary-repo | message | 0.241 | 0.245 | 0.389 | 0.216 | 0.245 | 0.279 | 0.354 | 0.455 | 0.226–0.279 | 0.362 | 0.041 | -0.002 | 0/0 |
| 64w/h1024 | ordinary-repo | sequential_load | 1.567 | 1.585 | 22.889 | 21.729 | 21.980 | 22.593 | 23.644 | 24.916 | 21.773–23.129 | 22.295 | 0.150 | 20.504 | 0/1 |
| 64w/h1024 | ordinary-repo | overlap | 2.548 | 2.467 | 44.078 | 41.757 | 42.793 | 44.805 | 49.814 | 56.007 | 41.408–47.247 | 43.029 | 0.219 | 40.930 | 0/2 |
| 64w/h1024 | declared | list | 0.272 | 0.277 | 7.819 | 3.899 | 3.981 | 4.074 | 4.442 | 4.997 | 3.932–4.033 | 3.985 | 0.049 | 3.695 | 2/0 |
| 64w/h1024 | declared | report | 1.029 | 1.058 | 53.956 | 12.184 | 12.377 | 12.828 | 15.637 | 18.296 | 12.212–13.370 | 12.623 | 0.124 | 11.380 | 6/0 |
| 64w/h1024 | declared | clear | 1.032 | 1.049 | 53.838 | 12.191 | 12.659 | 13.238 | 16.527 | 18.926 | 11.961–13.283 | 12.842 | 0.117 | 11.666 | 6/0 |
| 64w/h1024 | declared | status | 0.765 | 0.769 | 39.996 | 16.914 | 17.352 | 18.600 | 22.602 | 23.672 | 16.897–19.457 | 17.704 | 0.083 | 16.850 | 6/2 |
| 64w/h1024 | declared | registration | 0.417 | 0.415 | 16.796 | 11.833 | 12.741 | 13.882 | 16.610 | 17.996 | 11.807–14.241 | 13.023 | 0.050 | 12.671 | 6/0 |
| 64w/h1024 | declared | worker_status | 12.479 | 12.666 | 25.097 | 20.342 | 20.854 | 22.178 | 32.209 | 34.392 | 20.582–25.438 | 20.859 | 0.462 | 8.392 | 4/0 |
| 64w/h1024 | declared | worker_status_probe | 13.051 | 12.922 | 29.777 | 24.718 | 25.348 | 25.965 | 28.822 | 30.139 | 24.866–25.581 | 25.352 | 0.493 | 12.024 | 6/0 |
| 64w/h1024 | declared | worker_transmit | 2.018 | 2.050 | 56.728 | 13.804 | 14.177 | 14.993 | 17.306 | 20.997 | 13.816–15.099 | 14.349 | 0.235 | 12.281 | 6/0 |
| 64w/h1024 | declared | coordinator_send | 1.171 | 1.176 | 17.489 | 9.113 | 9.511 | 10.565 | 13.030 | 14.232 | 9.064–11.830 | 9.712 | 0.082 | 8.402 | 4/0 |
| 64w/h1024 | declared | message | 0.273 | 0.270 | 8.101 | 7.877 | 8.083 | 8.701 | 9.676 | 10.484 | 7.895–9.410 | 8.382 | 0.048 | 7.743 | 4/0 |
| 64w/h1024 | declared | sequential_load | 1.625 | 1.621 | 95.015 | 29.468 | 30.078 | 31.598 | 34.752 | 37.681 | 29.522–31.598 | 30.394 | 0.220 | 28.754 | 12/2 |
| 64w/h1024 | declared | overlap | 2.592 | 2.563 | 190.703 | 58.478 | 60.047 | 64.942 | 77.258 | 95.139 | 58.478–65.267 | 60.377 | 0.271 | 57.151 | 24/4 |
| 64w/h1024 | adopted | list | 0.277 | 0.282 | 16.262 | 8.180 | 8.269 | 8.626 | 10.677 | 11.129 | 8.181–9.173 | 8.275 | 0.050 | 8.026 | 4/0 |
| 64w/h1024 | adopted | report | 1.046 | 1.092 | 114.975 | 24.975 | 25.405 | 27.031 | 30.498 | 31.600 | 25.234–27.159 | 25.716 | 0.157 | 24.448 | 12/0 |
| 64w/h1024 | adopted | clear | 1.063 | 1.082 | 113.703 | 24.933 | 25.450 | 27.089 | 31.326 | 32.243 | 24.883–26.794 | 25.746 | 0.135 | 24.852 | 12/0 |
| 64w/h1024 | adopted | status | 0.778 | 0.759 | 83.450 | 34.020 | 34.604 | 36.218 | 42.706 | 52.780 | 34.365–39.775 | 35.010 | 0.107 | 33.653 | 12/4 |
| 64w/h1024 | adopted | registration | 0.385 | 0.402 | 32.632 | 24.311 | 24.675 | 25.425 | 27.751 | 32.735 | 24.462–25.364 | 25.022 | 0.075 | 24.401 | 12/0 |
| 64w/h1024 | adopted | worker_status | 12.812 | 12.751 | 38.985 | 29.691 | 30.242 | 31.423 | 36.242 | 37.874 | 29.874–31.400 | 30.248 | 0.401 | 17.859 | 8/0 |
| 64w/h1024 | adopted | worker_status_probe | 13.383 | 13.292 | 47.162 | 38.059 | 39.452 | 41.177 | 46.586 | 52.274 | 38.059–41.177 | 39.457 | 0.614 | 26.113 | 12/0 |
| 64w/h1024 | adopted | worker_transmit | 2.070 | 2.103 | 117.139 | 26.906 | 27.563 | 29.610 | 33.708 | 38.585 | 27.115–28.669 | 27.834 | 0.314 | 26.105 | 12/0 |
| 64w/h1024 | adopted | coordinator_send | 1.193 | 1.230 | 36.016 | 17.853 | 18.695 | 21.547 | 28.370 | 34.046 | 17.857–24.113 | 18.856 | 0.142 | 17.222 | 8/0 |
| 64w/h1024 | adopted | message | 0.283 | 0.282 | 16.485 | 16.266 | 16.605 | 17.211 | 19.461 | 20.307 | 16.311–16.875 | 16.915 | 0.046 | 16.475 | 8/0 |
| 64w/h1024 | adopted | sequential_load | 1.665 | 1.624 | 198.702 | 59.580 | 60.465 | 62.396 | 68.240 | 72.284 | 59.596–61.169 | 60.796 | 0.232 | 58.934 | 24/4 |
| 64w/h1024 | adopted | overlap | 2.569 | 2.498 | 401.514 | 119.118 | 120.758 | 125.290 | 152.173 | 178.531 | 119.886–125.032 | 121.079 | 0.184 | 119.162 | 48/8 |

Noop-observer rows, per-sample heartbeats, guard spans, and baseline p95 values are in the warm gzip
records. Each raw sample's columns, also named in the file metadata, are `callMs`, `endToEndMs`,
`syncGitCount`, `syncGitMs`, `asyncGitCount`, `asyncGitMs`, `maxSyncGitSpanMs`, `heartbeatP95Ms`,
`heartbeatMaxMs`, `refusal`, and `maxSyncGuardSpanMs`.

### Raw records and reproduction

The gzip members were written with Python `gzip.GzipFile`, an empty original filename, and mtime 0.
SHA-256 is of the committed gzip bytes. The superseded partial `adoption-d9-intermediate.jsonl.gz`
and the earlier pre-correlation `adoption-d9-alternatives.jsonl` are not retained.


| File | Bytes | SHA-256 | Metadata head |
|---|---:|---|---|
| `tests/fixtures/adoption-d9-warm-2.jsonl.gz` | 1246160 | `28ad8b75ff5c6ef061caf29fdb7474a83b1ee7f4df4488b411fdb138682a0051` | `7778d4f605855b06cea35a11deef789b073c11da` |
| `tests/fixtures/adoption-d9-warm-16.jsonl.gz` | 1295903 | `defc37e3ad2ccf3c1542e1b580594eb2801d34dfb788ad13dc164c32a3f50b69` | `7778d4f605855b06cea35a11deef789b073c11da` |
| `tests/fixtures/adoption-d9-warm-64.jsonl.gz` | 1541861 | `86eb3ee9a2e025ca144624b8166b31a1aea7cab41000720982630d70cdfeac8a` | `7778d4f605855b06cea35a11deef789b073c11da` |
| `tests/fixtures/adoption-d9-cold-list.jsonl.gz` | 8844 | `34c8df55ab3b6b79f66ccb30ca41fd489ec8953e70ba5f829201952fd6c7ccfb` | `7778d4f605855b06cea35a11deef789b073c11da` |
| `tests/fixtures/adoption-d9-cold-status.jsonl.gz` | 9066 | `5f517e06abd7dcf6bc9e13874ba2c90fec0e4e7f7f14281489cc4b4ea080fcea` | `7778d4f605855b06cea35a11deef789b073c11da` |
| `tests/fixtures/adoption-d9-cold-worker-status-probe.jsonl.gz` | 8915 | `27aaaaf719d03169fca80ae99ebd1d3e6b7bc043a46401437817d94b9f3f3828` | `7778d4f605855b06cea35a11deef789b073c11da` |
| `tests/fixtures/adoption-d9-cold-overlap.jsonl.gz` | 9245 | `f6c68cb5bfff53ec4d1c383efef96994c85379025853499093fb8e3c8ba97d02` | `7778d4f605855b06cea35a11deef789b073c11da` |
| `tests/fixtures/adoption-d9-focused.jsonl.gz` | 464302 | `c6bd9677e5d6d52068bd6bca4f6cc583411c1bfa92ba91f755202ea5ccc63728` | `7778d4f605855b06cea35a11deef789b073c11da` |
| `tests/fixtures/adoption-d9-churn.jsonl.gz` | 149950 | `b4ae7814478768eba0546324ce86783f916260b45ae774602cbd7674f89f6429` | `7778d4f605855b06cea35a11deef789b073c11da` |
| `tests/fixtures/adoption-d9-refusal-missing.jsonl.gz` | 33382 | `1e18ef0faadc7e34e1aaa496c9212bcce3446bd9bb20346e7b4128f5021e6885` | `7778d4f605855b06cea35a11deef789b073c11da` |
| `tests/fixtures/adoption-d9-refusal-newer.jsonl.gz` | 33734 | `a1082e5a75969318458ddcb61590734b2884d3c984bbbec35dbe8f93ac8f1ec4` | `7778d4f605855b06cea35a11deef789b073c11da` |
| `tests/fixtures/adoption-d9-recovery.jsonl.gz` | 6061 | `2d01e998fe0dfd2d9a6130ef0181a506f2ab6efc5b45f3cdaf912820618ad47f` | `7778d4f605855b06cea35a11deef789b073c11da` |
| `tests/fixtures/adoption-d9-handoff-counts.jsonl.gz` | 7410 | `72eb85035415b039c539fc8b01b28c32f809bffb2483996e34641f2800ef1c98` | `7778d4f605855b06cea35a11deef789b073c11da` |
| `tests/fixtures/adoption-d9-handoff-before.jsonl.gz` | 7320 | `cfdc5d3ee2a32914cde89c7cde3ca0b13fd40a48205f79b4107ad26ee09f8a8a` | `null` |
| `tests/fixtures/adoption-d9-alternatives.jsonl.gz` | 23077 | `704dbb1d3242c292d86e8fb6158a59719ff4040788ef84a3d7edf6d673d886fd` | `7778d4f605855b06cea35a11deef789b073c11da` |

Reproduce from the measured commit with disposable archives of those two SHAs, including their
committed dist and isolated dependencies. The parent checks the dist bytes. Do not rebuild while a
child is importing dist. Run one parent at a time.

```sh
env -u PI_ROLE_DIR -u PI_INTERCOM_WORKER_ROLE node tests/adoption-differential.mjs \
  --baseline <e5b817a-archive> --original <f04c1f4-archive> \
  --output <warm-2.jsonl> --workers 2 --runs 5 --samples 12 --warmup 2
```

Repeat with `--workers 16` and `--workers 64`. Cold controls add `--cold-only true`, `--samples 0`,
`--warmup 0`, `--observer default`, `--modes ordinary-nonrepo,adopted`, `--workers 2,64`, and
`--operations` set to one of `list`, `status`, `worker_status_probe`, or `overlap`. Focused uses
`--workers 64`, `--observer default`, `--modes adopted`, `--operations status,overlap`,
`--samples 100`, `--warmup 5`, and `--runs 5`. Churn adds `--churn true` at workers 64 for modes
`ordinary-repo,adopted` and operations `list,status,overlap`, with samples 12. Refusal adds
`--damage missing` or `--damage newer` at workers 2, adopted, samples 2, warmup 0. Recovery adds
`--recovery true`, `--operations none`, `--samples 0`, `--warmup 0`, and `--workers 2,64`. Handoff
counts add `--handoff-counts true` with that empty operation list at workers 2. Alternatives add
`--alternatives true`, `--operations none`, `--samples 100`, `--warmup 5`, `--workers 2`, and
`--modes ordinary-nonrepo,adopted`.

### Limits this record leaves in place

The ordinary status gap, the history-sensitive ordinary-repository query, and the adopted list,
report, status, and overlap gaps remain larger than their A/A bands. Human acceptance of that
mismatch is open. The reduced 12-sample matrix, the safety cost of the proof, and the lower time
versus f04c1f4 do not close it.

Legacy absence is local to one continuously held ordinary update. A presence or config-byte check
cannot see an external add, commit, and delete that bypasses the lock during that update. That limit
is presence-check insufficiency. The next update on the same store, including a separate update
under a reentrant outer transaction, rediscovers and fences. There is no store, runtime, or request
cache of an absent claim, and no background scan when another update never arrives. Established
tenure still takes a fresh full proof before each final rename. The suite covers the next-update
fence, cooperating-writer exclusion through the held lock, and discovery after repository or Git-context appearance. It does not add a same-invocation final absence helper.

Relevant and indexed Git environment names are case-folded only when `process.platform` is `win32`.
POSIX comparisons stay case-sensitive, and values are unchanged. The win32 cases in the suite
override `process.platform` on Linux. They are simulated. Native Windows execution of this
differential was not performed. Repository CI is a separate pull-request workflow on `windows-latest` and `ubuntu-latest` (`npm ci`, typecheck, `npm test`, and `check:package`). An empty check
rollup is not a green result. This local differential is Linux only.

Local validation of the measured commit, before this evidence text existed: `npm test` 584/584 pass
and 0 skipped; `npm run typecheck` pass; `npm run check:package` 1/1 pass; `PI_ADOPTION_HOST_ROOT`
pointed at public `@earendil-works/pi-coding-agent` 1.2.0 and `npm run test:adoption-host` 1/1 pass.
Those commands do not include this timing matrix. The host check loads the packed source through
that Pi 1.2.0 loader. It does not start a session, model, worker, or live board.
