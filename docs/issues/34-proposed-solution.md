# #34 — Proposed Solution

## Executive Summary

Let a coordinator put **Cursor Agent CLI** and **Google Antigravity CLI (`agy`)** workers on a
pi-intercom board as normal participants ([issue #34](https://github.com/skatrych/pi-intercom/issues/34)). A new self-contained package,
[`packages/intercom-bridge`](../../packages/intercom-bridge/README.md), runs one bridge process per
worker. The bridge speaks the **unchanged V1 wire protocol**: it registers like an anonymous Pi
worker, loads its responsibility on `reload`, runs each agent `message` as one headless CLI turn,
and sends the result back as a `report` to the coordinator, or as a `message` to a peer.

No extension code, tool, config field or wire kind changes. The extension's `transport.ts`,
`config.ts` and `handoff.ts` are pure Node with no Pi host dependency, so a generic bridge with
per-CLI adapters is cheaper and safer than patching the Pi runtime or keeping one lib per CLI.
[ADR 0034](../adr/0034-non-pi-agent-bridge.md) records that decision. The separate
[Implementation Plan](34-implementation-plan.md) covers the contract, delivered modules and validation.

## Details

### Components

| Module | Role |
|---|---|
| `wire.ts` | Copy of the V1 envelope, loopback `listen`/`send`, 64 KiB limit, 5 s receipt, no retry |
| `board.ts` | Read-only `.pi-intercom/config.json` view and the root-or-descendant project check |
| `adapters.ts` | `cursor` and `agy`: argv for one headless turn plus an NDJSON result parser |
| `runner.ts` | One child process per turn: timeout, abort, stops a CLI that lingers after its result |
| `bridge.ts` | Worker lifecycle and receiver rules, serial instruction queue, result routing |
| `state.ts` | Bridge-local map from intercom session ID to CLI conversation ID (kept outside board config) |
| `cli.ts` | `pi-intercom-bridge run` (foreground) and `spawn` (detached; waits for startup, prints `{sessionId,pid,port,log}`) |

### Message flow

1. The coordinator runs `pi-intercom-bridge spawn --agent cursor --root <board>` from its shell.
2. Bridge → coordinator: `registration {port, projectDirectory}`, using identity `<agent>-bridge-<uuid>`.
3. The coordinator agent calls `intercom_configure_worker`, then `intercom_reload_worker`. The bridge loads its name and responsibility.
4. `intercom_send` → `message`. The bridge queues it (FIFO, max 8, one CLI process at a time) and runs
   `cursor-agent --print --output-format stream-json --trust --workspace <dir> [--resume <id>] -- <prompt>`
   or `agy --output-format stream-json [--conversation <id>] --print=<prompt>`.
5. Result → coordinator: a `report` (`ready_for_review`, or `blocked` on error/timeout/abort). If the text
   exceeds the 2000-character summary, a full-text `message` (≤ 48 000 characters) is sent first. A peer sender gets one `message`.
6. `request_status` → `status {port, busy}`. Health: `GET /intercom/health`.
7. Exit: SIGINT/SIGTERM aborts the running turn, which is reported as `blocked`, then closes the endpoint. As with Pi
   workers, there is no deregistration wire kind. The entry stays until `intercom_remove_worker`.

### Receiver rules and continuity

Receiver rules are the same as for Pi workers:
- The recipient ID must match.
- Agent messages require a configured sender and recipient, plus a loaded responsibility.
- Controls require the current coordinator.
- `stop`/`close` fail closed, as on every host, and handoff kinds are refused.
- The bridge never writes board config.

Continuity: the first turn starts a CLI conversation. Its `session_id` (cursor) or `conversation_id`
(agy) is saved and passed on every later turn, including after a bridge restart with `--session <id>`.
A restarted bridge sends `status`, as an existing Pi worker does. Responsibility context is added to the
first prompt of a CLI conversation, and again after a reload that changes it.

### Delivery and acceptance limits

- `intercom_resume_worker` / `intercom_create_worker` launch Pi only. Relaunch a bridge with
  `pi-intercom-bridge spawn --session <id>`. The board cannot tell a bridge entry from a Pi entry.
- Tool approvals are off by default. `--auto-approve` maps to cursor `--force` / agy
  `--dangerously-skip-permissions`.
- The prompt is passed as argv, so the Windows command-line length limit (~32 K) caps prompt size there.
- agy success output and Windows remain unverified. See the plan's validation section.
