# Issue #2 isolated reproduction protocol

**On Hold. Do not run these fixtures or continue investigation until human release.** These are retained docs-only investigation artifacts, not production changes or an approved repair. Original stall was not reproduced; separate auth/input findings are unassigned. ADR/plan are incomplete checkpoints requiring mandatory Verifier review. The previously launched matrix command settled before this handover; no additional experiment was started after pause was received. Read [ADR](../../adr/0001-queued-delivery-owner.md) and [plan](../../adr/0001-queued-delivery-plan.md).

## Approved isolation and ownership

Coordinator created `/tmp/pi-intercom-2.OnAFFC` outside workspace/production board ancestry and owns its removal after evidence retained and fixture processes settled. Architect owns only the six documented repo deliverables. No ad-hoc scratch source outside this fixture directory. Runtime-only config/log/catalog/board outputs live in provided `runs/sdk/cwd` or `runs/live/cwd`; provided `sessions` directories are unused (SDK SessionManager.inMemory). No credentials are copied/read/logged; auth access in live fixture is through Pi's default service.

Provided executable copies: fork detached e5b817a7b309dd28c2b56efc25506aa431fc0e68 and upstream detached ca508706f3e6ad5ef5d6a3c105dcfd4423939cff, dependencies installed by Coordinator with `npm ci --ignore-scripts`, then built. Logs: root `fork-setup.log`, `upstream-setup.log`. Read-only host source copy at `pi-host-source`, main 3daa20280f6a7c7cbe0935680c9a38fdc3863005; no installed-host/source-copy changes.

Scripts intentionally allowlist the exact supplied root and installed SDK path. A re-run after cleanup requires Coordinator-created replacement plumbing and an explicit approved path update. Do not self-create clones/worktrees/session roots. Verify no `/tmp/.pi-intercom` or `/.pi-intercom` before each run (scripts assert this). Never reuse live worker sessions/endpoints. Run fixtures serially: they rewrite their own isolated board config and bind 12345 (SDK) or 12346 (live), with runtime's normal endpoint selection/fallback. Fixture-only sender is the configured receiver itself; there are no role workers, launcher or monitor panes.

Extension artifacts are explicitly imported from each provided copy's `dist/index.js`; real AgentSession scheduling uses the actual installed Pi1.2.0 SDK. Copies' 0.84.4 dev dependency does not implement host queues. `bindExtensions({mode:'tui'})` satisfies the extension contract without a rendered terminal UI; no fake `isIdle` or queue/drain implementation is substituted.

## Recorded commands (not authorization to re-run while On Hold)

From issue workspace:

```sh
node --check docs/fixtures/2-queued-delivery/host-session.mjs
node --check docs/fixtures/2-queued-delivery/live-session.mjs
node docs/fixtures/2-queued-delivery/host-session.mjs /tmp/pi-intercom-2.OnAFFC fork busy
node docs/fixtures/2-queued-delivery/host-session.mjs /tmp/pi-intercom-2.OnAFFC fork idle
node docs/fixtures/2-queued-delivery/host-session.mjs /tmp/pi-intercom-2.OnAFFC fork before-settle
node docs/fixtures/2-queued-delivery/host-session.mjs /tmp/pi-intercom-2.OnAFFC fork input-cross-settle
node docs/fixtures/2-queued-delivery/host-session.mjs /tmp/pi-intercom-2.OnAFFC fork native-auth-race
node docs/fixtures/2-queued-delivery/host-session.mjs /tmp/pi-intercom-2.OnAFFC upstream native-auth-race
node docs/fixtures/2-queued-delivery/host-session.mjs /tmp/pi-intercom-2.OnAFFC host native-auth-race --assert
node docs/fixtures/2-queued-delivery/live-session.mjs /tmp/pi-intercom-2.OnAFFC
```

Redirect stdout/stderr only into supplied `runs/sdk` / `runs/live` directories. Other executed comparisons were `upstream busy`, both variants `input-order`, and exploratory `auth-race` (fork twice/upstream once). `host` imports no Intercom extension: direct SDK calls are labelled sdk.send/sdk.returned, **not** HTTP receipts.

Default host-session mode records observations and exits 0 after teardown even for a reproduced scheduling failure. Add `--assert` for failing regression requirements (expected consumption order/no rejection/no settlement while tool held). `host native-auth-race --assert` currently exits 1: expected M1,M2, actual M2. This is executable negative evidence, not a passing fix test. Native-provider shape is the owning-layer regression; `auth-race` replaces ModelRuntime auth methods and is weaker exploratory evidence.

