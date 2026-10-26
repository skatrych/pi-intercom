# #34 — Implementation Plan

## Status and authority

Docs-only proposal on `main@4dc11b34d9a2c01be3780445ea41ffc3b91b0890`.
Implement only after independent exact-SHA design/write-surface review, human design
approval and a separate implementation assignment. See [solution](34-proposed-solution.md)
and [ADR 0034](../adr/0034-shell-cli-workers.md) for approved-body identity and scope.
Recheck source locators against the eventual implementation base; do not assume #25's
proposed adoption/locking changes have landed. No new native dependency is needed.

## 1. Exact implementation write surface

This is the **future implementation** allowlist, not permission for this docs author
to change runtime. Developer may factor within these modules, not invent a second
component architecture or extend Pi tools/config. Return required extra paths or
contract changes for review before writing them.

| Path | Owned change |
|---|---|
| `src/cli-worker.ts` (new) | Executable entry: strict flags, startup, signal/error boundary, concise local diagnostics, service wiring; executable shebang |
| `src/cli-worker/worker.ts` (new) | Worker-only receiver, fresh-config authorization, passive responsibility, bounded FIFO, registration/status/report, observation and shutdown orchestration |
| `src/cli-worker/state.ts` (new) | Local identity/conversation mapping, strict path/schema checks, exclusive run ownership and atomic state replacement |
| `src/cli-worker/process.ts` (new) | Shell-free one-turn subprocess runner, bounded buffers/deadlines, direct-child cleanup and normalized errors |
| `src/cli-worker/backends.ts` (new) | Separate Cursor/agy argv and JSON codecs, normalized turn result, public-final-report parser; agy explicitly experimental/unverified |
| `package.json`, `package-lock.json` | Add bin `pi-intercom-worker: dist/cli-worker.js`; root lock metadata as required by npm; append new credential-free tests/package test to scripts. No dependency/version bump solely for this feature |
| `.gitignore` | Add `.pi-intercom/cli-workers/`; never ignore shared config |
| `README.md`, `references/cli-workers.md` (new) | Shell/restart/operator runbook, protocol differences, exact tested versions/evidence and limitations; add reference to package `files` |
| `tests/cli-worker.test.mjs` (new) | Worker receiver, FIFO, report, lifecycle/HTTP integration and Pi receiver parity |
| `tests/cli-worker-state.test.mjs` (new) | State/ownership/root/identity, interruption and restart tests |
| `tests/cli-worker-process.test.mjs` (new) | Backend codecs, public reports, argv/limits/timeouts/subprocess cleanup |
| `tests/fixtures/fake-agent-cli.mjs` (new) | Credential-free executable protocol fixture for both codec modes; fake history in isolated temp directory only |
| `tests/packaged-cli-worker.test.mjs` (new) | Tarball/bin import/help and fake-CLI launch with peers omitted, never real CLI/model execution |
| `dist/cli-worker.{js,js.map,d.ts}`, `dist/cli-worker/*.{js,js.map,d.ts}` (generated new) | Build the new entry/modules with existing TypeScript settings; do not hand-edit |
| These three #34 design documents | Only implementation-status/evidence corrections if needed; no unrelated historical ADR rewrite |

Read-only reusable libraries: `src/config.ts` (`ConfigStore.workspace/read/validateRoot`,
`directory`, validation helpers), `src/transport.ts` (`listen`, `send`, `envelope`,
`reportPayload`), `src/handoff.ts` (`HANDOFF_KINDS`, `fencedClose`) and
`src/observability.ts` (`LocalObserver`, fixed metadata). Import no Pi SDK/extension
entry or `Intercom` runtime. Do not alter `src/runtime.ts`, `src/index.ts`, launchers,
adoption, reports, monitor, shared schemas or existing Pi tests to make the adapter
work. Full-suite regressions must remain passing unchanged. CI workflows already run
the package scripts; no workflow/publish/install/role/runbook-repository edits here.

## 2. Executable and component contracts

Proposed interface:

```text
pi-intercom-worker --root ABSOLUTE_BOARD_ROOT --backend cursor|agy
  [--executable EXECUTABLE] [--turn-timeout-ms N]
  [--resume cli-BACKEND-UUID --confirm-closed]
```

- cwd is the assigned directory; root must be explicit and an existing canonical
  ancestor/equal root. Use `ConfigStore.workspace(cwd, root)` before listener, local
  state or telemetry creation. No upward search, Git-root inference, board initialization,
  coordinator promotion or fallback config. Pin root and canonical cwd for this run;
  revalidate before state access, message effects, spawn and outgoing sends.
