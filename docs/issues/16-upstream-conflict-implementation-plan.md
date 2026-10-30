# Issue 16 — Upstream conflict refresh: Implementation Plan

Implements the [refresh Proposed Solution](16-upstream-conflict-proposed-solution.md), supplementing the [original implementation plan](16-implementation-plan.md) only for current-main integration. No new ADR, contract change or migration is required. This fork documentation must not enter the upstream feature patch.

## 1. Review, authority and clean baseline

- Independently review the exact committed solution/plan and resolve blocking findings before treating them as an approved repair baseline. Coordinator owns review dispatch and routing; author delivery is not approval.
- Coordinator records the non-rewriting refresh decision, reconciles the contribution lease/last write owner, and assigns a sole Developer write owner with explicit permission to merge current upstream main and resolve the manifest conflict. Require clean tree/index, exact head, declared fixtures/cleanup owner and submodule state at handover. Do not perform repair in this fork planning workspace.
- Confirm continuation/publication authority separately before any push to the existing PR head branch. Missing update authority blocks the push, not already authorized local preparation. Do not edit human-owned PR text or infer authority from API permissions.
- Within the later authorized assignment, fetch/reconfirm `https://github.com/mbundgaard/pi-intercom.git` main and the fork head. Record original cut base `6af57284abe93db37dee36015f808ddf688fc840`, expected contribution head `14a09f71cc8caf9e6f85a6061a8dac76c8b9f822`, and expected refresh target `789271c8256114363aaecc8c7e7f1f0938b44e81`. Inspect any changed refs/guidance before proceeding; never overwrite another contributor's work. Material incompatibility returns to Coordinator/Architect rather than silently changing the contract.

## 2. Merge and resolve the exact union

Merge freshly confirmed upstream main into the existing contribution branch without rebasing or rewriting the published head. Record the resulting tip and both merge parents, preserving original base provenance. This branch integration is not an agent merge of either PR into its target.

| Path | Required result relative to current main |
| --- | --- |
| `package.json` | Keep current-main manifest, dependencies, overrides and scripts. Resolve only `scripts.test` as all current-main tests plus `tests/reminder-config.test.mjs` immediately after `tests/reminders.test.mjs`. Preserve the three release suites. At recorded refs, assert 27 registered suite paths, no duplicates, each upstream/head suite retained. |
| `README.md` | Keep feature interval documentation and upstream audit/development/release guidance. |
| `src/index.ts` | Keep interval-neutral stop-tool text and upstream's model-only handoff/direct-tool exposure change. |
| `src/reminders.ts`, `src/runtime.ts` | Preserve the already reviewed parser, snapshot, warning and unchanged scheduler/lifecycle/root/authorization behavior. No refactor. |
| `tests/reminders.test.mjs`, `tests/reminder-config.test.mjs` | Preserve default-fixture environment isolation and all 13 contribution regressions; keep the new suite registered. |

Keep upstream lockfile/version/security/release/Windows-regression changes intact, including files outside this feature envelope. Compare **current upstream main to resulting tip**, not fork main to tip. Expect seven feature paths; explain any departure before acceptance. Check merge resolution and whitespace; ensure no conflict markers, lost test entries, generated files, fork history/features or planning documents enter the contribution. The historical static merge is evidence to guide this work, not a substitute for inspecting the actual result.

## 3. Validate the exact refreshed artifact

In an isolated contribution workspace on **Node24**, record OS, Node/npm versions, exact tip/target/parents, commands, results and gaps. Run current upstream-required checks:

```sh
npm ci
npm run typecheck
npm test
npm audit --audit-level=low
npm run check:package
git diff --check
PI_INTERCOM_REMINDER_MINUTES=7 node --test tests/reminders.test.mjs tests/reminder-config.test.mjs
```

Also review target-to-tip diff/whitespace and test-list union. Run the entire registered suite, including release, adapter/SDK, deterministic Windows-deadline, root isolation and lifecycle regressions, not only the reminder tests. Confirm parser boundaries/fallback/privacy, default/override/ceiling recurrence, one read per start, reset/rearm stability, disarmed startup, accepted warning quiet/failure/stale-start paths, unchanged authorization/busy/abort/stale/in-flight/disposal behavior and environment restoration. Reuse existing focused coverage; no new tool-by-interval matrix is required.

Investigate failures against the exact artifact and baseline; do not label the historical unrelated Windows failure or held zero-job run as a contribution failure. Do not drop suites, disable the audit, bypass checks or upgrade dependencies speculatively to obtain green results. Return material new scope to Coordinator. Temporary fixture roots and isolated package-test artifacts need unconditional cleanup and declared ownership. No agents/models, production config, optional installed-host probe, loaded-extension reload, release/tag/publish workflow or production installation.

## 4. Independent code review, authorized update and native CI

- Hand over the clean exact refreshed tip, original cut base, refresh target, both merge parents, seven-file diff explanation, provenance, test/union evidence, declared fixtures and any gaps. Coordinator arranges independent exact-artifact code plus functional/regression verification. The old PASS does not approve this new tip. Correct findings and repeat review as required.
- Only after that review and explicit update authorization, the assigned owner performs a normal fast-forward push to the existing fork head branch. Reconfirm remote head first; concurrent changes stop publication for reconciliation. No force push, PR3 recreation/body edit or fork-main merge is implied. Record actual pushed SHA/readback and PR URL.
- Upstream maintainer separately inspects held run 40565700889 and applicable policy, authorizing any unblock/rerun. Do not approve/rerun/change policy on their behalf or use alternate credentials/workflows. If a refreshed run is also held, report its exact run/SHA and maintainer-owned action needed.
- Require current-policy Node24 **Ubuntu and Windows** execution of all five commands, including audit and package check. Capture run and job URLs, tested head or merge SHA, merge parents where applicable, outcomes/failures and final mergeability against then-current main. Neither old-run approval, current-main green CI, local Linux success nor historical merge ref proves this gate. No overall gate waiver or agent final merge; Coordinator routes, human merges.

## 5. Rollback and stop conditions

Before publication, preserve the recorded original head and validation evidence. If the merge fails, unexpected paths/behavior appear, or tests fail, stop and report the actual workspace state; no push. A conflicted tree is not a clean handover. Coordinator owns recovery/authorized abort or disposal and reconciliation; workers must not use destructive reset/checkout/clean or silently rebase. Never bypass failed handover guards to transfer an unresolved index.

After publication, do not reset or force-push back to `14a09f7`. Stop further updates, record the exact published artifact and defect, and ask Coordinator to assign an additive correction or explicitly coordinated recovery with the contribution owner. Any rollback/correction changes the tested artifact and needs renewed review/CI. No production rollback is needed or authorized because this work changes no installed runtime.

The only presently identified external blocker is native CI policy/execution evidence under upstream-maintainer control; it does not require reopening D1/D2. New behavior/contract departures, missing publication authority, concurrent ownership/ref changes or a genuinely required history rewrite must be resolved explicitly before the affected action.
