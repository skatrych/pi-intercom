# Issue 16 — Upstream conflict refresh: Proposed Solution

## Executive Summary

Refresh the published reminder contribution by merging current upstream main into its existing contribution branch **without rewriting history**. Resolve the sole reproduced conflict by preserving both upstream's release suites and the contribution's reminder-configuration suite in `package.json`. Preserve the approved feature contract and all newer upstream fixes. No new ADR or product decision is needed.

This is fork-only planning documentation, correcting missing-artifact finding **S1** in the [independent review](https://github.com/skatrych/pi-intercom/issues/16#issuecomment-6524300538). It supplements the [original solution](16-proposed-solution.md) for integration refresh only. The [separate Implementation Plan](16-upstream-conflict-implementation-plan.md) defines execution and validation. Fresh independent architecture review, explicit repair ownership and update authority remain prerequisites; these documents authorize no contribution change or publication.

## Details

### Evidence and exact baseline

The [read-only assessment](https://github.com/skatrych/pi-intercom/issues/16#issuecomment-6524228020) and independent review corroborate one textual conflict, not a demonstrated reminder-feature defect. Public reads on **2026-10-30 13:45 UTC** reconfirmed:

| Artifact | Exact value |
| --- | --- |
| Published upstream PR | [mbundgaard/pi-intercom#3](https://github.com/mbundgaard/pi-intercom/pull/3), OPEN |
| Contribution branch/head | `skatrych:feature/16-upstream-reminder-implementation` at `14a09f71cc8caf9e6f85a6061a8dac76c8b9f822` |
| Original sole parent/cut base | upstream `main@6af57284abe93db37dee36015f808ddf688fc840` |
| Current upstream main | `789271c8256114363aaecc8c7e7f1f0938b44e81`, following `1450377aeb3e6359ea60e1bdebc9d59d98ad0d8e` |
| PR mergeability | `mergeable:false`, `mergeable_state:dirty`; reported PR base still the original base |
| Held exact-head Validate run | [40565700889](https://github.com/mbundgaard/pi-intercom/actions/runs/40565700889), completed/action_required |

The surviving `refs/pull/3/merge` at `181fb226b1037e094ef3149c1c2a78a45b95a1e2` joins the **old** base and head; it does not establish integration against current main. Recheck refs before execution rather than treating these observations as a permanent lease.

### Minimal integration and preserved behavior

Independent static merging found only `package.json`'s `scripts.test` conflict. Keep every current-main suite and its order, retaining `tests/release.test.mjs`, `tests/release-workflow.test.mjs` and `tests/published-release.test.mjs`; insert `tests/reminder-config.test.mjs` immediately after `tests/reminders.test.mjs`. At these snapshots the union registers **27 suite files, each exactly once**. Selecting either entire side would discard required coverage.

The original contribution changes seven paths: `README.md`, `package.json`, `src/index.ts`, `src/reminders.ts`, `src/runtime.ts`, `tests/reminders.test.mjs` and new `tests/reminder-config.test.mjs`. The other existing paths merge cleanly; the new test is absent upstream. Upstream has not changed runtime/reminder implementation since the original base. Verify that the eventual **current-main-to-refreshed-tip** diff remains this seven-file feature envelope; clean text merging is not executable compatibility proof.

Retain upstream 0.8.1, SDK development dependency 1.4.0, dependency override/lockfile/security audit, release suites/guidance, model-only handoff exposure and deterministic Windows deadline fixes. Keep the runtime TUI alias at upstream's 0.84.4. These are inherited baseline changes, not issue16 release or installed-host upgrade work. Preserve interval-neutral text alongside newer adapter behavior.

The [accepted D1/D2 ruling](https://github.com/skatrych/pi-intercom/issues/16#issuecomment-6402283338) remains settled: environment-only whole minutes 1–35791; five-minute fallback; one fixed, value-free, nonfatal coordinator startup warning for explicit nonblank invalid input; unset/blank quiet; no prior upstream discussion prerequisite. Preserve one snapshot per runtime start, default/export/constructor compatibility, disarmed startup, lifecycle/root/authorization fencing and privacy. Do not redesign or simplify the verified feature during conflict repair.

### Authority, ownership and alternatives

Coordinator must reconcile the existing contribution lease and explicitly assign one write owner before repair. This docs assignment does not transfer the implementation lease. Fork push permission is a capability, not publication authorization; upstream push/maintain permission was absent in the assessment. PR author ownership and `maintainer_can_modify` do not authorize this worker to change upstream policy or PR content.

Prefer a normal merge into the contribution branch and a separately authorized fast-forward push to the same fork branch. It preserves the published artifact and avoids force-push/rebase consent and collaborator coordination. Never merge the contribution into fork main, or merge PR3 upstream. A linear replay is unnecessary; if explicitly required later, Coordinator must arrange the history operation and publication coordination under shared rules, not delegate an unapproved worker rebase.

No new human design ruling is identified for this routine correction. Coordinator can route in-scope repair after review and explicit assignment; if continuation/update authority is absent, obtain that specific authorization before push. Human-only final PR merge remains a separate gate.

### Independent and external gates

The old exact-code review covers only original base to `14a09f7`; a refreshed tip needs independent code, functional and regression review and current-policy validation. Current-main native CI success does not transfer. The held contribution run had zero jobs in the investigation: **not success and not an executed test failure**. The actual historical Windows failure was on different commit `1450377`, subsequently fixed upstream.

Upstream Actions-policy reads returned 403, leaving the precise hold reason unknown. An upstream maintainer must inspect and authorize any policy/approval action. That external gate does not block independent architecture analysis or separately authorized local repair/verification. Approving the old run alone cannot validate a new artifact. Require actual Ubuntu and Windows evidence for the refreshed artifact; no policy bypass, publish workflow, installed-host probe, production install or reload is part of this solution.