- Unknown/duplicate flags, invalid enums, missing root, positional arguments and NUL/
  control-bearing arguments refuse. `--confirm-closed` is required with resume and is
  invalid without it. Timeout is a whole integer 1000–3600000 ms, default 300000 ms.
  No arbitrary backend-argument passthrough, callback port, responsibility or role flags.
- Defaults: `cursor-agent` / `agy`. `--executable` selects one trusted literal binary
  name or absolute path, not a shell fragment. No `agent` fallback, wrapper discovery,
  CLI installation, login or reading credential/config stores. `--help` imports neither
  a board nor a backend process. Select CLI permission policy outside Intercom; add
  no automatic `--force`, `--yolo` or approval-bypass flags.
- `WorkerService` has `start`, `receive`, `reportStatus`, `shutdown`; dependencies are
  store/transport, state, backend, process runner, observer and clock/spawn test seams.
  Owns endpoint, responsibility snapshot, active turn and volatile queue.
- `Backend` builds argv from `{conversationId?, prompt}` and decodes a completed
  `{exitCode, signal, stdout}` to `{conversationId, finalText}` or a fixed error class.
  Cursor and agy have different codecs, not a configurable field-name guesser.
- `runTurn` returns a bounded result/error only when the direct child has exited;
  reports timeout/output-limit independently of any eventual exit. No process stdout
  events are Intercom input. `StateStore` is the only local-state writer.

## 3. Identity, persistence and startup/restart

New worker ID: `cli-cursor-<randomUUID>` or `cli-agy-<randomUUID>`. Treat it as an
opaque version-1 `sessionId` within existing string limits. It is not a Pi session ID
or the provider conversation ID. No new wire/config fields. The prefix makes the
operator distinction visible, not authenticated and not a new Pi lifecycle dispatch
mechanism. Never use Pi `role` metadata to identify the backend.

Local layout (ignored, machine-local; private directory mode 0700/file mode 0600):

```text
<root>/.pi-intercom/cli-workers/<worker-id>/state.json
<root>/.pi-intercom/cli-workers/<worker-id>/running/owner.json
```

`state.json`, maximum 16 KiB, contains only:
`{version:1, workerSessionId, backend, boardRoot, cwd, conversationId:null|string,
phase:'idle'|'in_flight'|'uncertain'}`. Root/cwd are canonical local bindings, not
shared-config fields. No port duplication (config holds saved port), prompts, outputs,
queue, tokens, transcript, report draft, completion journal or authentication data.
Conversation ID: nonempty bounded single identifier, maximum 256 characters, reject
controls/whitespace and “latest”/negative aliases; pass as a single named argv value.
Provider owns its own history, outside Intercom. Require exact returned ID equality
when resuming; never replace a saved ID with a new conversation silently.

State access checks each directory/file is the expected regular non-link type beneath
the pinned root, checks bounded reads/schema/backend/ID/root/cwd equality, and refuses
corruption/aliases/escaping or changed paths. Exclusive temporary write → sync → close
→ atomic rename; recheck paths before publication and clean only owned unpublished
temps. Never repair corrupt state automatically or accept a caller-provided state path.
This is best-effort local filesystem safety, not hostile same-user TOCTOU protection
or a new power-loss durability guarantee.

A new worker allocates its directory exclusively and writes initial state before
registration. Resume requires the exact saved directory and `--confirm-closed` after
operator verification of the old adapter **and relevant CLI processes**, not inferred
from endpoint failure. An exclusive `mkdir running` ownership guard prevents cooperating
duplicate starts; owner metadata is local `{token,pid,startedAt}`, never credentials,
wire identity or proof of death. Release only the current token's guard after final
callbacks/state writes settle. Existing guard always refuses; no PID/age stealing,
automatic deletion, retry or second identity. After a crash, separately authorized
operator maintenance inspects the processes and removes only the established stale
owned guard. Never delete state/history to bypass a refusal.

Startup sequence:

1. Validate arguments/root/config, load/create local state, acquire run ownership;
   refuse any local ID configured as coordinator, backend/cwd mismatch or saved Pi role.
   If an existing worker entry's project directory differs from actual cwd, refuse.
2. Bind saved worker port if configured, otherwise OS-selected port, using existing
   `listen` and its occupied-port fallback. Expose matching health identity. Never
   start the CLI yet.
