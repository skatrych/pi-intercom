# Issue 16 — Implementation Plan

Depends on independent review/routing and human approval of [the Proposed Solution](16-proposed-solution.md), followed by a separate implementation assignment. This revision is for review, not merge-ready. This fork design workspace is not an upstream implementation base. No new/changed ADR applies.

**Pending choices:** D1 (value-free invalid-input startup warning) needs explicit human disposition before finalizing the implementation brief; silent fallback remains the operative requirement, not an accepted rejection of the suggestion. D2 (optional upstream issue first) blocks that optional publication path until approved and separately authorized, not completion of analysis/docs. If D2 is declined, retain “issue only if required.” If approved, obtain a maintainer answer or explicit human direction to proceed with the baseline before coding. Neither choice alone grants implementation or publication permission. Record any approved amendment in issue 16 through Coordinator, then align and independently review these documents.

## 1. Establish the contribution baseline

Coordinator fetches current `mbundgaard/pi-intercom` main and allocates a separate contribution workspace/branch from that exact fetched tip. Record remote URL, branch and full base SHA. Developer rechecks current source, README validation guidance, community/default-owner guidance and issue requirements; disclose changes from the design's observed `6af57284abe93db37dee36015f808ddf688fc840`. A material compatibility departure requires explicit agreement recorded in issue 16, not a local reinterpretation.

Use a selective port with provenance from `a9416061d246bb99fc3673cc8a977c274dbf9bda` and historical isolated proposal `2032d34e76fa8eecc9a5a6bc531acb1e9e78322f`; do not merge/cherry-pick whole fork history or copy historical trees. Record why a direct isolated cherry-pick was not selected (export compatibility, current factory mocks and unnecessary test churn). Do not transfer these fork planning documents to upstream.

## 2. Implement the narrow change

| File | Planned change after authorization and reason |
| --- | --- |
| `src/reminders.ts` | Compact pure parser and production env reader; retain `REMINDER_INTERVAL_MS`; optional third constructor argument; use validated delay for every recurrence; fixed interval-neutral text. Explain `floor(2147483647 / 60000)` beside the bound. Keep timer/fencing logic identical; no fork `captureGuard` or unnecessary exported constant family. |
| `src/runtime.ts` | Add reader seam, one start-local snapshot and constructor argument only. Keep tool ordering, root/role/lifecycle checks and disposal intact; no fork interval cache/startServices/adoption dependencies. |
| `src/index.ts` | Interval-neutral stop-tool description only; preserve other tool text and event handlers. |
| `README.md` | Update current reminder behavior and quote; add short operator-variable section with accepted bounds/fallbacks, disable/restart semantics and POSIX/PowerShell examples. No release evidence or version work. |
| `tests/reminder-config.test.mjs` | Focused parser, exact scheduling, runtime snapshot/production reader and fixed-text regressions using upstream-compatible mocks. |
| `tests/reminders.test.mjs` | Retain existing default regressions; pin runtime environment reads against operator contamination. Add only uncovered armed/no-reset and replacement checks below; do not parameterize the entire lifecycle suite across intervals. |
| `package.json` | Add the new test to upstream's explicit `npm test` file list only. Preserve every existing test entry; do not import fork-only roles/adoption tests or scripts. |

Prefer this small seven-file envelope, not the historical 400-line patch. A literal four-file limit omits required interval-neutral tool text and explicit test registration in this upstream base; the small `src/index.ts`/`package.json` edits are justified, not fork machinery. No hard source/test line quota: minimize duplication, not required behavior coverage. Reworking the fork's implementation is separate work, not part of this upstream port.

No migration or dependency installation beyond isolated development/package validation is needed. Keep `dist/`, tarballs and local test artifacts untracked/ignored; no lockfile edit is expected. Any additional changed path needs an explicit requirement-based explanation and review, not incidental cleanup.

## 3. Proportional deterministic validation

