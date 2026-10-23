# pi-intercom-bridge (experimental)

Runs **Cursor Agent CLI** (`cursor-agent`) or **Google Antigravity CLI** (`agy`) as a worker on a
pi-intercom board, using the unchanged V1 wire protocol. Design:
[proposed solution](../../docs/issues/non-pi-agent-bridge-proposed-solution.md).

```bash
npm run build && npx tsc -p packages/intercom-bridge     # from the repo root
# From the coordinator's shell (the board root holds .pi-intercom/config.json):
node packages/intercom-bridge/dist/cli.js spawn --agent cursor --root . [--cwd sub/dir] [--model <m>] [--auto-approve]
# → {"sessionId":"cursor-bridge-…","pid":…,"log":"~/.pi-intercom-bridge/<id>.log"}
```

The coordinator receives a normal registration. It then calls `intercom_configure_worker` (with the
reported `sessionId`/`port`), `intercom_reload_worker`, and `intercom_send`. Each instruction runs one
headless CLI turn, and the answer comes back as a worker report. Relaunch a stopped worker with
`spawn --agent <same> --session <id>`, not `intercom_resume_worker`, which launches Pi.

Options: `--bin <path>`, `--turn-timeout <s>` (default 1800), `--state-dir <dir>` (default
`~/.pi-intercom-bridge`, or `PI_INTERCOM_BRIDGE_STATE`). The CLI must already be logged in
(`cursor-agent login` / `agy`). Tests use a fake CLI: `npm run test:bridge` at the root.
Real smoke run: `node packages/intercom-bridge/scripts/smoke.mjs cursor`.
