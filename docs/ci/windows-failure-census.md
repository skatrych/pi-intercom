# Windows CI failure census — #18

Evidence for the interim advisory-Windows baseline in `.github/workflows/ci.yml`.
Requirement authority: issue #18 refinement comment
[`6291014129`](https://github.com/skatrych/pi-intercom/issues/18#issuecomment-6291014129),
approved by the independent Verifier review in comment `6291063699`.

**What closing this means.** The policy and the census below are evidenced. It does
**not** certify Windows support and does **not** mean the Windows suite passes. Windows
stays advisory until a separate explicit decision backed by a full green Windows run with
no unexplained new skips. Ubuntu is blocking throughout. A green workflow under this
policy is not a green Windows suite.

## 1. Sources

| Run | Job | SHA | Event | Window |
| --- | --- | --- | --- | --- |
| [39401674188](https://github.com/skatrych/pi-intercom/actions/runs/39401674188) | [118557619771](https://github.com/skatrych/pi-intercom/actions/runs/39401674188/job/118557619771) | `87768090abe1152346d1a4dfacee392a5c41896b` (`main`) | push | `validate (windows-latest)` |
| [39421474040](https://github.com/skatrych/pi-intercom/actions/runs/39421474040) | [118623209192](https://github.com/skatrych/pi-intercom/actions/runs/39421474040/job/118623209192) | `eec84dd0c60e6f8ae9d6ab4488aa5dbcf469b168` (PR #17 head) | pull_request | `validate (windows-latest)` |

Reproduce every number in this file from a shell with GNU `timeout`, with no local
Windows execution. All analysis is read-only against the archived logs.

```sh
timeout 25s gh run view 39401674188 -R skatrych/pi-intercom --json headSha,jobs,conclusion
timeout 30s gh run view 39401674188 -R skatrych/pi-intercom --job 118557619771 --log-failed
timeout 30s gh run view 39421474040 -R skatrych/pi-intercom --job 118623209192 --log-failed
```

Counts are taken from the `✖ failing tests:` block that Node's spec reporter emits at the
end of `npm test`. That block carries one `test at <file>:<line>:<col>` record per
failure, so a key is `file + test name`, as required. Records parsed: 313 (main) and 310
(PR) — equal to each run's own reported `fail` count, so the block is complete.

## 2. Totals and reconciliation

| Run | tests | pass | fail | skipped | pass+fail+skipped |
| --- | --- | --- | --- | --- |
| main `8776809` | 592 | 275 | 313 | 4 | 592 ✓ |
| PR #17 `eec84dd` | 576 | 262 | 310 | 4 | 576 ✓ |

Both totals reconcile arithmetically with no remainder. The 4 skips per run are not
enumerated by the spec reporter's failure block; they are accounted for only as the
arithmetic remainder above, and are identical in count on both runs. Any future green
Windows run must not introduce new skips that are not individually explained (refinement
AC5).

Both runs fail inside `npm test`. `npm ci` and `npm run typecheck` succeed on both;
`npm run check:package` is not reached.

### The named defect: Windows cancelled a passing Ubuntu

| Run | Ubuntu steps | Ubuntu conclusion | Windows conclusion |
| --- | --- | --- | --- |
| main `8776809` (push) | all success | **success** (finished 09:35:33, 6s before Windows failed at 09:35:39) | failure |
| PR #17 `eec84dd` | **all success, including `npm test` and `npm run check:package`, all post-steps and `Complete job`** | **cancelled** (12:21:34, 1s after Windows failed at 12:21:33) | failure |

The Ubuntu leg on the PR run did not fail anything: every step it ran succeeded, and it
was still reported `cancelled`, one second after the Windows leg failed, dragging the
whole run to `failure`. That is `strategy.fail-fast` cancelling a sibling matrix leg.
main escaped it only because Ubuntu happened to finish 6 seconds earlier — so the
cancellation is a race, not a stable behaviour. This is why the workflow change sets
`fail-fast: false` in addition to Windows-only `continue-on-error`.

## 3. Set reconciliation

Keyed by `file + test name`:

| Set | Keys | Occurrences |
| --- | --- | --- |
| Common to both runs | **281** | 281 (main) / 281 (PR) |
| main-only | **32** | 32 |
| PR-only | **27** | **29** |
| main total | 313 keys | 313 |
| PR total | 308 keys | 310 |

The PR run's 2 extra occurrences come from exactly two duplicated keys, each reported
twice:

- `tests/adoption-ux.test.mjs` :: *AC5 an unreadable finalizeTransition decision names its step, not a generic host error* — 2×, both at declaration `:370:3`
- `tests/adoption-ux.test.mjs` :: *AC5 an unrenderable finalizeTransition decision is a named HOST refusal with no fallback surface* — 2×, both at declaration `:386:3`

Both copies of each pair carry the same declaration line/column and the same load-time
stack, so these are two key-identical records rather than two distinct defects. Why the
reporter emits the same test twice is **not determinable from the archived log** and is
left open; it affects only the occurrence count, not the classification.

281 + 32 = 313 ✓ (main) and 281 + 29 = 310 ✓ (PR).

Per-file distribution of the 340 distinct keys:

| File | Keys | Common | main-only | PR-only |
| --- | --- | --- | --- | --- |
| `tests/adoption-review-regressions.test.mjs` | 108 | 108 | 0 | 0 |
| `tests/adoption.test.mjs` | 115 | 106 | 7 | 2 |
| `tests/adoption-ux.test.mjs` | 77 | 32 | 23 | 22 |
| `tests/adoption-contract.test.mjs` | 16 | 14 | 1 | 1 |
| `tests/adoption-runtime-extra.test.mjs` | 12 | 12 | 0 | 0 |
| `tests/adoption-bridge.test.mjs` | 7 | 5 | 1 | 1 |
| `tests/roles.test.mjs` | 4 | 4 | 0 | 0 |
| `tests/handoff.test.mjs` | 1 | 0 | 0 | 1 |

Only 8 test files are implicated at all. The other 24 files in `npm test` pass on
Windows.

## 4. Root-cause reduction: two causes, not six

Across 313 and 310 failures there are only **4 distinct error messages on main** and
**5 on the PR run**. The six symptom clusters named in issue #18 ("adoption
authorization/bridge, claim gate fail-closed, admission-prefix ordering, worktree B1–B3
fencing, store authority/epoch, residual") are *test-name* groupings inside these 8
files. They do not correspond to six causes.

| Cause | main | PR | Files |
| --- | --- | --- | --- |
| A. `ERR_UNSUPPORTED_ESM_URL_SCHEME` (protocol `d:`), raised at module load | 309 | 305 | 6 adoption files + fixture runner |
| B. Windows 8.3 short-name path inequality (`runneradmin` vs `RUNNER~1`) | 3 | 3 | `tests/roles.test.mjs` |
| C. `until()` 3s poll timeout — "condition did not settle" | 1 | 1 | `tests/roles.test.mjs` |
| D. `until()` 3s poll timeout with fixture diagnostics | 0 | 1 | `tests/handoff.test.mjs` |

309 + 3 + 1 = 313 ✓ (main). 305 + 3 + 1 + 1 = 310 ✓ (PR).

### Cause A — `ERR_UNSUPPORTED_ESM_URL_SCHEME`

196 occurrences on main and 197 on the PR run carry this stack directly, with no test-body
frame at all — the module never loaded, so no assertion in these files was ever
evaluated:

```
Error [ERR_UNSUPPORTED_ESM_URL_SCHEME]: Only URLs with a scheme in: file, data, and node
are supported by the default ESM loader. On Windows, absolute paths must be valid file://
URLs. Received protocol 'd:'
    at throwIfUnsupportedURLScheme (node:internal/modules/esm/load:193:11)
    at defaultLoadSync (node:internal/modules/esm/load:146:3)
    ...
    at afterResolve (node:internal/modules/esm/loader:611:52)
```

Representative: `test at tests\adoption-bridge.test.mjs:10:71` / *backend authorization
independent of frontend: developer*. All five directly-failing files
(`adoption-bridge`, `adoption-contract`, `adoption-review-regressions`,
`adoption-runtime-extra`, `adoption-ux`) show byte-identical stacks.

The remaining 113 on main and 108 on the PR run are the **same error re-presented**.
`tests/adoption.test.mjs`
spawns each fixture case as a child process; the child catches the load error and prints
it, and the parent asserts the child's output is clean:

- `tests/adoption.test.mjs:15` — `assert.doesNotMatch(output, /FIXTURE ERROR|NOT_PROVEN/)`
- `tests/fixtures/adoption-cases.mjs:55` — `say(\`FIXTURE ERROR: ${String(error?.message ?? error)}\`)`

Representative: `test at tests\adoption.test.mjs:10:71` / *adoption fixture count-home*,
`actual: "FIXTURE ERROR: Only URLs with a scheme in: file, data, and node are supported
by the default ESM loader. ... Received protocol 'd:'"`.

**Origin — exactly two lines, both test-only:**

```js
// tests/fixtures/adoption-fixture.mjs:15
const dist = async name => import(path.join(ROOT, 'dist', name));
// tests/fixtures/adoption-cases.mjs:16
const load = async name => import(path.join(DIST, name));
```

`path.join` yields a bare Windows absolute path (`D:\a\pi-intercom\pi-intercom\dist\…`),
which Node's ESM loader reads as URL scheme `d:` and rejects.

Two facts make this a fixture prerequisite mismatch rather than a product defect:

1. Nothing in `src/` imports these fixtures. The header of
   `tests/fixtures/adoption-fixture.mjs:1-5` states it is a test-only kit, not shipped,
   imported by no `src/` module.
2. **Every other dynamic import in this repo's own tests already does it correctly** —
   `tests/adoption-host.test.mjs:23`, `tests/packaged-monitor.test.mjs:77-78` and
   `tests/version.test.mjs:24,27` all use `pathToFileURL(...).href`. The correct
   convention already exists here; these two fixture lines simply do not follow it.

These 6 files are also the only ones importing `fixtures/adoption-support.mjs` /
`adoption-fixture.mjs`, which is why exactly these files fail and 24 files pass.

## 5. Cluster classification

Per the refinement, a cluster is **platform-assumption** only with a demonstrated fixture
prerequisite mismatch, and **product defect** only where a valid setup violates a
documented contract.

Important correction to issue #18's framing: only **22 of the 340 keys** actually carry the
cluster names listed in the issue. The other 313 Cause-A keys are in the same 6 files and
fail identically at module load. Member counts below are verified by name pattern, and
clusters are name-based groupings over the 8 files — they do not partition the 340 keys.

| Cluster | Members (verified) | Representative log reference | Precondition that fails | Classification |
| --- | --- | --- | --- | --- |
| **Adoption authorization/bridge** | 3 `backend authorization …` keys plus 3 other keys in `adoption-bridge.test.mjs` (7 keys in that file, 6 of them failures) | `test at tests\adoption-bridge.test.mjs:10:71`, `ERR_UNSUPPORTED_ESM_URL_SCHEME` at `esm/load:193:11` | Fixture dynamic `import(path.join(...))` cannot load a module on a Windows drive path. No authorization boundary was reached. | **platform-assumption** |
| **Claim-gate fail-closed** | 5 keys in `adoption-contract.test.mjs`: `dirty-valid`, `newest-malformed`, `deleted-latest`, `uncommitted-active`, `wrong-pair` | `test at tests\adoption-contract.test.mjs:10:71`; error at `esm/load:193:11` | Same load failure. The injected fault was **not** reached: the stack has no test-body frame, so no gate result was observed. Absence of a fail-closed regression is **not** demonstrated either. | **platform-assumption** (gate behaviour itself: **unclassified** — never exercised) |
| **Admission-prefix ordering** | 4 keys in `adoption-review-regressions.test.mjs`: `ordinary admission prefix closes BEFORE held release: missing / unreadable / schema / foreign` | `test at tests\adoption-review-regressions.test.mjs:20:71` | Prior load failure prevented the ordering logic from being exercised at all; no expected/actual prefix is recorded anywhere in either log. | **platform-assumption** (ordering behaviour: **unclassified** — never exercised) |
| **Worktree B1–B3 fencing** | 4 keys, all accounted for: `B1 missing worktree with committed prepared fences …`, `B1 … committed active …`, `B2 already-running malformed newest claim …`, `B3 real failed promotion → read-only pending status …` | `test at tests\adoption-review-regressions.test.mjs:20:71`, `ERR_UNSUPPORTED_ESM_URL_SCHEME` | All four exist and all four fail at module load, **before** any filesystem, link or lock precondition is created. No B1/B2/B3 fence result exists in either run. | **platform-assumption** (fence results: **unclassified** — never exercised) |
| **Store authority/epoch** | 6 keys: `final store authority closes BEFORE temp cleanup when the newest claim is malformed`, `outer queue precedes local filesystem acquisition, which precedes mutation`, and 4 × `inside-lock claim admission refuses BEFORE mutator/release: claim-directory / claim-malformed / claim-missing / query` | `test at tests\adoption-review-regressions.test.mjs:20:71` | Path/setup error at load time; no authority or epoch invariant was evaluated. | **platform-assumption** (epoch invariants: **unclassified** — never exercised) |
| **`roles.test.mjs` short-name paths** | 3 keys: `worker creation without a role preserves the existing launch request` (`:58`), `create_worker accepts a logical role and does not resolve a Pi home` (`:70`), `reported role is persisted, listed, and resumed through the same logical role` (`:99`) | `roles.test.mjs:62`, `actual: 'C:\\Users\\runneradmin\\AppData\\Local\\Temp\\intercom-roles-Zec92a'`, `expected: 'C:\\Users\\RUNNER~1\\…'` | The fixture's expected root is a raw `mkdtemp(path.join(tmpdir(), …))`, and `os.tmpdir()` on this runner is an 8.3 short path. The product canonicalises: `runtime.ts:275` realpath-resolves the session root and `runtime.ts:838` builds launch `cwd` from it. Comparing a canonical value to a non-canonical one is invalid only where 8.3 aliases exist, i.e. Windows. Linux tmpdir is already canonical, so this cannot appear there — consistent with the Ubuntu leg of both runs passing. | **platform-assumption** — see residual question below |
| **Residual: `until()` timeouts** | 2 keys: `close retains the saved role for the following resume` (`roles.test.mjs:236`, both runs); `deadline never forces close; coordinator reload interrupts pending jobs without replay` (`handoff.test.mjs:201`, **PR-only**) | `roles.test.mjs:17` `assert.fail('condition did not settle')`; the handoff case carries full fixture diagnostics reaching `timed_out` with `closeCalls: 0` | 3s poll deadline. One occurrence per run, non-reproducible from a single sample; no demonstrated fixture prerequisite mismatch and no contract violation shown. | **unclassified** — keeps the census criterion open |
| **Remaining Cause-A keys** | 313 keys across the 6 adoption files, not named by any cluster above | byte-identical `ERR_UNSUPPORTED_ESM_URL_SCHEME` load stacks | Same as Cause A: the two fixture `import(path.join(...))` lines. | **platform-assumption** |

335 + 3 + 2 = 340 distinct keys ✓. No unexplained remainder: every one of the 340 keys
carries a cause in the appendix.

Nothing in this table should be read as evidence that the claim-gate, admission-prefix,
B1-B3 fencing or store-authority behaviours work. For those clusters only the *fixture*
failure is classified; the behaviour stays untested. Follow-ups are filed as #19-#23 (§7).

### Residual question on the roles cluster (deliberately not resolved here)

Filed as **#21**; summarised here so this census stays readable standalone.

`ConfigStore.assertSafePaths` (`src/config.ts:401`) fails closed with
`unsafe config root alias` when `realpathSync(root) !== path.resolve(root)`, and
`runtime.ts:147` fails with `unsafe authority path` on the same kind of inequality. Those
guards are the intended anti-symlink/alias safety design.

A legitimate Windows project directory reached through an 8.3 short name is
alias-equal to its canonical path but not *string*-equal to it. Whether such a real user
layout could be refused by these guards is a **plausible** product-facing question, but
these logs do **not** demonstrate it: every one of the 3 failures here is a
fixture-side string comparison, and none reaches a rejection from either guard. It is
recorded as a question to be settled with a reproducer before being classified a product
defect, per refinement AC3.

## 6. main-only and PR-only keys are churn, not fixes

Refinement AC2 requires that changed or removed tests not be presented as fixes. These
differences are test-name churn, and **every main-only and PR-only key fails for the same
Cause A** as the common set. No behaviour changed, so nothing was fixed and no regression
is shown.

Two mechanisms, both verified against current `main@870928b` (which already contains the
merged #17):

1. **Template renames in `adoption-ux.test.mjs`.** Test names are generated from
   `test(...)` templates. The main-run template `AC5 adoption input failure: …` has
   **0** occurrences in current `main`; the PR-run template `AC5 declined: …`
   (`adoption-ux.test.mjs:301`) is present. This is the #17 change from typed wording to
   one contextual yes/no (`870928b` — *Adoption: one contextual yes/no with visible native
   selection controls*). 23 main-only ↔ 22 PR-only keys in that file are the two sides of
   that rename.
2. **A guarded fixture-table change in `adoption.test.mjs`.** Names there are generated
   from a case table, and `adoption.test.mjs:9` hard-asserts its size:
   `assert.equal(names.length, 108, 'fixture table gained or lost a case without an explicit decision')`.
   The main run had 113 `adoption fixture *` failures (table size 113); the PR run had 108.
   7 table cases present on main are absent from current `main` (`authority-blank`,
   `authority-cancel`, `confirm-blank`, `confirm-cancel`, `confirm-false`,
   `confirm-final-false`, `confirm-wrong-id`) and 2 are new (`confirm-capture-failure`,
   `confirm-host-unavailable`): 113 − 7 + 2 = 108 ✓, matching the enforced guard exactly.

The one `roles.test.mjs` name pair and the single `handoff.test.mjs` key are accounted for
in §5 and are not part of this churn.

## 7. Follow-ups

Full remediation is out of scope for this CI-hygiene issue (refinement AC4). All five are
**filed as plain Backlog issues, deliberately unassigned** — the coordinator assigns
owners. The "Owner" column below is the proposed area of responsibility, not a claim of
assignment.

| Issue | # | Follow-up | Classification | Owner (proposed, unassigned) | Verification command / test selection |
| --- | --- | --- | --- | --- | --- |
| [#19](https://github.com/skatrych/pi-intercom/issues/19) | F1 | Wrap the two fixture paths in `pathToFileURL(...).href` at `tests/fixtures/adoption-fixture.mjs:15` and `tests/fixtures/adoption-cases.mjs:16`, matching the convention already used at `tests/version.test.mjs:24`. A valid replacement fixture, not a skip — no assertion changes. | platform-assumption | Test-fixtures owner | `node --test tests/adoption-bridge.test.mjs tests/adoption-contract.test.mjs tests/adoption-review-regressions.test.mjs tests/adoption-runtime-extra.test.mjs tests/adoption-ux.test.mjs tests/adoption.test.mjs` — must show the `ERR_UNSUPPORTED_ESM_URL_SCHEME` count drop to 0 |
| [#20](https://github.com/skatrych/pi-intercom/issues/20) | F2 | Canonicalise the fixture root in `tests/roles.test.mjs` `setup()` so the expected root is compared in the same canonical form the product uses. Changes the fixture, not the assertion. | platform-assumption | Test-fixtures owner | `node --test tests/roles.test.mjs` — the 3 `strictEqual` failures at `:62`, `:81`, `:117` must clear |
| [#21](https://github.com/skatrych/pi-intercom/issues/21) | F3 | Settle the §5 residual question: can a legitimate Windows short-name project root be refused by `src/config.ts:401` / `runtime.ts:147`? Requires a reproducer; keep the safety assertions **unchanged**. Blocked on a proven reproducer before any product change. | unclassified → TBC | Runtime owner | Windows 8.3-short-name reproducer against the two guards. Do not relax either assertion. |
| [#22](https://github.com/skatrych/pi-intercom/issues/22) | F4 | Triage the two `until()` timeout residuals (`roles.test.mjs:236`, `handoff.test.mjs:201`) — need a repeat-run sample on either platform before classification. 3s deadline is the only known bound. | unclassified | Runtime owner | `node --test tests/roles.test.mjs --test-name-pattern "close retains the saved role"` and `node --test tests/handoff.test.mjs --test-name-pattern "deadline never forces close"`, repeated, on Ubuntu |
| [#23](https://github.com/skatrych/pi-intercom/issues/23) | F5 | Re-decide Windows status: keep advisory or promote to blocking. Promotion requires a full green Windows run with no unexplained new skips. | policy | Coordinator | A `Validate` run where `validate (windows-latest)` reports 0 fail and 4 skipped, matching Ubuntu |

## 8. Closure checklist

- [x] Windows-only job-level `continue-on-error`; Ubuntu blocking; no test suppression, no assertion weakening (`.github/workflows/ci.yml`).
- [x] Ubuntu cannot be cancelled by a Windows failure (`fail-fast: false`; §2 documents the defect it fixes).
- [x] Census keyed by file + test name, totals reconciled including skips, common/main-only/PR-only identified, changed tests not presented as fixes (§3, §6, appendix).
- [x] Per-cluster members, representative log reference, precondition, classification; unknowns left explicitly unclassified (§5).
- [x] Follow-ups filed as issues with owners and verification commands — filed as #19, #20, #21, #22, #23 (plain Backlog, unassigned, no closing keywords in any body).
- [ ] Closure comment linking this run, this census and the follow-up issues.

## Appendix — full failure census (340 distinct keys)

Generated from the archived logs; 313 keys observed on main, 308 on the PR run, 340
distinct across both. `C` = common, `M` = main-only, `P` = PR-only.

<!-- generated from runs 39401674188/job118557619771 and 39421474040/job118623209192 (340 distinct file+test keys) -->

### `tests/adoption-bridge.test.mjs` — 7 keys (5 common, 1 main-only, 1 PR-only)

| C/M/P | Test name | Cause |
| --- | --- | --- |
| C | backend authorization independent of frontend: contradictory | ESM |
| C | backend authorization independent of frontend: developer | ESM |
| C | backend authorization independent of frontend: metadata-only | ESM |
| C | bridge rejects copied session manager and uses captured UI, never caller dialogs | ESM |
| M | bridge routes adoption questions to the custom surface, with kind and prompt intact | ESM |
| P | bridge routes the adoption decision to the host selection dialog, with kind and prompt intact | ESM |
| C | real adapter stays read-only while no-board host persists an ordinary non-coordinating turn | ESM |

### `tests/adoption-contract.test.mjs` — 16 keys (14 common, 1 main-only, 1 PR-only)

| C/M/P | Test name | Cause |
| --- | --- | --- |
| C | active same-command promotion retry reopens readiness without record/config publication | ESM |
| C | ancestor path replacement during UI invalidates preview before intent | ESM |
| C | claim gate fails closed: deleted-latest | ESM |
| C | claim gate fails closed: dirty-valid | ESM |
| C | claim gate fails closed: newest-malformed | ESM |
| C | claim gate fails closed: uncommitted-active | ESM |
| C | claim gate fails closed: wrong-pair | ESM |
| C | concurrent historical log append is retained while adoption preserves all seeded evidence bytes | ESM |
| C | failed active commit exact dirty recovery, repeat failure=false | ESM |
| C | failed active commit exact dirty recovery, repeat failure=true | ESM |
| C | nested transaction on another board still acquires that board mutex | ESM |
| C | old-authority update already queued on the local store cannot publish after adoption | ESM |
| C | outer queue precedes local filesystem acquisition, which precedes mutation | ESM |
| C | record symlink is refused without touching its target | ESM |
| P | supported repeated invocation binds confirmation to UUID/hash and timestamps after the yes | ESM |
| M | supported repeated invocation binds confirmation to UUID/hash and timestamps after wording | ESM |

### `tests/adoption-review-regressions.test.mjs` — 108 keys (108 common, 0 main-only, 0 PR-only)

| C/M/P | Test name | Cause |
| --- | --- | --- |
| C | B1 missing worktree with committed active fences ordinary/status/handoff BEFORE mutate | ESM |
| C | B1 missing worktree with committed prepared fences ordinary/status/handoff BEFORE mutate | ESM |
| C | B2 already-running malformed newest claim with restored old bytes closes before the first effect | ESM |
| C | B3 real failed promotion → read-only pending status → same-command write-free retry → proceed | ESM |
| C | Git context cannot use the zero-Git absence shortcut | ESM |
| C | NEXT ordinary update discovers newly appeared ancestor | ESM |
| C | NEXT ordinary update discovers newly appeared bare | ESM |
| C | NEXT ordinary update discovers newly appeared context | ESM |
| C | NEXT ordinary update discovers newly appeared damaged-bare | ESM |
| C | NEXT ordinary update discovers newly appeared worktree | ESM |
| C | Windows simulated retry repeats local/store proof before another rename; closure precedes cleanup | ESM |
| C | admitted composite launch completes across role-preflight invalidation; next dispatch is refused | ESM |
| C | after-save notify freshly proves committed evidence while the local epoch stays open | ESM |
| C | benign Git environment preserves an ordinary non-repository writer | ESM |
| C | configured external Git directory with claim history is not nonrepo absence | ESM |
| C | create_worker carries the admitted epoch through the runtime await | ESM |
| C | direct store preserves the originating foreign-pair refusal when the guard throws | ESM |
| C | final store authority closes BEFORE temp cleanup when the newest claim is malformed | ESM |
| C | final store proof is independent of a throwing runtime guard | ESM |
| C | fresh full proof detects a missing intent object without changing active bytes | ESM |
| C | fresh full proof detects graft intent ancestry without changing active bytes or anchor | ESM |
| C | fresh full proof detects replace intent ancestry without changing active bytes or anchor | ESM |
| C | fresh full proof detects shallow intent ancestry without changing active bytes or anchor | ESM |
| C | handoff before-submit full proof detects malformed newest evidence | ESM |
| C | handoff close-guard full proof detects malformed newest evidence | ESM |
| C | handoff close-return full proof detects malformed newest evidence | ESM |
| C | handoff commit-return full proof detects malformed newest evidence | ESM |
| C | handoff inspect-guard full proof detects malformed newest evidence | ESM |
| C | handoff inspect-return full proof detects malformed newest evidence | ESM |
| C | handoff queued update retains the original reopen guard | ESM |
| C | handoff report staging update-site guard retains local disposed fence | ESM |
| C | handoff report staging update-site guard retains local ended fence | ESM |
| C | handoff report staging update-site guard retains local map fence | ESM |
| C | handoff report target retains every targetForUpdate predicate before the summary is saved | ESM |
| C | handoff request mutation update-site guard retains local deadline fence | ESM |
| C | handoff request mutation update-site guard retains local disposed fence | ESM |
| C | handoff request mutation update-site guard retains local ended fence | ESM |
| C | handoff request mutation update-site guard retains local map fence | ESM |
| C | handoff transition mutation retains local deadline fence | ESM |
| C | handoff transition mutation retains local disposed fence | ESM |
| C | handoff transition mutation retains local ended fence | ESM |
| C | handoff transition mutation retains local map fence | ESM |
| C | handoff transition queued update-site guard retains local deadline fence | ESM |
| C | handoff transition queued update-site guard retains local disposed fence | ESM |
| C | handoff transition queued update-site guard retains local ended fence | ESM |
| C | handoff transition queued update-site guard retains local map fence | ESM |
| C | handoff transition target retains coordinator predicate before mutation | ESM |
| C | handoff transition target retains directory predicate before mutation | ESM |
| C | handoff transition target retains job predicate before mutation | ESM |
| C | handoff transition target retains missing predicate before mutation | ESM |
| C | handoff transition target retains port predicate before mutation | ESM |
| C | inside-lock claim admission refuses BEFORE mutator/release: claim-directory | ESM |
| C | inside-lock claim admission refuses BEFORE mutator/release: claim-malformed | ESM |
| C | inside-lock claim admission refuses BEFORE mutator/release: claim-missing | ESM |
| C | inside-lock claim admission refuses BEFORE mutator/release: query | ESM |
| C | late old guard refusal cannot close a newer reopened epoch | ESM |
| C | launch observation cannot authorize dispatch after the claim is damaged | ESM |
| C | legacy absence is rediscovered on the next reentrant update | ESM |
| C | nested unrelated handoff full guard stays full inside synchronous store mutation; throw leaks no mode | ESM |
| C | newest committed exact restoration is current proof, not historical opening-commit equality | ESM |
| C | non-Orchestrator runtime retains native read error and gains no refusal policy | ESM |
| C | non-authority contention failure does NOT close an authority-enabled epoch | ESM |
| C | non-authority lifecycle failure does NOT close an authority-enabled epoch | ESM |
| C | non-authority lock-io failure does NOT close an authority-enabled epoch | ESM |
| C | non-authority mutator failure does NOT close an authority-enabled epoch | ESM |
| C | non-authority post-schema failure does NOT close an authority-enabled epoch | ESM |
| C | non-authority release failure does NOT close an authority-enabled epoch | ESM |
| C | non-authority rename failure does NOT close an authority-enabled epoch | ESM |
| C | non-authority temp failure does NOT close an authority-enabled epoch | ESM |
| C | non-authority token failure does NOT close an authority-enabled epoch | ESM |
| C | ordinary acquisition authority-path refusal signals synchronously: alias | ESM |
| C | ordinary acquisition authority-path refusal signals synchronously: board-type | ESM |
| C | ordinary acquisition authority-path refusal signals synchronously: config-symlink | ESM |
| C | ordinary acquisition authority-path refusal signals synchronously: inspection | ESM |
| C | ordinary admission prefix closes BEFORE held release: foreign | ESM |
| C | ordinary admission prefix closes BEFORE held release: missing | ESM |
| C | ordinary admission prefix closes BEFORE held release: schema | ESM |
| C | ordinary admission prefix closes BEFORE held release: unreadable | ESM |
| C | ordinary config publication proves evidence after temp close, independently of cheap runtime preparation | ESM |
| C | ordinary runtime configure publisher carries refusal phases before held release | ESM |
| C | ordinary runtime metadata publisher carries refusal phases before held release | ESM |
| C | ordinary runtime remove publisher carries refusal phases before held release | ESM |
| C | ordinary runtime status publisher carries refusal phases before held release | ESM |
| C | ordinary runtime tool publisher carries refusal phases before held release | ESM |
| C | resume_worker carries the admitted epoch across the directory await: closed | ESM |
| C | resume_worker carries the admitted epoch across the directory await: malformed-newest-restored | ESM |
| C | resume_worker carries the admitted epoch across the probe await: closed | ESM |
| C | resume_worker carries the admitted epoch across the probe await: malformed-newest-restored | ESM |
| C | simulated linux context-name casing: GiT_CoNfIg_VaLuE_12 | ESM |
| C | simulated linux context-name casing: GiT_DiR | ESM |
| C | simulated linux context-name casing: GiT_TrAcE | ESM |
| C | simulated linux context-name casing: git_config_key_0 | ESM |
| C | simulated linux context-name casing: git_dir | ESM |
| C | simulated win32 context-name casing: GiT_CoNfIg_VaLuE_12 | ESM |
| C | simulated win32 context-name casing: GiT_DiR | ESM |
| C | simulated win32 context-name casing: GiT_TrAcE | ESM |
| C | simulated win32 context-name casing: git_config_key_0 | ESM |
| C | simulated win32 context-name casing: git_dir | ESM |
| C | startup port ordinary writer closes authority before held release, not later runtime shutdown | ESM |
| C | supported declaration waits for ordinary legacy writer, rechecks preview, then independently declares | ESM |
| C | uncached absence discovery: ancestor | ESM |
| C | uncached absence discovery: bare | ESM |
| C | uncached absence discovery: context | ESM |
| C | uncached absence discovery: damaged-bare | ESM |
| C | uncached absence discovery: none | ESM |
| C | uncached absence discovery: worktree | ESM |
| C | worker_status probe final return rejects a malformed newest claim with restored old bytes | ESM |
| C | worker_status snapshot final return rejects a malformed newest claim with restored old bytes | ESM |

### `tests/adoption-runtime-extra.test.mjs` — 12 keys (12 common, 0 main-only, 0 PR-only)

| C/M/P | Test name | Cause |
| --- | --- | --- |
| C | Orchestrator discovery never reads or logs into a board ABOVE counted projects home | ESM |
| C | REAL default observer cannot turn held no-board root into implicit initialization | ESM |
| C | REAL default observer leaves no-board child and home untouched through shutdown | ESM |
| C | boot coordinator side effects fenced by absent claim | ESM |
| C | boot coordinator side effects fenced by dirty-active claim | ESM |
| C | boot coordinator side effects fenced by newest-malformed claim | ESM |
| C | boot coordinator side effects fenced by prepared claim | ESM |
| C | generated date equality is not corruption; genuinely different date fences: 2026-10-17T00:00:00.000Z | ESM |
| C | generated date equality is not corruption; genuinely different date fences: 2026-12-31T23:59:59.999Z | ESM |
| C | generated date equality is not corruption; genuinely different date fences: 2027-01-01T00:00:00.000Z | ESM |
| C | report save final rename checks epoch (HTTP 400, no save) | ESM |
| C | report save final rename checks external-evidence (HTTP 400, no save) | ESM |

### `tests/adoption-ux.test.mjs` — 77 keys (32 common, 23 main-only, 22 PR-only)

| C/M/P | Test name | Cause |
| --- | --- | --- |
| C | AC1 first board declined: no board, config, claim, commit, or readiness | ESM |
| M | AC1 first board dismissed: no board, config, claim, commit, or readiness | ESM |
| C | AC1 first board: one visible yes/no, no text question, generated schema-valid evidence | ESM |
| C | AC2 claim history is never reclassified as a first declaration: a committed claim disagreeing only on port | ESM |
| C | AC2 claim history is never reclassified as a first declaration: a committed claim naming another pair | ESM |
| C | AC2 claim history is never reclassified as a first declaration: a deleted worktree claim with committed history | ESM |
| C | AC2 claim history is never reclassified as a first declaration: a malformed committed claim | ESM |
| C | AC2 claim history is never reclassified as a first declaration: a newer committed claim | ESM |
| C | AC2 claim history is never reclassified as a first declaration: an uncommitted worktree claim | ESM |
| C | AC2 existing self board with no claim history: explicit declaration, no typed record | ESM |
| C | AC2 self declaration declined writes nothing | ESM |
| P | AC4 current, board, and claim-record ids all differ: the one decision names the board entry, and so does the evidence | ESM |
| M | AC4 current, board, and claim-record ids all differ: the prompt and the halt name the board entry | ESM |
| C | AC4 supported prepared renewal selects its validated previous coordinator | ESM |
| P | AC5 a declined adoption with a committed claim keeps the CLAIM_OTHER context, not a bare cancellation | ESM |
| M | AC5 a fresh invocation asks every gate again from a blank field | ESM |
| P | AC5 a fresh invocation asks the single decision again; nothing is remembered as consent | ESM |
| P | AC5 a yes answered on one preview is not consent for a board that changed underneath it | ESM |
| M | AC5 adoption input failure: ended wording adds a trailing newline | ESM |
| M | AC5 adoption input failure: ended wording adds trailing whitespace | ESM |
| M | AC5 adoption input failure: ended wording approximate | ESM |
| M | AC5 adoption input failure: ended wording cancelled | ESM |
| M | AC5 adoption input failure: ended wording changes case | ESM |
| M | AC5 adoption input failure: ended wording empty | ESM |
| M | AC5 adoption input failure: ended wording names the current session | ESM |
| M | AC5 adoption input failure: ended wording whitespace | ESM |
| M | AC5 adoption input failure: exact transition consent declined | ESM |
| M | AC5 adoption input failure: exact transition consent dismissed | ESM |
| M | AC5 adoption input failure: record cancelled | ESM |
| M | AC5 adoption input failure: record empty | ESM |
| M | AC5 adoption input failure: record exactly at the schema limit is accepted and continues | ESM |
| M | AC5 adoption input failure: record over the schema limit | ESM |
| M | AC5 adoption input failure: record whitespace only | ESM |
| M | AC5 adoption input failure: record with an embedded control character | ESM |
| P | AC5 an unreadable adoptTransition decision names its step, not a generic host error | ESM |
| P | AC5 an unreadable boardInitialize decision names its step, not a generic host error | ESM |
| P | AC5 an unreadable finalizeTransition decision names its step, not a generic host error | ESM |
| P | AC5 an unreadable firstCoordinatorDeclaration decision names its step, not a generic host error | ESM |
| P | AC5 an unreadable renewAdoptionDecision decision names its step, not a generic host error | ESM |
| P | AC5 an unrenderable adoptTransition decision is a named HOST refusal with no fallback surface | ESM |
| P | AC5 an unrenderable boardInitialize decision is a named HOST refusal with no fallback surface | ESM |
| P | AC5 an unrenderable finalizeTransition decision is a named HOST refusal with no fallback surface | ESM |
| P | AC5 an unrenderable firstCoordinatorDeclaration decision is a named HOST refusal with no fallback surface | ESM |
| P | AC5 an unrenderable renewAdoptionDecision decision is a named HOST refusal with no fallback surface | ESM |
| P | AC5 declined: adoption declined with no claim on file | ESM |
| P | AC5 declined: board initialization declined | ESM |
| P | AC5 declined: finalization declined | ESM |
| P | AC5 declined: first declaration declined | ESM |
| P | AC5 declined: prepared renewal declined | ESM |
| P | AC6 a first declaration still records no termination and no timestamp | ESM |
| C | AC6 a self board naming this session at a different port refuses instead of declaring | ESM |
| C | AC6 a verified live old coordinator still refuses adoption before any question | ESM |
| M | AC6 exact wording and valid evidence still complete the adoption | ESM |
| P | AC6 one yes completes the adoption, and the recorded evidence is truthful about its own origin | ESM |
| P | AC6 prepared-after finalization performs no replacement and does not rewrite the anchored evidence | ESM |
| C | AC7 recovery keeps the strict policy against the same scratch | ESM |
| C | AC7 state (a) first declaration proceeds past unrelated backup and scratch-clone content | ESM |
| C | AC7 state (b) first declaration proceeds past unrelated backup and scratch-clone content | ESM |
| C | AC7 the same scratch still blocks ordinary adoption | ESM |
| C | AC8 a protected-path change injected while the decision is open is refused before the commit | ESM |
| C | AC8 state (a) refuses an unrelated staged path | ESM |
| C | AC8 state (a) refuses an unrelated tracked modification | ESM |
| C | AC8 state (a) refuses an unresolved git operation | ESM |
| C | AC8 state (b) refuses a staged claim | ESM |
| C | AC8 state (b) refuses a symlink inside the protected board namespace | ESM |
| C | AC8 state (b) refuses an unrelated staged path | ESM |
| C | AC8 state (b) refuses an unrelated tracked modification | ESM |
| C | AC8 state (b) refuses an unresolved git operation | ESM |
| C | AC8 state (b) refuses unrecognised content inside the protected board namespace | ESM |
| C | AC8 unrelated look-alike paths are not protected, and expected runtime files are allowed | ESM |
| C | AC9 a rename names source and destination, and a staged-and-modified path names both facts | ESM |
| C | AC9 an exotic path in each real category keeps its own category | ESM |
| C | AC9 exotic path names are classified and reported exactly, never reclassified | ESM |
| C | AC9 generated evidence stays inside the unchanged claim schema at the extremes | ESM |
| M | a capture failure during the boardInitialize decision names that step instead of a generic host error | ESM |
| M | a capture failure during the exact-transition decision names that step | ESM |
| M | a capture failure during the firstCoordinatorDeclaration decision names that step instead of a generic host error | ESM |

### `tests/adoption.test.mjs` — 115 keys (106 common, 7 main-only, 2 PR-only)

| C/M/P | Test name | Cause |
| --- | --- | --- |
| C | adoption fixture active-commit-failed | ESM |
| C | adoption fixture active-commit-failed-rerun | ESM |
| C | adoption fixture active-new | ESM |
| C | adoption fixture adopt-declined | ESM |
| C | adoption fixture adoption-wins | ESM |
| M | adoption fixture authority-blank | ESM |
| M | adoption fixture authority-cancel | ESM |
| C | adoption fixture bad-schema | ESM |
| C | adoption fixture bad-version | ESM |
| C | adoption fixture bootstrap-claim-callbacks | ESM |
| C | adoption fixture busy-host | ESM |
| C | adoption fixture callbacks-active-dirty | ESM |
| C | adoption fixture callbacks-after-swap | ESM |
| C | adoption fixture callbacks-before-promotion | ESM |
| C | adoption fixture callbacks-commit-failed | ESM |
| C | adoption fixture callbacks-cross-epoch | ESM |
| C | adoption fixture callbacks-promotion-pending | ESM |
| C | adoption fixture claim-absent-anonymous | ESM |
| C | adoption fixture claim-absent-self | ESM |
| C | adoption fixture claim-active-self | ESM |
| C | adoption fixture claim-board-disagree | ESM |
| C | adoption fixture claim-malformed | ESM |
| C | adoption fixture claim-other-declined | ESM |
| C | adoption fixture claim-port-disagree | ESM |
| C | adoption fixture claim-root-disagree | ESM |
| C | adoption fixture claim-uncommitted | ESM |
| C | adoption fixture clean-advance | ESM |
| C | adoption fixture clean-advance-claim-callbacks | ESM |
| C | adoption fixture commit-rejected | ESM |
| M | adoption fixture confirm-blank | ESM |
| M | adoption fixture confirm-cancel | ESM |
| P | adoption fixture confirm-capture-failure | ESM |
| M | adoption fixture confirm-false | ESM |
| M | adoption fixture confirm-final-false | ESM |
| C | adoption fixture confirm-forged-args | ESM |
| P | adoption fixture confirm-host-unavailable | ESM |
| M | adoption fixture confirm-wrong-id | ESM |
| C | adoption fixture count-home | ESM |
| C | adoption fixture count-second | ESM |
| C | adoption fixture count-second-empty | ESM |
| C | adoption fixture count-symlink | ESM |
| C | adoption fixture count-wrong | ESM |
| C | adoption fixture crash-after-claim | ESM |
| C | adoption fixture crash-after-config | ESM |
| C | adoption fixture crash-after-intent | ESM |
| C | adoption fixture crash-after-promotion | ESM |
| C | adoption fixture crash-before-intent | ESM |
| C | adoption fixture custom-session-dir | ESM |
| C | adoption fixture declaration-claim-callbacks | ESM |
| C | adoption fixture dirty-active-cancel | ESM |
| C | adoption fixture dirty-active-config-changed | ESM |
| C | adoption fixture dirty-active-foreign | ESM |
| C | adoption fixture dirty-active-intent-changed | ESM |
| C | adoption fixture dirty-active-other-session | ESM |
| C | adoption fixture dirty-active-partial | ESM |
| C | adoption fixture dirty-active-semantic-only | ESM |
| C | adoption fixture dirty-active-staged | ESM |
| C | adoption fixture duplicate-keys | ESM |
| C | adoption fixture eperm-then-session-changed | ESM |
| C | adoption fixture foreign-launch-role | ESM |
| C | adoption fixture foreign-token | ESM |
| C | adoption fixture fresh-anonymous | ESM |
| C | adoption fixture generation-changed | ESM |
| C | adoption fixture handoff-cross-epoch | ESM |
| C | adoption fixture handoff-write-race | ESM |
| C | adoption fixture history-preserved | ESM |
| C | adoption fixture initialize-race | ESM |
| C | adoption fixture irregular-format | ESM |
| C | adoption fixture lock-contended | ESM |
| C | adoption fixture lock-unreadable | ESM |
| C | adoption fixture minified-config | ESM |
| C | adoption fixture mixed-hashes | ESM |
| C | adoption fixture new-health-mismatch | ESM |
| C | adoption fixture no-board-child | ESM |
| C | adoption fixture no-board-root-confirmed | ESM |
| C | adoption fixture no-board-root-declined | ESM |
| C | adoption fixture no-ui | ESM |
| C | adoption fixture old-connected | ESM |
| C | adoption fixture old-connected-after-dialog | ESM |
| C | adoption fixture old-refused | ESM |
| C | adoption fixture old-unknown | ESM |
| C | adoption fixture outside-home | ESM |
| C | adoption fixture port-collision | ESM |
| C | adoption fixture prepared-new | ESM |
| C | adoption fixture prepared-old | ESM |
| C | adoption fixture promotion-failed | ESM |
| C | adoption fixture publish-failed | ESM |
| C | adoption fixture queued-old-update | ESM |
| C | adoption fixture queued-report-cross-epoch | ESM |
| C | adoption fixture race-claim-cleanup | ESM |
| C | adoption fixture race-filesystem | ESM |
| C | adoption fixture race-kill-intents | ESM |
| C | adoption fixture race-outer-queue | ESM |
| C | adoption fixture race-process-queue | ESM |
| C | adoption fixture race-reminder-handoff-restart | ESM |
| C | adoption fixture race-two-adopters | ESM |
| C | adoption fixture record-changed | ESM |
| C | adoption fixture registered-worker | ESM |
| C | adoption fixture reminder-cross-epoch | ESM |
| C | adoption fixture root-changed | ESM |
| C | adoption fixture roster-changed | ESM |
| C | adoption fixture send-destination-changes | ESM |
| C | adoption fixture session-changed-after-publish | ESM |
| C | adoption fixture session-changed-rename | ESM |
| C | adoption fixture session-unpersisted | ESM |
| C | adoption fixture single-worker | ESM |
| C | adoption fixture stale-lock | ESM |
| C | adoption fixture status-wins | ESM |
| C | adoption fixture store-missing-id | ESM |
| C | adoption fixture stored-report-notify-cross-epoch | ESM |
| C | adoption fixture two-adopters | ESM |
| C | adoption fixture two-workers-pending | ESM |
| C | adoption fixture unknown-field | ESM |
| C | adoption fixture untrusted | ESM |
| C | adoption fixture wrong-header | ESM |

### `tests/handoff.test.mjs` — 1 keys (0 common, 0 main-only, 1 PR-only)

| C/M/P | Test name | Cause |
| --- | --- | --- |
| P | deadline never forces close; coordinator reload interrupts pending jobs without replay | until() timeout |

### `tests/roles.test.mjs` — 4 keys (4 common, 0 main-only, 0 PR-only)

| C/M/P | Test name | Cause |
| --- | --- | --- |
| C | close retains the saved role for the following resume | until() timeout |
| C | create_worker accepts a logical role and does not resolve a Pi home | 8.3-short-name path inequality |
| C | reported role is persisted, listed, and resumed through the same logical role | 8.3-short-name path inequality |
| C | worker creation without a role preserves the existing launch request | 8.3-short-name path inequality |

<!-- total distinct keys: 340 -->
