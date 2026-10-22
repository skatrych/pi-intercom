# Issue 16 — Implementation Plan

Depends on independent review/routing of [the Proposed Solution](16-proposed-solution.md) and a separate implementation assignment. This fork design workspace is not an upstream implementation base. No new/changed ADR applies.

## 1. Establish the contribution baseline

Coordinator fetches current `mbundgaard/pi-intercom` main and allocates a separate contribution workspace/branch from that exact fetched tip. Record remote URL, branch and full base SHA. Developer rechecks current source, README validation guidance, community/default-owner guidance and issue requirements; disclose changes from the design's observed `6af57284abe93db37dee36015f808ddf688fc840`. A material compatibility departure requires explicit agreement recorded in issue 16, not a local reinterpretation.

Use a selective port with provenance from `a9416061d246bb99fc3673cc8a977c274dbf9bda` and historical isolated proposal `2032d34e76fa8eecc9a5a6bc531acb1e9e78322f`; do not merge/cherry-pick whole fork history or copy historical trees. Record why a direct isolated cherry-pick was not selected (export compatibility, current factory mocks and unnecessary test churn). Do not transfer these fork planning documents to upstream.

## 2. Implement the narrow change

| File | Authorized change and reason |
| --- | --- |
| `src/reminders.ts` | Pure parser and production env reader; retain `REMINDER_INTERVAL_MS`; optional third constructor argument; use validated delay for every recurrence; fixed interval-neutral text. Keep timer/fencing logic otherwise identical. |
| `src/runtime.ts` | Add reader seam, one start-local snapshot and constructor argument only. Keep tool ordering, root/role/lifecycle checks and disposal intact; no fork interval cache/startServices/adoption dependencies. |
| `src/index.ts` | Interval-neutral stop-tool description only; preserve other tool text and event handlers. |
| `README.md` | Update current reminder behavior and quote; add short operator-variable section with accepted bounds/fallbacks, disable/restart semantics and POSIX/PowerShell examples. No release evidence or version work. |
| `tests/reminder-config.test.mjs` | Focused parser, exact scheduling, runtime snapshot/production reader and fixed-text regressions using upstream-compatible mocks. |
| `tests/reminders.test.mjs` | Keep default regressions and extend fixtures/cases to exercise the lifecycle invariants with an override; pin environment reads so operator exports cannot contaminate old tests. |
| `package.json` | Add the new test to upstream's explicit `npm test` file list only. Preserve every existing test entry; do not import fork-only roles/adoption tests or scripts. |

No migration or dependency installation beyond isolated development/package validation is needed. Keep `dist/`, tarballs and local test artifacts untracked/ignored; no lockfile edit is expected. Any additional changed path needs an explicit requirement-based explanation and review, not incidental cleanup.

## 3. Deterministic test checklist

Use fake clocks recording the **actual** scheduled delays and allowing retained cancelled callbacks to be invoked. Advance one interval at a time; await asynchronous role checks, not real-minute sleeps. Use temporary config roots and in-memory transport/launcher/probe fakes, with unconditional cleanup; never real agents/models or live configuration. Factory mocks must include upstream `registerFlag` (and `getFlag` if startup is exercised), not fork event-bus/adoption mocks.

- **Parser:** accept `1`, ordinary values, `5`, `35791`, whitespace (including `trim()` whitespace) and many leading zeros. Reject unset/blank, `0`/all zeros, signs, decimals, exponents, hex/binary/octal, suffixes/separators/internal whitespace, non-ASCII digits, `NaN`/`Infinity`, unsafe huge numbers and `35792`. Assert exact fallback `300000`; boundary arithmetic proves no Node timeout overflow.
- **Timing and snapshots:** no read on construction; one reader invocation per start; no startup timer. Assert exact scheduled delay, no delivery at delay minus one, delivery at delay, recurrence and reset at default, one minute, an ordinary override and maximum. Change the reader's return after start; reset, stop/rearm and config-only reload must retain the original delay and read count. Close/start rereads and starts disarmed, then uses the new interval. Old callbacks cannot deliver into that lifecycle.
- **Production path:** omit the seam in one isolated, non-concurrent test, set/delete the real process variable and verify override then fallback after close/start. Save its prior presence/value and restore in `finally`; do not change a loaded host environment. Pin other runtime fixtures to explicit default/override readers.
- **Lifecycle/permissions:** run upstream reminder invariants at default and an override, retaining default constructor/export coverage. Include valid coordinator create/configure/send/reload/request-status/resume/close preflights (mock effects, including failed/uncertain effects), invalid/unauthorized/unsupported calls, incoming reports/replies/status, status reads/probes/list and bookkeeping not arming/resetting. Test both disarmed and already-armed cases so an accidental reset cannot hide behind a timer-count assertion. Include busy-skip/no catch-up, failed-delivery no immediate replay, role loss, stop/rearm, abort ownership, reset/stop/dispose stale callbacks, slow role reads, late valid preflights fenced by newer stop/calls, and invalid calls not superseding pending valid calls.
- **Replacement/disposal:** retain upstream adapter regression coverage for session-start replacement and session-shutdown routing to close. At runtime level assert an armed timer and an in-flight role check cannot deliver after close/restart or host session-ID replacement. This combination covers reload/shutdown/replacement without changing production event handling; add focused assertions in reminder tests where existing tests only cover idle replacement.
- **Text/privacy and isolation:** assert the entire fixed reminder except its interval phrase remains unchanged, including authority disclaimer; tool descriptions do not promise five minutes. Capture notifications/deliveries/observation output for a sentinel invalid input and ensure it is never echoed. Run unchanged root-isolation/extension suites: same-root flags and refusal of parent/subfolder launches must remain upstream behavior.

## 4. Validate and hand over

At the exact contribution tip, run upstream's current required checks in the isolated workspace: `npm ci`, `npm run typecheck`, `npm test`, `npm run check:package`; also `git diff --check` and base-to-tip diff review. Record Node/npm/OS, exact commands/results, test registration, package gate/network outcomes and any gaps. Package-test tarball installation is isolated validation, never production installation. Local Linux success does not establish native Windows success; record upstream's Node 24 Ubuntu/Windows CI separately. No installed-host probe, production reload, publishing or release workflow is required/authorized.

Before review record full base/tip SHAs, every changed file's purpose, port provenance, clean tree/empty index, declared fixtures with owner/removal point (or none), and submodule state. Independent Verifier reviews that exact base-to-tip diff and evidence before upstream submission. Findings requiring design changes return here for another independently reviewed round.

After authorized submission routing, follow then-current upstream guidance; create a prior issue only if required. Agent PR bodies must pass projects-home `scripts/pr-body-guard.sh` with the exact proposed body and use `Refs` only, not closing keywords. No merge authority is granted. If submission permission fails, provide an accessible submission-ready branch/tip, target/base, proposed PR title/body, provenance, validation/verifier evidence and the exact blocked action; report publication only with a real upstream PR URL. Coordinator owns routing and any further authorization.