## Fixture semantics and expected/observed results

- `busy`: scripted first model response calls real controlled tool; receive M1,M2,SAME,SAME while tool held, release, no further sends. Expected/observed once each FIFO, 5 scripted requests including initial tool turn, idle/pending0. Distinct identical sends are retained.
- `idle`: one HTTP message starts one request/run, consumed once, idle/pending0.
- `before-settle`: arrival from actual `agent_before_settle` hook leads to continuation with no second send. Notification-only settled hook is not used for delivery.
- `input-cross-settle`: controlled first input hook waits; current run genuinely settles; release input; one later run starts/consumes message. This is **not** a stuck host-queued item.
- `assistant-end`, `tool-end`, `agent-end`, `settled`: send once at the corresponding real event edge; both variants consumed M1 exactly once, no errors, idle/pending0 after silent window. These runs used `--assert` and passed. The settled-edge fixture tests Pi's deferred settled-action behavior, not a proposed Intercom delivery hook. Both variants' idle/before-settle/input-cross-settle cases were also completed; upstream used `--assert`.
- `native-auth-race`: supported native ambient provider availability check initially returns unavailable; after real ModelRuntime availability refresh its snapshot is unconfigured. Enable ambient availability, hold M1's fresh auth check, let M2's ordinary auth check succeed/start tool, release M1. No ModelRuntime method replacement, no host code/queue mocks. Baseline: M1 rejects asynchronously, transcript M2 only; false settled idle while M2 tool held. Same with fork, upstream and direct SDK.
- `auth-race`: exploratory alternative above with scripted ModelRuntime methods. Not the primary reachability evidence.
- `input-order`: delay first input hook; consume later M2 before M1. No loss; desired receive FIFO differs from documented queue-acceptance order. Classification only, not authorization for independent repair.
- Live: existing default auth/model service `openai-codex/gpt-6.1-sol`, real inference and controlled extension tool, LIVE-M1 sent busy, consumed once 2ms after release; genuine settled ~2.1s later; no errors, idle/pending0. Only this is real authenticated model evidence; it uses no auth delay and does not reproduce the auth race or original stall.

Each host run declares a 30,000ms silent observation window; no human input or diagnostic re-ping occurs during it. Busy eligibility is real tool release; auth failure is recorded separately, never relabelled accepted queueing. Native race's false idle is labelled as erroneous, not genuine eligibility. Future FIFO-admission regression support: if M2 cannot start, driver releases M1 auth after at most 500ms (`driver.auth-release-fallback`); otherwise it releases auth only after M2 tool starts. A 5s outer tool-start fence prevents fixture deadlock. This external-driver fallback is not a host timer/fix and is absent from recorded baseline successful reproductions.

Live fixture permits 60s to reach its controlled tool; absence is an invalid setup observation, not defect reproduction. After the 30s insertion window, any still-active fixture run is aborted solely for isolated teardown. Model answer completion is not the delivery deadline. Live logs record only public event discriminants/fixture marker, not reasoning/provider payloads/credentials.

## Preserved evidence and non-evidence

`evidence.json` preserves timestamped public events verbatim for 25 SDK observations/regressions and one authenticated observation, with original JSONL SHA256s and exact commits. The final direct-host assertion stderr and expected exit1 are also retained. No production/historical metadata was inspected after pause. It includes normal cases and two exploratory auth-seam comparisons so evidence strength stays visible. Scripted payloads and assistant stop reasons are safe fixture data. Full Intercom observation logs additionally reside in the supplied root; their correlation IDs join HTTP submission traces to fixtures, not a new authentication/deduplication contract.

Initial setup attempts failed due fixture auth configuration/incorrect active tool selection; three attempts timed out waiting for a tool that was not registered active. Their available stdout/stderr files (`fork-busy-r2` through `r8`) remain outside the repo as non-evidence. They prove neither host stall nor cancellation behavior. The initial `fork-busy` files were reused for final successful run; no purported raw initial trace is preserved. Final runs/primary native shape are unambiguous. No full host or Intercom suite was executed by Architect; syntax checks and selected real-host observations only.

Before root removal: Coordinator verifies no fixture process remains, archives desired runtime diagnostics, then removes provided copies/runtime roots. Do not self-exit/kill existing workers or remove registration. Production board/settings/package installs and issue state are untouched.