Use one compact parser table and a few grouped configuration tests, not one test per spelling or a tool × interval cross-product. Reuse upstream fixtures where practical. Fake clocks record **actual** delays and retain cancelled callbacks; advance one interval at a time and await asynchronous role checks. Temporary roots and in-memory transports/launchers/probes have unconditional cleanup; never real agents/models or live configuration. Factory mocks must match upstream `registerFlag`/`getFlag` when exercised.

| Focus | Minimum coverage without duplicating upstream suites |
| --- | --- |
| Parser table | Accept `1`, `5`, `35791`, whitespace and leading zeros (combine the latter in one case). Reject unset, blank, `0`, `-1`, `+1`, `1.5`, `1e2`, `0x10`, `10m`, one non-ASCII digit, an unsafe decimal and `35792`; all return exactly `300000`. These represent each issue-required category; no exhaustive hex/binary/octal, separator, `NaN`/`Infinity` spelling catalogue. Check the ceiling arithmetic. |
| Delay and snapshot | Record exact default/override/max delay and recurrence with a small timer table, retaining two-argument constructor/default-export coverage. In one nondefault runtime scenario check no construction read, one read per start, disarmed startup, delivery at delay but not delay-minus-one, reset, stop/rearm and config-only `reload()` stability after changing the reader. Close/start rereads and remains disarmed. No full lifecycle matrix at each delay. |
| Real environment | One isolated non-concurrent test omits the seam; set an override then delete it for fallback after restart. Save original presence/value and restore in `finally`; pin other runtime fixtures. This exercises production `process.env`, not a loaded host. |
| Lifecycle regression | Run existing upstream reminder/extension suites: qualifying calls arm before effects (even failed/uncertain ones), authorization, invalid/read-only/incoming operations, invocation ordering, busy skipping/no backlog, failed delivery/no replay, role loss, abort ownership, stale/in-flight fences and disposal. Add focused gaps only: non-arming/non-resetting operations also run with an already-armed timer and preserve its due time; armed/in-flight role reads cannot deliver after close/restart or session-ID replacement. One override smoke covers busy skip, stop/rearm and retained stale callback suppression; retain the broader default suite, not duplicate every tool at override. |
| Fixed text/privacy/root | Assert the fixed reminder differs only in the interval phrase, including unchanged authority disclaimer; stop-tool text is interval-neutral. Invalid-input sentinel never appears in captured notifications/delivery/observation output. Until D1 is agreed, no invalid-input diagnostic is emitted. Run existing root-isolation suites unchanged: same-root flags and parent/subfolder-launch refusal. |

This preserves issue 16's required behavioral coverage while avoiding the fork's 257-line configuration harness and wholesale fixture rewrite. If freshly fetched upstream already covers a gap, reuse that assertion; if it does not, add the smallest deterministic case. Explain the coverage map in the implementation handoff. D1 approval would add only the focused diagnostic assertions identified in the solution, not expand the timer matrix.

## 4. Validate and hand over

At the exact contribution tip, run upstream's current required checks in the isolated workspace: `npm ci`, `npm run typecheck`, `npm test`, `npm run check:package`; also `git diff --check` and base-to-tip diff review. Record Node/npm/OS, exact commands/results, test registration, package gate/network outcomes and any gaps. Package-test tarball installation is isolated validation, never production installation. Local Linux success does not establish native Windows success; record upstream's Node 24 Ubuntu/Windows CI separately. No installed-host probe, production reload, publishing or release workflow is required/authorized.

Before review record full base/tip SHAs, every changed file's purpose, port provenance, clean tree/empty index, declared fixtures with owner/removal point (or none), and submodule state. Independent Verifier reviews that exact base-to-tip diff and evidence before upstream submission. Findings requiring design changes return here for another independently reviewed round.

After authorized submission routing, follow then-current upstream guidance; create a prior issue only if required under the operative baseline, or via the explicitly approved/authorized D2 path. Agent PR bodies must pass projects-home `scripts/pr-body-guard.sh` with the exact proposed body and use `Refs` only, not closing keywords. No merge authority is granted. If submission permission fails, provide an accessible submission-ready branch/tip, target/base, proposed PR title/body, provenance, validation/verifier evidence and the exact blocked action; report publication only with a real upstream PR URL. Coordinator owns routing and any further authorization.
