# Issue 9: Adoption UX implementation plan

- Status: Proposed; documentation only, no implementation authorized/performed by this plan
- Date: 2026-10-18
- Authoritative requirements: [refined issue #9 body](https://github.com/skatrych/pi-intercom/issues/9), read with `gh issue view 9 -R skatrych/pi-intercom`
- Baseline: `main@1d5bb074fa3fe306f394c1a292cbed95ff438f3b`
- Decisions: [0009-A authorization](0009-first-declaration-authorization.md), [0009-B visibility](0009-adoption-prompt-visibility.md), [0009-C Git isolation](0009-first-declaration-git-safety.md)

## Outcome and boundaries

Make first declarations a visible explicit yes/no with generated schema-valid evidence, make existing-adoption human gates fully visible and actionable, and stop blocking unrelated untracked scratch content **only** for the two first-declaration paths. Do not change who may adopt, backend discovery, claim schema/history, permitted transition topology, worker behavior or lifecycle contracts.

No new global slash command, model tool, HTTP writer, CLI, terminal fallback, manual claim/config edit, default/automatic consent, approximate ended wording, or broad existing-adoption/recovery cleanliness relaxation. This plan does not ask anyone to run a live adoption or edit installed roles. Follow the normal review/assignment process before implementing it.

## Current implementation anchors

| File / symbol | Observed behavior to change or protect |
|---|---|
| `src/adoption.ts:bootstrap` | `boardInitialize` yes/no followed by typed `askAuthority`; replace the latter with generated evidence after enriched yes. |
| `decide`, claim-free state (b) | Calls `askAuthority` without yes/no; replace with explicit `firstCoordinatorDeclaration`. |
| `askAuthority`, `humanAdoptionDecision` | Shared declaration/adoption text collection; target is board coordinator or validated prepared `previous`; ended mismatch lacks expected sentence and useful step name. |
| `Authority`, `declaration`, `parseClaim` | Separate generated declaration evidence from typed adoption authority; keep schema and canonical renderer/parser unchanged. |
| `assertGitSafe`, `dirtyPaths`, `statusPaths`, `trackedPaths` | Shared strict status gate includes untracked but calls all blockers tracked; introduce private operation policy and correctly parsed/displayed status categories. |
| `writeCommit`, `commitClaim`, `reconcile` | Shared safety checks and separate recovery precheck; thread policy only for declaration commits and fix recovery diagnostics without relaxing recovery. |
| `assertSnapshot`, `assertPaths`, `resolveIdentity`, `transaction`, `openReady` | Security-critical existing gates to retain and regression-test, not replace with generated evidence. |
| `src/index.ts:adoptionContext`, `offerAdoptionBackend` | Captured context supplies authority; input question is passed as placeholder. Preserve captured-context ownership/generation checks while changing rendering. |
| `tests/adoption-host.test.mjs` | Public Pi 1.2.0 load/type/session/bus test, **not** visual proof. Extend, do not relabel it as already proving visibility. |
| `tests/adoption.test.mjs` / fixture runner | Executes all 113 currently declared cases; count is pinned and must be updated deliberately when new cases are added. |

## Delivery sequence and file-level changes

### 1. Characterize fixtures and refusal boundaries before changing code

- `tests/fixtures/adoption-fixture.mjs`, `adoption-support.mjs`: add explicit first-declaration yes/no answer support, write/commit/action snapshots and inspection helpers. Answer by `kind`, never by dialog order. Correct the comment implying mock-captured prompt strings prove visible host text.
- `tests/fixtures/adoption-cases.mjs`, `adoption-runner.mjs`: migrate declaration success answers from typed reference to yes/no; add new scenarios with meaningful expected outcomes/assertions. Keep unrelated scenarios and recovery evidence builders intact.
- Add `tests/adoption-ux.test.mjs` for table-driven first-declaration, targeting, failure-step and Git UX regressions. Register it in `package.json`'s `test` command; do not leave a new test file outside normal CI execution. Keep the fixture table's explicit count accurate if cases are added there.
- Snapshot config/claim bytes and absence, HEAD and claim log, index, readiness/promotion, worker transport calls, and unrelated file bytes. For simulated concurrent changes, compare with the deliberate concurrent writer's bytes, not with an obsolete baseline.

### 2. First-declaration decisions and typed-adoption errors (`src/adoption.ts`)

- Enrich `bootstrap`'s single `boardInitialize` question. Add a claim-free state (b) declaration confirmation in `decide` with stable kind `firstCoordinatorDeclaration`. Both show canonical root, full verified session/port and effects; no call to text collection.
- Add a private generated-declaration evidence helper/type, callable only after positive captured-UI confirmation for the current survey. Use labelled root SHA256 plus full identity in bounded generated text, with full root in the claim. Keep `confirmedEndedAt: null` and declaration date semantics; test maximum supported values against the real parser.
- Narrow `askAuthority` to existing-adoption text collection (or rename it accordingly). Preserve authority-reference trimming/bounds and exact raw ended-wording comparison. Do not alter `ENDED_WORDING` or prepopulate it via the UI.
- Build one domain-owned target/context presentation from the already validated target. Normal adoption: configured board pair. Prepared-before renewal: validated `intent.previous` target; no new operator/model target parameter. Show current, board and differing claim-record identities separately.
- Return explicit `authorising record` or `ended-wording confirmation` cancellation/failure lines. Empty/mismatched ended wording includes the full exact expected sentence and disconnected/unknown warning. Do not echo arbitrary authority reference input. Avoid generic error formatting that truncates a required full expected sentence.
- Preserve result codes and re-invocation behavior. No loops, saved responses, silent defaults or synthesized approval after a stale survey. Declaration consent is invocation-local; exact-transition adoption consent remains tied to transition UUID, board root, previous/new pair and exact config hash.
- Keep `declare`/`bootstrap` locking, snapshot/identity rechecks, committed evidence, promotion and readiness order. Do not reinterpret any claim history as first declaration.

### 3. Visible interaction adapter (`src/index.ts`, new `src/adoption-ui.ts`)

- Route both domain `ui.input` and `ui.confirm` through an adoption-only adapter bound to **captured** Pi UI. Keep `kind` for labels/tests, render the entire `prompt` in a persistent body, keep an initially blank answer or safe yes/no controls separate, and forward raw input/dismissal faithfully.
- Implement the bounded, wrapped/paged custom Pi screen in ADR 0009-B using public custom-UI primitives and existing `pi-intercom-tui` alias. Include width/height-aware layout, keyboard-accessible prompt scrolling while typing, focus/cursor forwarding, paste support, resize/theme invalidation, explicit cancel and disposal. Do not add a second renderer, stdin reader, frontend UI provider, model message or consent serialization.
- Missing capability/construction error/unusable tiny viewport: named `HOST` failure and captured-UI feedback before requesting an invisible answer. Fresh invocation after correction; do not silently fall back to placeholder-only input.
- Preserve the `offerAdoptionBackend` closure's generation/session-manager/cwd checks and only caller-supplied `waitForIdle` control. The visibility helper must not accept identity/target/consent from an untrusted frontend.
- Add `tests/adoption-ui.test.mjs` to normal `npm test`; exercise the actual helper/component, not a parallel mock implementation. Extend `tests/adoption-bridge.test.mjs` with captured-UI routing and caller-dialog rejection coverage that reaches the interaction (using valid persisted fixture identity), while retaining existing pre-UI refusal checks.

### 4. Scoped Git policy and diagnostics (`src/adoption.ts`)

- Add private `strict` / `first-declaration` policy with strict default. Select it only from validated bootstrap/declaration call sites and thread it through write/commit safety calls, including post-hook checks; do not derive it from authority text or expose it through `AdoptionOptions`, command arguments or the bridge.
- Retain global staged-index rejection, unresolved-operation rejection, and unrelated tracked-dirt rejection. Permit only untracked paths outside protected surface for the selected first-declaration policy. No global filtering in `dirtyPaths` that would inadvertently relax `reconcile`.
- Add segment-aware protected-path classification and bounded no-follow filesystem inspection for that policy, including ignored paths. Preserve strict config/history/path guards. Explicitly recognize validated config, transaction-owned lock/temp artifacts, exact generated claim bytes and expected runtime layouts per ADR 0009-C; unknown/unsafe board content never becomes scratch dirt. Do not traverse unrelated nested scratch repositories.
- Read Git status/index paths with NUL separation; preserve status distinctions and rename source/destination identities. Handle escaped/control characters safely for display. Ensure output truncation/incomplete parsing cannot become an empty/clean status result.
- Reuse a diagnostic classifier/formatter in `assertGitSafe` and `reconcile`, without changing their operation policies/result codes. Report staged, tracked-worktree and untracked blockers accurately with paths and “will not commit/clean/reset” wording. Keep phase-aware partial-effect failures truthful.
- Keep checks before first effects and immediately before commit as today, under the same lock where applicable. Preserve claim-only staging/commit and all post-commit parent/path/byte/hash checks. No changes to ordinary `ConfigStore` writers or readiness proof are expected.

### 5. Documentation and distributed artifacts

- `references/coordinator-adoption.md`: separate (a) first board, (b) existing self board with no claim history, and adoption/recovery. State visible yes/no and generated evidence for the first two; retain typed authority/exact wording/exact transition for adoption. Include target labels, expected failure-step messages, fresh invocation, disconnected/unknown warning and no second writer.
- Replace the universal clean-worktree prerequisite with the precise narrow untracked exception and protected-surface definition. Explain globally empty index, tracked-dirt/unresolved-operation refusals, ignored-path safety and conservative broad adoption/recovery isolation. Preserve existing recovery tables, partial-write semantics and proof/history sections.
- Add actual host visibility smoke evidence/limitations and a reproducible temporary-board recipe, not a claim that the old factory test proves rendering. If the chosen host remains broken, record the defect plus the Pi-owned visible workaround and its verification.
- Build through `npm run build`; `src/` is shipped and `dist/` is tracked/shipped, so commit regenerated corresponding `dist/adoption.js`, `dist/index.js`, new `dist/adoption-ui.js` and declaration outputs produced by `tsc` as applicable. Never hand-edit generated files or change version/dependency policy as incidental UX work. Planning commit contains none of these implementation artifacts.

## Acceptance-criteria traceability (all nine groups)

| AC group | Concrete changes | Required automated evidence / manual supplement |
|---|---|---|
| **1 First board** | Enriched `bootstrap` confirmation; generated declaration evidence; visible adapter | No board/history + verified identity; exactly one `boardInitialize`, zero inputs. Yes produces root board plus canonical active declaration claim and one verified claim-only commit, then promotion/readiness. No and dismissal separately leave board/config/claim/HEAD unchanged and readiness closed. Assert full root/session/port/effects in prompt. |
| **2 Existing self board** | `decide` claim-free state (b) confirmation; declaration helper | Exactly one `firstCoordinatorDeclaration`, zero text inputs. Yes leaves config bytes unchanged and commits valid evidence; no/dismissal have no effects. Missing worktree claim with history, malformed/newer/deleted/uncommitted/foreign evidence cannot enter shortcut. Include mismatched own port/identity refusal; merely sharing an ID is not a bypass. |
| **3 Real host visibility** | Real adapter/component, bridge checks, host harness, docs smoke record | Inspect real rendered cells before/after typing and paging, at 40x12 and 80x24, resizing, long IDs/multiline previews. Prove every input/confirm kind uses the visible body, blank input and no placeholder-only path. Extend packed public-host test; record human-observed host smoke if automation cannot prove actual frames/focus (see below). Receipt of an answer is never rendering evidence. |
| **4 Correct target** | Domain target labels and shared full expected-sentence failure text | Fixture with current=A, board=B, committed claim=C, all distinct and admissible under existing evidence rules: ordinary prompt/mismatch result name B, never A/C. Supported prepared-before renewal uses validated `previous.sessionId`; assert prompt/halt equality to `ENDED_WORDING(previous)`. Unsupported combinations still refuse before input. No production incident prefixes in fixtures/prompts. |
| **5 Input failures** | Named record/ended steps and full expected sentence; cancellation behavior | Table below, both prompt/result and zero-pre-effect-write assertions. No worker request, readiness opening, promotion or automatic retry; re-invoke explicitly and observe new questions/blank state. |
| **6 Gate regression** | Preserve security-critical domain/bridge/runtime/store code and existing tests | Exact wording + valid evidence succeeds. Live old endpoint, reconnected-under-lock endpoint, session/port collisions, trust/idle/session changes, stale directory/HEAD/claim/config preview, exact-byte-only config drift, malformed/newer claim, foreign intent still refuse. Keep one-use UUID/hash consent, commit verification, promotion and all readiness/runtime fences. |
| **7 Untracked bootstrap content** | First-declaration policy propagated through all write/commit checks | Matrix (a)/(b) x backup directory/scratch clone (also both together). Hash all scratch bytes before/after; index and ignore rules unchanged; verify each generated commit changes only claim. Same dirt blocks ordinary adoption and prepared-before/prepared-after recovery under existing policy. Include post-hook recheck to detect accidental strict default in declaration commit tail. |
| **8 Protected Git cases** | Protected classifier/layout inspection, strict default and final rechecks | Both first paths reject unrelated staged path, staged claim, unresolved operations, unrelated tracked changes, foreign/uncommitted claim, protected untracked dirt and unsafe path/ancestor obstruction. Repeat protected symlink/type/config/claim cases with ignore rules. Keep recognized derived-active recovery successful. Inject staged/tracked/protected change during dialogs and at last pre-commit barrier; no bypass or accidental commit. |
| **9 Diagnostics/docs** | Shared accurate category reporting in strict/recovery paths; updated adoption guide | Mixed and isolated tracked/untracked/staged fixtures assert categories and exact paths; untracked never labelled tracked. Spaces, newline/non-ASCII names, rename and dual staged/worktree status are tested. Docs match policy/non-goals. Normal full suite, adoption/bridge/contract regressions, typecheck, package/build and explicit host tests pass with real limitations recorded. |

### Input/decision failure table (AC5)

Run through real domain code with stable question kinds; use per-case snapshots and an unexpected-input-call failure on first-declaration paths.

| Step / answer | Expected outcome |
|---|---|
| Authorising record: `undefined` | `CANCELLED`, names authorising record; no later input/transition. |
| Authorising record: empty, whitespace-only, >2000 after current trimming rules, invalid control characters | `CONFIRMATION`, names authorising record; no authority contents echoed. Include exactly-2000 valid boundary success. |
| Ended wording: `undefined` | `CANCELLED`, names ended-wording confirmation. |
| Ended wording: empty, whitespace-only, approximate sentence, wrong current ID, wrong claim-record ID, different case, leading/trailing whitespace | `CONFIRMATION`, names ended-wording confirmation, prints full exact expected sentence and disconnected/unknown warning. No normalization. |
| Ended wording: exact typed/pasted sentence | Proceeds only to explicit exact-transition consent; not success by itself. Adapter paste tests preserve raw text. |
| Exact-transition consent: no/dismissal | `CANCELLED`; no intent/config/claim commit or worker action. |
| First-board / self-declaration consent: no/dismissal | `CANCELLED` naming that decision; zero text prompts, no board/config/claim/history effect. |
| Initial adoption-decision decline | Existing `ADOPTION_REQUIRED`/`CLAIM_OTHER` refusal semantics retained; no text prompts or effects. |

Fresh invocation after any refusal must ask again; a previously successful record/wording answer or a previous consent must not be reused. Use sentinels in authority text to prove diagnostics and test reports do not echo it.

### Target-fixture admissibility (AC4)

For ordinary adoption, seed a schema-valid committed active first-declaration claim for C and a board configured for B, then invoke as verified fresh A; use the current workflow's existing admissibility rules. Verify that B is the termination target even when the claim date/predecessor lookup does not match C. Test both input prompt and the wrong-C answer halt.

For **supported prepared-before renewal**, the committed intent must name current adopting A, and its previous pair must match the exact before-config B. Consequently current and claim-record coordinator are intentionally the same in this valid recovery fixture; do **not** fabricate an all-three-different prepared intent or relax reconciliation to make it pass. Instead assert the validated previous target explicitly and add negative three-different/foreign/inconsistent prepared fixtures that stop under existing gates. This tests the issue's targeting rule without expanding the transition topology.

## Real-host visibility acceptance procedure

The existing `test:adoption-host` must continue its offline packed-source load/public API/session/bus proof, with the new adapter included in declaration/type compatibility checks. Supplement it with actual component rendering and, where accessible, a disposable real-host/PTY check. No private host import is used by production code; a version-pinned test harness may inspect host implementation for diagnostic evidence without making it a runtime dependency.

If actual terminal frames cannot be asserted automatically, a reviewer/operator performs the following **before accepting AC3**:

1. Use an explicitly identified intended Pi 1.2.0 installation and temporary projects-home Git repository, temporary agent/session directory and fixture launch-role directories; no live board or installed-role modification. Load the candidate extension and a test-only role-local command shim using the real event-bus bridge. This shim must not bypass backend identity or supply answers. Any shim/harness stays test-only and is not shipped as another supported command.
2. Capture host/package/build/Node/OS and terminal dimensions/mode. Exercise all seven question kinds across first-board, self-declaration, ordinary adoption and prepared-after finalization fixtures. For visual-only checks cancel before the first effect; setup commits are fixture evidence, not real adoption. Use a separate visibility-only case for each later preview if needed.
3. Observe complete prompt body before input, type a few characters, page to every part and back, resize, then cancel. Check full target ID/expected sentence, authorising-record question, long multiline UUID/hash/roster/effects previews, explicit target labels and controls. Verify fresh blank state on re-invocation. Cover a 256-character ID and 40x12/80x24 terminal sizes; regular/fullscreen where supported. Check paste does not auto-submit or normalize the exact sentence.
4. Record pass/fail per scenario plus what automation did and did not prove in the adoption guide or linked review evidence. Screenshots/frame captures must use synthetic references and omit arbitrary authority contents. If the host clips/hides required text, record the defect, correct/prove the bounded/paged Pi-owned workaround, and rerun; do not mark AC3 complete based only on answers, typecheck, or load success.

## Verification commands for the implementation change

```sh
npm ci
npm run build
node --test tests/adoption-ux.test.mjs tests/adoption-ui.test.mjs
node --test tests/adoption-contract.test.mjs tests/adoption-bridge.test.mjs tests/adoption-runtime-extra.test.mjs tests/adoption-review-regressions.test.mjs
env -u PI_ROLE_DIR -u PI_INTERCOM_WORKER_ROLE npm test
npm run typecheck
npm run check:package
PI_ADOPTION_HOST_ROOT=<absolute-public-Pi-1.2.0-package-root> npm run test:adoption-host
# Plus the recorded real-host visibility smoke where frame inspection is not automated.
git diff --check
```

Use an implementation worktree with local dependencies installed; a bare new worktree does not share the root checkout's `node_modules`. Execute individual new fixture cases via `node tests/fixtures/adoption-runner.mjs <case-name>` as needed. A missing host installation is a reported blocker/manual requirement, not a skipped green rendering claim. Do not run unrelated cancellation-host probes or resurrect removed timing archives for this UX issue.

## Review gates, risks, and open questions

- Review the **policy call graph**: every declaration write/commit pre/post check receives the narrow policy, and every adoption/recovery path remains strict. Review the protected-namespace allowlist against producers; ignored status alone never approves it.
- Review the **consent call graph**: only captured local UI generates authorization; (a) has one yes/no, (b) has its new yes/no, and adoption retains typed reference + exact wording + exact transition. Changed survey requires new invocation, not new evidence synthesized from an old yes.
- Review the **visibility evidence** separately from backend functional evidence. The installed 1.2.0 input component ignores its placeholder, which explains the incident but does not prove the new renderer works. 0.84.4 development compatibility is not 1.2.0 visual proof.
- Keep phase-failure recovery tests: failure before effects versus after initialization, prepared commit, config publish, active write/commit, or promotion must have truthful diagnostics and never open readiness prematurely. No “nothing written” blanket message is introduced.
- No unresolved product/security decision is required by this proposal. Actual host rendering/smoke evidence and the exact producer-layout allowlist are implementation verification tasks, not permission to broaden scope. If public host APIs cannot provide the chosen visible interaction or preserving existing runtime allowances requires a broader policy change, stop and report that specific blocker before implementing an alternative.

## Planning deliverable verification

This branch contains only the three `0009-*` ADRs and this plan. Source/host files were inspected read-only; no implementation, build, test execution, live adoption, dependency installation or generated artifact change is claimed by this planning deliverable.
