# ADR 0001 — issue #2 investigation checkpoint

Status: **Paused / proposed evidence record, not an approved design.** Human placed issue #2 On Hold on 2026-10-13. Mandatory Verifier review remains outstanding. No implementation or further investigation is authorized until human release.

Issue: https://github.com/skatrych/pi-intercom/issues/2. Companions: [paused plan](0001-queued-delivery-plan.md), [fixtures](../fixtures/2-queued-delivery/README.md), [exact evidence](../fixtures/2-queued-delivery/evidence.json).

## Baselines and isolation

- Fork: `e5b817a7b309dd28c2b56efc25506aa431fc0e68`, manifest 0.7.2; branch `bugfix/2-queued-delivery`, initially clean at this base.
- Intercom upstream: `ca508706f3e6ad5ef5d6a3c105dcfd4423939cff`.
- Exercised host: installed `@earendil-works/pi-coding-agent` **1.2.0**, Linux, Node 24.21.0. SDK imported from installed absolute path, not copies' 0.84.4 dev dependency. Installed `dist/core/agent-session.js` SHA256 `a5c9ff22e42215405804dc0c850e98aff424a1262829161155132a3da020b693`.
- Read-only host main: `3daa20280f6a7c7cbe0935680c9a38fdc3863005`; v1.2.0 tag `06a466935536f8c9bcacb2d5efc0fc021be1bdff`. Tag-to-main diff of `agent-session.ts` changes resumed tool selection only; investigated admission/settlement sections unchanged. Main was **not executed**.
- Coordinator provided `/tmp/pi-intercom-2.OnAFFC` outside production board ancestry, executable fork/upstream copies, SDK/live cwd/session roots and read-only host source. Coordinator owns removal. Repo writes are docs only. No production board/settings/install/source mutations or existing-worker sends.

## Completed evidence

| Scenario | Engine | Result |
| --- | --- | --- |
| Busy releasable tool; sequential M1,M2,SAME,SAME | actual Pi1.2.0 AgentSession, real fork/upstream HTTP, scripted model | All consumed once FIFO, no second send, genuine settlement and pending0 |
| Idle arrival | same host, both Intercom variants | One arrival, one processing run |
| Arrival at final assistant message, tool result, agent-end, before-settle, settled edges | same host, both variants | All progress with no re-ping; newly added edge runs use executable assertions |
| Input delayed across genuine settlement | same host, both variants | Later accepted input starts a later run; no stuck queue |
| Busy controlled tool, one LIVE-M1 marker | real authenticated model/default Pi auth, fork HTTP | Consumed once 2ms after release, settled ~2.1s later, no error/pending/re-ping |

Each observation declares **30 seconds** of silence after eligibility/insertion-start window; it does not require model answer completion within that deadline. Live model: `openai-codex/gpt-6.1-sol`. SDK binds TUI extension contract without a rendered TUI; no new panes/workers. Queues, input pipeline, lifecycle and HTTP are real, not scripted queue mocks. The model/provider gates are scripted except the authenticated observation.

**The original ordinary busy-to-idle stall was NOT reproduced. Original ownership remains UNKNOWN.** Source shows Intercom validates and delegates once, with no held inbound queue. Synchronous host adapter return/HTTP receipt is not host acceptance or model consumption; absence of an Intercom queue does not prove a host stall.

Historical Oct 9 report and apparent five duplicates remain uncorrelated: exact historical Pi version/raw per-layer trace not recovered. ADR-0006 F5a on Pi1.1.0 showed both arrivals mid-tool, M1 steer merge and M2 continuation without third send, not a strong settlement stall. Its held-flush recommendation is not this issue's required repair. Investigation was paused before additional historical log inspection; no new historical evidence is claimed.

### Separate, unassigned host findings

1. **Auth-transition admission race:** actual Pi1.2.0 `prompt()` checks busy, then can await `checkAuth`, then starts without another busy decision. Gate valid M1 auth, start M2's tool, release M1: M1 rejects as concurrent and is absent after 30 seconds. It also emits false `agent_settled` idle=true while M2 tool is held. Reproduced with fork, upstream and direct `AgentSession.sendUserMessage` **without Intercom loaded**.
2. Initial `auth-race` replaced ModelRuntime auth methods (exploratory only). Stronger `native-auth-race` uses supported native provider `auth.apiKey.check`, unavailable ambient availability snapshot then available delayed check. Real ModelRuntime methods and host scheduling are unmodified. The direct-host `--assert` regression exits1: expected M1,M2, actual M2. Main-source equivalence is read-only evidence, not executed-main reproduction.
3. **Preflight ordering:** delayed first input hook allows M2 to be consumed before M1; both variants agree, no loss/replay. Receive FIFO across asynchronous preflight is desired AC4, not an established upstream host guarantee. This finding is not an authorized second fix.

**Significance:** auth loss is an edge case, not an await on every idle prompt. `hasConfiguredAuth(provider) || await checkAuth(provider)` short-circuits when the configured snapshot is true; stable authenticated OpenAI/OpenAI-Codex normally bypasses this auth wait. Fresh auth availability/refresh lag/dynamic provider setup can reach the branch. Loss further requires another prompt to start and remain active during the wait. No natural service-auth latency/race or frequency was measured. The healthy authenticated observation does not reproduce it. Busy is rechecked after input hooks, so input delay alone is not this auth loss. **No causal connection to the historical stall is established.**

## Decisions and withdrawn proposals

Human routing supersedes the earlier Coordinator candidate-prioritization: **do not advance the rare auth-transition race as the fix for original #2**. Original upstream Intercom report is to receive the non-reproduction update/closure through Coordinator; fork #2 stays open On Hold. Auth/input evidence is retained for possible separately assigned host reporting later. Architect publishes no tracker updates or new issues.

Earlier draft loss-repair/FIFO-admission recommendations are **withdrawn**, not implementation-ready. No speculative host serialization, Intercom inbox, timer, wake message, replay or durable deduplication is approved. Seven original ACs remain binding; neither the separate auth finding nor passing normal cases completes them. This record is an investigation checkpoint, not a finished architectural solution.

## Gates and limitations

- Original failing regression/confirmed owner (AC1), before/after fix and regression protection (AC2–AC6), and reviewed upstream contribution (AC7) remain incomplete.
- Tested scripted scheduling shapes and one authenticated healthy turn cannot prove all races, provider paths, crashes/restarts or distributed exactly-once behavior. No historical duplication source established.
- No host main execution, rendered TUI reproduction, supported-host matrix, full host/Intercom suite, package check, fix, upstream PR or fleet rollout performed by Architect. Coordinator built isolated Intercom copies; fixture syntax checks passed.
- Any existing ADR/plan and write-surface proposal requires mandatory independent Verifier review; On Hold blocks continuation. No implicit approval from saving/committing evidence.
- Pi CONTRIBUTING requires maintainer `lgtm` before PR; approval is unverified, not a blocker to retained local evidence. User authorizes contribution after review, human merges; upstream push:false is normal for fork PRs, not proof of submission failure. No publication while paused.
