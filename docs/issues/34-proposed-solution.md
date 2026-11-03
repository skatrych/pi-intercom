# #34 — Proposed Solution

## Executive Summary

Add a **shell-launched standalone worker adapter** so a Pi coordinator can delegate
bounded work to Cursor Agent CLI and receive ordinary stored Intercom reports. Cursor
is required; agy uses a separate experimental codec and remains explicitly unverified
without an authenticated run. No new coordinator tools, config fields or wire kinds.

The shell launches the adapter in the assigned directory, pointing explicitly to an
existing board. It registers anonymously; the coordinator separately configures and
reloads it, then sends instructions normally. The adapter runs one headless CLI turn
at a time and reports the CLI's public result or a bounded error. Later instructions
reuse the CLI conversation, including after a deliberate adapter restart.

This is a proposal, not implemented functionality or authority to implement. It needs
independent review of the delivered SHA, then human design approval and a separate
implementation assignment. Lasting choices: [ADR 0034](../adr/0034-shell-cli-workers.md).
Exact work/test inventory: [implementation plan](34-implementation-plan.md).

## Details

### Authority and source basis

Scope is the current [issue body](https://github.com/skatrych/pi-intercom/issues/34),
SHA-256 `6d6402ee3f644c53b18acf4a9240ea2fc34b4a2f27e1fc017310445c0807cca4`,
[approved requirements](https://github.com/skatrych/pi-intercom/issues/34#issuecomment-6422638099)
and [routing](https://github.com/skatrych/pi-intercom/issues/34#issuecomment-6422655000).
Restart continuity is explicitly required by scope; same-process follow-ups alone do
not satisfy it. Source inspection: `main@4dc11b34d9a2c01be3780445ea41ffc3b91b0890`.

At that base, `src/transport.ts` already provides version-1 loopback HTTP, recipient
identity envelopes, health, bounded bodies and five-second receipts. `src/config.ts`
provides read/root/directory validation. `src/runtime.ts:handleReceive`, `reload`,
`report` and `tool('report_work')` establish worker permission/report contracts.
Coordinator `report` handling already saves with `src/reports.ts` before notification.
The adapter reuses those libraries/contracts without loading a Pi runtime. Its only
shared-config writes occur indirectly through existing coordinator operations.

### User-visible workflow (proposed syntax)

```sh
# Operator shell; board already exists, cwd is board root or a descendant.
cd /absolute/assigned/workspace
pi-intercom-worker --root /absolute/board --backend cursor
# Prints its own worker session ID and bound port; no credentials/output dump.
```

1. Adapter registers `{port, projectDirectory}` using its own stable worker ID.
   Registration reaches the coordinator conversation but creates no roster entry.
2. Coordinator supplies that ID, port, root-relative directory, name and responsibility
   to existing `intercom_configure_worker`; then separately `intercom_reload_worker`.
   CLI backend is not a Pi `role`; do not configure a role for this worker.
3. `intercom_send` triggers a CLI turn; `report` arrives independently and is stored
   by the coordinator. The adapter stays alive and waits after reporting.
4. A later instruction resumes the exact saved CLI conversation. Busy arrivals are
   FIFO next-turn input, not an interrupt of an executing tool.
5. After an operator verifies the old adapter and relevant CLI process have ended:

   ```sh
   # Same board, cwd, CLI history/auth context and machine-local state.
   pi-intercom-worker --root /absolute/board --backend cursor \
     --resume cli-cursor-<saved-uuid> --confirm-closed
   ```

   Configured startup restores responsibility, binds the saved port or reports a
   fallback actual port through `status`, and waits. It does not resume old work;
   the next explicit instruction resumes the saved conversation.

### Component boundaries and state

The executable owns parsing/signals. A worker service owns registration, the receiver,
passive responsibility, FIFO and report submission. A subprocess runner owns bounded
stdio/deadlines. Backend codecs own exact argv and final-envelope parsing. A local
state store owns only stable worker identity, backend/board/cwd bindings, conversation
ID and an interruption marker; the backend owns actual conversation history.

State lives in ignored `.pi-intercom/cli-workers/<worker-id>/`, not config or a new
board. It contains no prompts, queued work, result text or credentials. A per-worker
exclusive ownership directory refuses duplicates and is never stolen by PID/age.
Abrupt death can leave it behind: inspect processes first, then explicitly authorize
maintenance. Clean restarts retain both identities. Missing history, wrong backend,
changed cwd/root, corrupt state or mismatched returned conversation IDs fail closed;
there is no new-session fallback under the old worker identity.

### Compatibility and limitations

The adapter implements recipient/configured-sender/loaded-responsibility checks,
coordinator-only controls, independent status and side-effect-free health. It sends
only existing registration/status/report shapes. Local processes remain trusted;
loopback role checks are not authentication or a filesystem sandbox. CLI execution
has the launching user's native permissions. No automatic permission bypass flags,
login, credential discovery or authentication transport are added.

Reports distinguish CLI success from independent acceptance. A successful process
exit is insufficient without a valid terminal result and public report. On timeout,
shutdown or CLI failure the adapter attempts one `blocked` report. Abrupt adapter
crash, uncatchable termination, unavailable coordinator or failed persistence cannot
guarantee that report; endpoint loss is not proof that all descendants stopped.

`intercom_create_worker` and `intercom_resume_worker` remain Pi-only. Non-Pi workers
must not be targeted with those launch/resume tools or `intercom_close_worker`;
unsupported handoff/control requests are rejected without side effects. Existing Pi
Linux Herdr handoff/pane-close and the disabled graceful-cancellation contract remain
unchanged. Windows validation, authenticated agy and other CLIs are outside this issue.

### Evidence and remaining gates

Public vendor references were read for feasibility, not installed-version evidence:
[Cursor parameters](https://cursor.com/docs/cli/reference/parameters),
[headless](https://cursor.com/docs/cli/headless),
[output format](https://cursor.com/docs/cli/reference/output-format);
[agy reference](https://antigravity.google/docs/cli/reference/) and
[headless](https://antigravity.google/docs/cli/headless/).
Current Cursor docs sometimes name `agent`, while the issue names `cursor-agent`:
select an explicit executable, never silently switch. The implementation must record
an actually tested version and confirm its exact documented command/output contract.
No authenticated CLI, installed configuration/credentials or live board was inspected.

Automated fake-CLI tests and a separately authorized recorded real Cursor/live-Pi smoke
are both required. The smoke must demonstrate a later turn **after adapter restart**,
not merely a second turn in one process. No tests, launches or smoke were performed
for this docs-only delivery. Author runtime: `openai-codex/gpt-6.1-sol`; repository
baseline is known, installed-config state is unknown and was not read. Concurrent
#25 planning is not implemented source and is not a dependency added to #34.
