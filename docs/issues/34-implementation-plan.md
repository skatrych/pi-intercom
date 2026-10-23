# #34 — Implementation Plan

## Decision and scope

Implement the [Proposed Solution](34-proposed-solution.md) and
[ADR 0034](../adr/0034-non-pi-agent-bridge.md) as `packages/intercom-bridge`: private, Node ≥ 20,
no runtime dependencies. Root extension source, tools and wire semantics stay untouched. The only root
changes are the `test:bridge` script and a README section.

Status: **implemented in PR #33, awaiting independent review and human approval/merge**.
Issue: [#34](https://github.com/skatrych/pi-intercom/issues/34).

## Operational contract

- One bridge process per worker identity `<agent>-bridge-<uuid>`. It listens on an ephemeral loopback port and
  sends `registration` to the board coordinator.
- Only coordinator tools write the board config. The bridge reads it to load name and responsibility on `reload`.
- One CLI turn at a time per worker; the instruction queue is FIFO with a cap of 8. A turn ends as `ready_for_review`, or as
  `blocked` on error, timeout or shutdown.
- `spawn` returns only after the worker has started, or fails loudly with the log tail if the worker
  exits during startup (for example, no coordinator in the board config).
- CLI conversation IDs persist in bridge-local state, never in board config.

## 1. Wire, board and adapters

`wire.ts` (envelope, listen/send, limits), `board.ts` (read-only config, project check) and
`adapters.ts` (`cursor`, `agy` argv and NDJSON parsing; agy's observed auth-failure shape included).

## 2. Runner and bridge lifecycle

`runner.ts` (child per turn, timeout/abort, lingering-CLI stop after 2 s) and `bridge.ts` (receiver rules,
queue, result routing, long-result `message` + `report`, `status`/`request_status`, health, SIGTERM handling).

## 3. CLI and state

`cli.ts` (`run`, `spawn` with startup wait) and `state.ts` (session → conversation ID map, restart with `--session`).

## 4. Tests and validation

`npm run test:bridge` needs no credentials (13 tests). It uses a fake CLI (`tests/fixtures/fake-cli.mjs`) that emits
each CLI's documented NDJSON, with failure, long, lingering and hanging modes.
- `adapters.test.mjs`: argv mapping, NDJSON parsing, CLI flags, wire limits.
- `bridge.test.mjs`: pi-intercom's own coordinator runtime (`dist/runtime.js`, no LLM) over real loopback HTTP.
  It covers register → configure → reload → instruction → report, resume IDs, blocked/timeout/long results, status,
  receiver refusals, restart with the same session, SIGTERM of the real CLI process, and `spawn` success or startup failure.
  Every emitted envelope is checked against the extension's `envelope()` validator.

Real runs (logs in `packages/intercom-bridge/smoke/`, sanitized):
- `scripts/smoke.mjs`: two-prompt Cursor run with resume (`cursor-2026-10-23.log`).
- `scripts/live-pi-smoke.mjs`: a live **interactive Pi coordinator** with pi-intercom loaded, model
  `nvidia/nemotron-3-ultra-550b-a55b:free` via OpenRouter, driving one Cursor bridge worker end to end through
  `spawn` → registration → `intercom_configure_worker` → `intercom_reload_worker` → `intercom_send` → report
  received (`pi-coordinator-cursor-2026-10-23.log`, 7 LLM calls, 1 Cursor turn).

| Item | Status |
|---|---|
| Cursor flags and NDJSON (`session_id`, `type:"result"`, `--resume`) | Verified: docs, `--help`, real runs |
| Live Pi coordinator agent calling the intercom tools against a bridge worker | Verified: live run above |
| agy flags | Verified: docs and `agy --help` (1.4.6, Linux x64) |
| agy NDJSON success shape | **Unverified**: docs only, no authenticated run |
| agy lingering after its `result` event | Observed unauthenticated; the runner stops it after 2 s |
| Windows | **Unverified**: fake-CLI tests skip on win32 (POSIX shebang) |

## 5. Delivery, docs and review

Delivered on branch `feature/non-pi-agent-bridge` (PR #33, `Refs #34`). The root suite (579) and the bridge suite (13) pass.
Follow-ups, not in this change:
- an authenticated agy smoke run (`node scripts/smoke.mjs agy`);
- optionally, `intercom_resume_worker` relaunching bridge entries (needs a config field and a protocol/extension decision);
- a Windows CI leg with a `.cmd` fake CLI.