3. Existing configured worker: restore responsibility and send `status` with actual
   port/busy. Existing coordinator handles saved-port bookkeeping. New/anonymous worker:
   send `registration` with actual port and validated root-relative projectDirectory.
   Neither path writes config. On failed/uncertain send, print a fixed local diagnostic,
   remain reachable and do not retry. Explicit shell restart repeats startup; status is
   not registration and never creates an entry.
4. Reconcile any interrupted state as below, then open message admission and wait.
   Until startup settles, health/status/passive reload may work but messages refuse;
   no queued callback starts a CLI early. Configure/reload and startup never start a
   CLI turn. A configured restart needs no second configure unless its actual port
   cannot be recorded by the unavailable coordinator; reconcile before sending.

Clean completed turn: save validated conversation ID and `idle` **before** report.
Before each actual CLI spawn, persist `in_flight`; failure to persist prevents spawn.
If final revalidation refuses before any child starts, restore the previous idle state
without inventing a conversation; cleanup failure remains uncertain and prevents turns.
If the process exits on error and a prior exact ID is known, retain it; subsequent
explicit instructions may resume it, but never replay the failed instruction. If no
ID is known after an attempted first turn, mark `uncertain`: block further turns under
that worker ID rather than start an unrelated chat. A public-result parse error after
a valid terminal CLI envelope still retains its valid conversation ID.

On restart of `in_flight`/`uncertain` state, closure confirmation/ownership maintenance
is still required. If a saved conversation ID exists, attempt one fixed `blocked`
report for the interrupted work after restoring configured responsibility, mark idle
and wait for a **new** explicit instruction using that ID. If no ID exists, remain
uncertain/reachable and reject new work; diagnose that continuity cannot be established.
Operator may deliberately start a new worker identity and retire the old one through
normal lifecycle maintenance, not repair/reset the old mapping. No report/input replay,
report recovery promise or hidden history lookup is added.

## 4. Receiver and delivery contract

Use existing `listen`/`envelope` limits: 127.0.0.1 only; POST JSON <=64 KiB;
GET health returns only `{version:1,sessionId}` with no model/config/state writes.
At every receive: current lifecycle/root/config; exact `to` match before effects;
resolve `from` against **fresh config** (including coordinator adoption). Never trust
cached sender name, port, model text or inherited environment as authority.

| Kind | Admission/effect |
|---|---|
| `message` | Sender and self configured, self worker with loaded responsibility; reject active/uncertain close fence. Copy labelled sender/message into FIFO; reserve capacity synchronously before 202. No anonymous messaging |
| `reload` | Current configured coordinator sender only, worker recipient, configured self and no close fence. Replace responsibility/name snapshot and print safe configured display name; no turn, process restart, report clear or state reset |
| `request_status` | Current coordinator sender only, worker recipient; allowed anonymous. Accept, then independently send status; never put status in receipt or start a CLI |
| `registration`, `status`, `report` | Reject: these inbound kinds target a coordinator, which this process can never be |
| `stop`, legacy `close` | Check coordinator-only control authority, then reject unsupported without changing queue/child/endpoint |
| All `HANDOFF_KINDS` (`close_*`, `handoff_report`) | Worker-directed controls still require current coordinator sender; reject all kinds/directions unsupported, with no handoff/identity/pane/closure side effects |

A loaded responsibility is a remit, not an assignment. Name synchronization is only
this standalone process's display/log label; do not rename a Pi session, claim a Herdr
pane or invoke a terminal controller. Reload during an active turn affects subsequent
turn prompts, not the running CLI. Runtime removal/unconfiguration blocks new effects;
no conversion to coordinator or implicit re-registration/entry recreation occurs.

FIFO: one active child, at most 16 pending messages; full queue rejects before receipt.
Schedule execution outside the HTTP handler so CLI startup/reporting never delays the
five-second receipt. Recheck lifecycle/current configured sender/self, loaded remit,
cwd and close fence at dequeue and immediately before spawn, after async state writes.
Discard revoked items without launching; report a fixed blocked diagnostic if reporting
is still authorized. Queue includes no model-facing authority derived from observations.

`busy` is true while active/queued, persisting turn state or submitting its report;
otherwise false. Status is a snapshot, not completion. Best-effort status at startup
and busy/idle transitions uses the same function as `request_status`, plus minimal
`LocalObserver` runtime/transport/working/idle metadata. No heartbeat/watchdog turns,
raw stdout/tool event logging or invented thinking phases. Telemetry failure is nonfatal.

