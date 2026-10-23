# Non-pi agent bridge — Implementation Plan

## Decision and scope

Implement the [Proposed Solution](non-pi-agent-bridge-proposed-solution.md) as
`packages/intercom-bridge` (private, Node ≥ 20, no runtime dependencies). Root extension source,
tools and wire semantics stay untouched. The only root change is the `test:bridge` script.

## Delivered

1. `wire`, `board`, `adapters`, `runner`, `state`, `bridge` and `cli` modules (see Proposed Solution).
2. A fake CLI fixture (`tests/fixtures/fake-cli.mjs`) that emits each CLI's documented NDJSON, with failure,
   long, lingering and hanging modes.
3. Tests (`npm run test:bridge`):
   - `adapters.test.mjs`: argv mapping, NDJSON parsing (including agy's observed auth-failure shape), CLI flags, wire limits.
   - `bridge.test.mjs`: pi-intercom's **own coordinator runtime** (`dist/runtime.js`, no LLM) over real
     loopback HTTP. Covers register → configure → reload → instruction → report, resume IDs, blocked/timeout/long
     results, status, receiver refusals, restart with the same session, and SIGTERM of the real CLI process. Every
     emitted envelope is checked against the extension's `envelope()` validator.
4. `scripts/smoke.mjs`: a two-prompt real-CLI run. The Cursor log is in `packages/intercom-bridge/smoke/`.

## Verification status

| Item | Status |
|---|---|
| Cursor flags (`--print`, `--output-format stream-json`, `--resume`, `--trust`, `--workspace`, `--force`, `--`) | Verified: docs, `--help`, and a real authenticated smoke run (2 turns, resume recalled context) |
| Cursor NDJSON (`session_id`, `type:"result"`) | Verified by the smoke run |
| agy flags (`--print=`, `--output-format stream-json`, `--conversation`, `--dangerously-skip-permissions`) | Verified: docs and `agy --help` (1.4.6, Linux x64) |
| agy NDJSON success shape | **Unverified**: docs only, no authenticated run |
| agy lingering after its `result` event | Observed unauthenticated; the runner stops it after 2 s |
| Windows | **Unverified**: fake-CLI tests skip on win32 (POSIX shebang) |

## Follow-ups (not in this change)

- Authenticated agy smoke run (`node scripts/smoke.mjs agy`).
- Optional: let `intercom_resume_worker` relaunch bridge entries. That needs a config field and is a protocol/extension decision.
- Windows CI leg for the bridge with a `.cmd` fake CLI.
