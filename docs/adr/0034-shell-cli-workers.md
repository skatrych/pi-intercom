# ADR 0034: Shell-launched CLI workers with local conversation mapping

## Decision Statement

Use a standalone, shell-launched Node worker to connect headless coding-agent CLIs
to the existing Intercom protocol, with private local mapping for exact conversation
resume across turns and worker restarts. Do not extend Pi host or lifecycle tools.

## Short Summary

A Pi coordinator needs to delegate work to non-Pi agents without changing Pi semantics.
The adapter reuses existing board, transport and report contracts, runs one CLI turn
at a time and reports explicit public results. Cursor is required; agy remains
experimental/unverified. Shell-only lifecycle and fail-closed conversation mapping
limit coupling and avoid implying unsupported cancellation or recovery guarantees.

## Details

1. **A standalone Node worker, not a Pi host shim.** A shell starts
   `pi-intercom-worker`; it reads an existing board, opens its own loopback endpoint,
   registers, passively loads configured responsibility, runs headless CLI turns and
   sends existing `report` envelopes. Reuse `config.ts`, `transport.ts` and metadata
   observation APIs; do not instantiate `Intercom`, expose Pi tools or copy the Pi
   host/adoption/handoff machinery. A small worker-only receiver has an explicit
   permission table and parity tests against Pi's receiver rules.
2. **No wire or shared-config extension.** Version 1 stays unchanged. An opaque
   `cli-<backend>-<uuid>` is this worker's stable envelope/config `sessionId`, not a
   Pi session or a new wire field. A private machine-local record maps it to the
   backend's exact conversation ID. CLI IDs, transcripts and authentication never
   enter shared config. Pi session identities/roles retain their existing meaning.
3. **One CLI process per turn; exact-ID resume.** Cursor is required. A separate
   experimental agy codec may ship labelled unverified. Successful first turns save
   the returned conversation ID before reporting; every later turn, including after
   a shell restart, explicitly supplies that ID. Never use “latest”, implicitly start
   over on resume failure, migrate histories or replay interrupted instructions.
4. **Serialized, bounded, volatile input.** Idle messages start work; busy messages
   wait FIFO for the next CLI turn, not in-process steering or hard interruption.
   Receipt acknowledges local dispatch only. Pending messages are lost on adapter
   crash; there is no durable inbox, deduplication, automatic retry or exactly-once
   claim. Pi's steering/receipt behavior is untouched.
5. **Public reports, not stdout forwarding.** The CLI's final answer must contain a
   bounded, explicit public report object. The adapter validates it and uses the
   existing coordinator save-before-notify path. Process/protocol failures produce
   fixed `blocked` summaries, never raw stderr, tool events or private reasoning.
   A report is worker-authored, not approval or independently verified completion.
6. **Shell lifecycle only.** Restart uses the adapter's saved ID after explicit old-
   process closure confirmation. The adapter never becomes coordinator or writes
   config. Reject non-Pi `close_*`, `stop` and legacy `close`; do not implement
   create/resume-tool dispatch, pane management, process-tree cancellation or
   automatic recovery. Local timeout/signal cleanup is bounded best effort for the
   adapter's own direct child, not an Intercom cancellation capability.

### Consequences and alternatives

The existing coordinator can configure, reload, send, request status, inspect health
and read stored reports without a new runtime discriminator. Restart needs retained
local mapping **and** the CLI's own history/auth context. A missing or uncertain
mapping refuses continuation rather than inventing continuity. Local ownership guards
reduce accidental duplicate adapter starts, not hostile same-user interference or
proof that escaped descendants stopped.

Rejected: running a fake Pi `Host` (unnecessary adoption/handoff coupling), changing
Pi's receiver or launcher now, sharing CLI transcripts in config, generic shell command
interpolation, and assuming all backends share Cursor's flags/output schema. Capability
negotiation and non-Pi lifecycle-tool integration remain separate decisions, not
prerequisites silently added to this issue.

Details and exact future write surface: [solution](../issues/34-proposed-solution.md)
and [implementation plan](../issues/34-implementation-plan.md).

Status: proposed, pending independent exact-SHA review and human design approval.
This ADR authorizes no implementation, installation, live-board changes or CLI execution.