Document the deliberate non-Pi difference: busy messages become subsequent CLI turns,
not Pi-style live steering. No hard interrupt or cancellation. 202 remains receipt/
dispatch only; volatile pending input may be lost on crash. No retries, deduplication,
durable inbox, task IDs, automatic reassignment or stronger Pi delivery guarantees.

## 5. Backend invocation and reports

Public-doc feasibility references are linked in the solution; validate the selected
executable/version before claiming live support. Do not use interactive/latest resume.

| Backend | argv (one explicit instruction per invocation) | Successful terminal JSON |
|---|---|---|
| Cursor (required) | `--print --output-format json [--resume=<saved-id>] <wrapped-prompt>` | `type:'result', subtype:'success', is_error:false, session_id:<id>, result:<final-text>` |
| agy (experimental/unverified) | `--print --output-format json [--conversation=<saved-id>] <wrapped-prompt>` | `status:'SUCCESS', conversation_id:<id>, response:<final-text>` |

Require exit 0, no terminating signal, one complete JSON object (optional surrounding
whitespace), exact success fields, bounded valid ID and string final text. Ignore
unknown metadata fields, never treat embedded tool/event objects as final responses.
Nonzero exit may have no JSON; do not invent a Cursor error-envelope guarantee. agy
non-success statuses, including waiting/running, are not completed success. Do not
use persistent streaming stdin or conflate its schema with Cursor's.

Prompt composition: fixed adapter instructions, clearly delimited loaded responsibility,
labelled sender/explicit instruction, then this final-response contract:

```json
{"status":"ready_for_review","summary":"Public concise result and validation limits."}
```

Permit `ready_for_review`, `blocked`, `needs_decision` in that **final-text object**;
no automatic clear/tombstone. Require exactly `status`/`summary`, nonblank summary
<=2000 characters, compatible with `reportPayload` and stored-report control-character
rules. No Markdown extraction, regex scraping, truncation of arbitrary stdout or LLM
summarization fallback. Invalid/missing final report becomes a fixed `blocked` report.
The prompt prohibits secrets, raw tool payloads and private reasoning. This reduces
accidental disclosure; it cannot prove model-authored text is non-secret or correct.

Spawn directly with `shell:false`, cwd pinned; inherited operator environment is for
the native CLI alone, not inspected/logged/sent. No credentials in argv or Intercom
payloads. Native CLI may access tools/network under its own permissions; this adapter
is not a sandbox. Do not forward stdio to operator/HTTP/logs. Bound total stdout to
1 MiB and stderr to 64 KiB; decode only after exit. Fixed public error categories:
spawn failure, CLI failure, malformed terminal result, continuity mismatch, invalid
public report, output limit, turn timeout, interrupted/shutdown. Do not echo raw errors,
argv, prompt or stderr. Drop buffers after normalization/reporting.

Send report with existing `report` shape via `send` to the **fresh** coordinator entry,
checking configured worker identity/responsibility/root/lifecycle before dispatch.
The coordinator stores it via existing save-before-notify handling. Adapter never
writes `.pi-intercom/reports/` itself, claims storage without a receipt, or clears a
report at new-turn start. Saved report may outlive adapter/process restarts. If send
fails/times out, show a fixed local uncertain diagnostic, no resend/rollback or local
report queue; coordinator must inspect saved evidence before explicit recovery.

## 6. Error, timeout and process lifecycle

A CLI turn ending normally leaves the adapter/endpoint alive. CLI error with observed
direct-child exit sends blocked and waits, retaining known conversation mapping.
Independent status remains responsive during CLI work; coordinator loss does not stop
assigned work, close the endpoint or trigger recovery.

On deadline/output overflow: stop accepting additional work for that turn, attempt one
blocked report and send **one SIGTERM to the owned direct child** if still running.
No process-group kill, SIGKILL escalation, abort polling or assumption that tools stopped.
Allow a two-second direct-child exit observation window; if exit is observed, persist
appropriate mapping/phase and wait for new explicit work. If not, mark uncertain,
discard pending volatile input with one aggregate blocked shutdown summary, close the
adapter endpoint and exit nonzero. Report inability to establish child termination.

On operator SIGINT/SIGTERM or caught fatal adapter error: invalidate new admissions and
all queued start callbacks, discard volatile queue, mark an active turn uncertain,
attempt one blocked shutdown report (aggregate, not a report per queued message), and
send one direct-child SIGTERM if needed. Allow at most two seconds for child observation
and one existing five-second transport receipt budget; serialize state writes, close
listener/connections and bounded observer cleanup, then settle ownership release. Make
shutdown idempotent; late child/timer/report callbacks cannot start turns or emit later
ready reports. Never await a CLI forever. Unfinished OS I/O cannot be rolled back.

If the adapter cannot establish direct-child exit, leave its run guard for operator
inspection rather than permit a normal resume past the guard. SIGKILL/power loss cannot
run cleanup/reporting; OS listener closure is not an all-descendants termination proof.
An in-flight HTTP send may have unknown outcome. None of these paths implements
Intercom stop/close cancellation or non-Pi handoff. No auto-exit after a successful
assignment, and no automatic CLI/adapter replacement.

## 7. Credential-free validation matrix

Tests use isolated temporary board/state/history roots, test-only loopback coordinators
and a fake executable launched through Node. Fake CLI accepts both exact codecs,
records argv/cwd in the fixture only, maintains synthetic conversation history and
supports controlled delay/failure/malformed/large output/signal cases. Never read a
real HOME/config/auth store, execute vendor binaries, contact providers, use a live
board or launch Pi/Herdr. Child mocks alone do not establish subprocess/restart behavior.

| Requirement | Required evidence |
|---|---|
| AC1 shell start/registration | Real adapter subprocess + fake CLI; registration actual bound port/project directory/worker ID; roster remains unchanged until explicit configure |
| AC2 configure/reload/turn/report | Coordinator `Intercom` with mock host and real loopback HTTP; configure writes only, reload starts zero CLI processes, send returns before delayed fake turn completes; success/error/timeout/shutdown reports visible through existing saved-report reader/status API |
| AC3 same-process continuity | Second explicit instruction uses exact saved ID; fake history sentinel from first turn is available; returned different ID refuses, no fresh-chat fallback |
| Scope: restart continuity | First turn finishes; stop adapter cleanly, retain board/state/fake history; restart **a new OS process** with same worker ID, then send new instruction. Assert no startup turn, same registration identity/responsibility, exact resume argv, earlier sentinel answer and stored report. Repeat saved-port occupied fallback |
| AC4 common authorization parity | Run shared sender/recipient/responsibility/coordinator-control authorization cases against Pi runtime fixture and adapter. Anonymous reload before configure fails; anonymous status request works; wrong `to`, stale coordinator, removed sender/self and close fences refuse where required by the applicable kind. Compare common authorization, not backend-specific handoff effects |
| AC4 adapter-only unsupported controls | All `HANDOFF_KINDS` and `stop`/legacy `close` refuse even with otherwise valid coordinator authority; assert no queue, child, endpoint, handoff state, identity-send or pane/closure effects. Unauthorized controls also refuse without effects |
| AC5 unchanged Pi handoff/control behavior | Keep existing Pi regressions unchanged. Valid Pi handoff controls with matching job/provider prerequisites remain stateful: `close_prepare` establishes pending state and sends identity; matching `close_request` delivers the handoff request. Do not apply the adapter's unsupported-handoff oracle to Pi. Pi `stop`/legacy `close` remain disabled and side-effect free |
| AC4 health/status | Health is exact current ID/version and read-only; anonymous/configured status independent of model turns; busy true with pending work, false after settlement; current coordinator lookup after adoption; endpoint closes on normal shutdown, caught crash and hard adapter process kill |
| FIFO/bounds | Busy follow-ups serialized, at most one CLI process, no hard interruption; order and full-queue rejection; dequeue revocation/reload; body bounds/no duplicate execution in one admitted message (no cross-send dedup claim) |
| State safety | Modes, links/escape/root drift, corrupt/oversized/wrong backend/cwd/ID records, exclusive startup/guard ownership, no foreign cleanup, state publication failures before spawn, interrupted with/without ID; no prompt/output/credentials in state/config/logs |
| Subprocess/report safety | Spaces/quotes/metacharacters/unicode/leading-dash content preserved without shell execution; success envelope versus inner public report; stderr/nonzero/no JSON, wrong ID, output overflow, limits, fixed safe error reports; no public raw output, automatic clear or report resend |
| Races/lifecycle | Shutdown at dequeue/state-write/spawn/report; repeated signals; late child/timer callback; direct child ignoring SIGTERM leaves uncertainty/guard and closed endpoint; coordinator save/notification failure and receipt timeout do not cause resend; killed process leaves no listener, without claiming child-tree death |
| AC5/AC6 compatibility | Existing Pi tests unchanged/pass, version-1 legacy envelopes accepted, config byte/schema unchanged by worker, no runtime/launcher/tool changes; tarball bin/help plus fake turn works with Pi peers omitted |

Run later: `npm run typecheck`, `npm test`, `npm run check:package`, `git diff --check`.
Extend existing scripts with new tests; package test remains credential-free although
its normal isolated npm install may need registry access. Record actual counts/platform/
Node version and any missing gates; do not infer installed-host support from mocks.
Tests for this Linux-targeted adapter must not accidentally execute vendors on Windows;
Windows validation remains explicitly unclaimed, not a new issue acceptance gate.

## 8. Bounded operator real smoke (separate authorization required)

After credential-free gates and independent code review, obtain explicit operator
approval for a disposable board/workspace, already authenticated Cursor, live Pi
coordinator and at most **three read-only Cursor turns**, five-minute deadline each.
This docs assignment does not authorize that run or inspection of installed credentials.

1. Record implementation/package SHA, Node/OS, actual Cursor executable/version, loaded
   Pi/Intercom versions/source paths and selected test directory. Confirm CLI supports
   the exact flags/schema from §5 using non-authenticated version/help first. Operator
   handles credentials/trust outside the agent record; never print settings/env/auth.
2. Operator starts a live Pi coordinator on the disposable board, then the shell adapter.
   Record registration connection fields only. Configure and separately reload; confirm
   neither starts a CLI turn. Check health and independent requested status.
3. Send read-only turn 1: remember a harmless unique sentinel and report a bounded
   directory observation. Verify persisted ready report through worker-status, not
   only coordinator conversation text/HTTP receipt.
4. Send turn 2 asking for the sentinel without restating it; verify same CLI ID and
   stored public report. Exercise busy status during a turn if observable, without
   inserting an extra unbudgeted CLI prompt.
5. Operator ends the adapter normally, verifies relevant CLI/adapter processes ended,
   retains state/native history and restarts the same saved worker identity using the
   shell resume command. Verify no automatic turn. Send turn 3 asking for the sentinel
   without restating it; confirm same CLI ID, prior-context answer and stored report.
6. Operator closes disposable processes through the authorized manual mechanism. Check
   adapter endpoint closure; do not remove a registration as a substitute for closure.
   Keep only redacted public record, state-ID equality assertions and report evidence;
   no credentials/raw transcript/tool output. No production-board cleanup by this test.

Stop on wrong flags/schema, unexpected permission prompt, missing prior context,
identity drift, unresolved child exit, missing report or unknown delivery. Do not
blindly retry, switch binaries, expand permissions or replay work. Record failure and
route back. A real successful round trip verifies that path/version only, not Windows,
agy, crash durability, cancellation or all child descendants. Authenticated agy is
excluded; ship its documentation/codec labelled unverified regardless of fake tests.

## 9. Open decisions and delivery gate

Architecture is selected; unresolved **validation facts** are vendor-version compatibility,
Cursor's executable naming, exact native-history availability across restarts and
permission behavior. Operator chooses the approved installed executable/version,
disposable board and authentication context for the bounded smoke. They are not a
license for Developer to guess another protocol. If required Cursor cannot satisfy
exact-ID continuity with documented flags/output, return evidence/options for architecture/
human review before changing components or claiming AC6. agy absence does not block
Cursor delivery; its support remains explicitly experimental/unverified.

No current change to create/resume tools, capability config, non-Pi close/handoff,
stop cancellation, Windows acceptance or other CLIs is authorized. Document these as
out of scope, not unresolved prerequisites. Preserve Pi's existing semantics and receipt,
retry, approval and process-closure limits.

This delivery writes only `docs/adr/0034-shell-cli-workers.md`,
`docs/issues/34-proposed-solution.md` and this plan. Check links, docs-only stat and
`git diff --check`; commit only those paths. Handoff exact local SHA, clean worktree/
index, fixtures/submodules and evidence limits to Coordinator for push/draft PR and
mandatory independent design/write-surface review, then human gate. Do not create a
PR, install, launch, push or implement from this plan without another assignment.
Author runtime: `openai-codex/gpt-6.1-sol`; repository baseline known, installed config
unknown/unread. No runtime tests or real smoke were executed for this documentation.
