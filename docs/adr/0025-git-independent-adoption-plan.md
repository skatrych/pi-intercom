# Issue #25 AC3 — bounded implementation and verification plan

Status: **proposal only**, paired with [ADR 0025](0025-git-independent-adoption.md).
Base: `main@c6e414f22e09c7a9b50f1331eddd31b0f0e35d66`. No runtime code, tests, build output,
policy, installed configuration, claim or live board is changed by this documentation.

## 0. Scope and release gates

1. Independent Architect review of this exact docs SHA under both gates: (a) it satisfies the
   literal zero-cleanliness requirement without hidden dirty refusals; (b) it preserves authority,
   identity, one-question, durable recovery/integrity and existing effect fences, or explicitly
   identifies a human decision where compatibility conflicts. A draft PR is not approval.
2. Human disposition of ADR decisions 1–3: durable ledger instead of project commits; explicit
   migration/schema/token-patch and active-path-question exceptions; conservative unavailable
   legacy-proof boundary. Record the actual response, never infer it from the existing AC3 ruling,
   the accepted UX smoke, PR92 merge or installation. A declined ledger proposal returns to design,
   not a partial implementation of “ignore some dirt.”
3. Separately authorize implementation against a fresh recorded integration-branch SHA. Confirm
   there are no intervening adoption/authority changes; re-inspect all locators below. Implement
   only the selected design. Do not use this plan as permission for a live migration.
4. Source policy/runbook alignment, independent verification, human merge/release and human-operated
   installation/cutover are distinct gates. PR92's current installation action remains separate.
   Do not add a new live retest demand for the accepted native yes/no behavior.

In scope: one authority persistence adapter/schema and migration path; all existing readers and
final-effect proof sites; Git-independence and crash/integrity regressions; precise source docs and
release compatibility notes. Out of scope: root-launch #27, isolation/topology redesign, worker
lifecycle/cancellation, unrelated UX, automatic credential/settings/installer edits, arbitrary
board cleanup, Git archival/export, new endpoints/tools/commands, distributed locks or hostile-user
protection. Worker lease clean-tree rules remain unchanged and are not adoption gates.

## 1. Freeze executable contracts before replacing persistence

Inventory and retain tests at the base in:

- `tests/adoption.test.mjs` and `tests/fixtures/adoption-{cases,fixture,support,runtime-cases}.mjs`;
- `tests/adoption-contract.test.mjs`, `adoption-bridge.test.mjs`, `adoption-runtime-extra.test.mjs`;
- `tests/adoption-review-regressions.test.mjs`, `adoption-ux.test.mjs`, `adoption-ui.test.mjs`;
- `tests/root-isolation.test.mjs`, `runtime-http.test.mjs`, `reports.test.mjs`, `reminders.test.mjs`,
  `core.test.mjs`, plus existing package/host gates.

Make a trace table mapping each current named test/fence to retained test, new-format replacement,
or explicitly superseded Git behavior. Do not merely delete failing cases. For example:

| Base expectation | New-format replacement / retained legacy check |
|---|---|
| AC7 strict adoption/recovery refuses the same scratch allowed by declaration | All branches succeed with same scratch preserved; this negative expectation is deliberately superseded |
| AC8/9 staged/tracked/untracked/unresolved refusal and path diagnostics | Positive independence matrix, including staged claim and protected paths; keep independent config/path/record failures |
| Claim gate: dirty-valid/newest-malformed/deleted-latest/uncommitted-active/wrong-pair | Ledger byte tamper/malformed newest/missing referenced newest/orphan publication/wrong pair; legacy committed malformed/deleted newest still refused on import |
| Failed active Git hook + exact derived active recovery | Inject failure at active ledger object/head/sync; same command finalizes once from anchored prepared proof; no second swap |
| Prepared-before/after, foreign intent, promotion failure | Same meanings with ledger digests, plus migration intermediate states |
| Newly appeared Git context/history forces ordinary legacy update refusal | Retain only for unconverted v1; new-format authority stays bound to its ledger and never consults Git |
| Malformed newest claim after admission/probe/save/observation closes epoch | Tamper newest ledger evidence at the same barriers; stale local epoch alone never approves effects |

Preserve adapter/native-widget tests as-is except text fixtures replacing project-commit effects
with accurate durable-ledger effects and a migration variant. Exactly one question per deciding
run, zero for status/active promotion, no input member, no terminal text fallback. The migration
exception for an otherwise-active v1 board is explicit, not a regression hidden by fixture edits.

## 2. Implement a small internal authority store (reviewable patch A)

Proposed new module: `src/authority.ts` (name non-contractual). Export a typed snapshot/proof and
append operation, not a model/user writer. Freeze exact config-v2/claim-v2/migration schemas and
canonical rendering in this patch, including numeric read/history/output bounds and error codes.
Use domain errors for storage unavailable, integrity violation, stale preview, unresolved recovery
and legacy provenance unknown; do not infer result codes from prose or turn uncertainty into absence.

Requirements:

- Board identity/format/genesis binding in config; immutable canonical digest-named objects;
  head with generation and expected predecessor; linked prepared/active proof; exact config
  transition hashes/untouched roster, closeJob and authority evidence. Retain legacy v1 bytes
  verbatim inside a separately identified import envelope; never overload Git-id fields.
- A fresh async read and synchronous final-effect read use **one validation specification**, as
  current async/sync Git proof adapters do. Read the head before/after the proof to detect change;
  full record/chain availability and integrity are re-proved at every effect guard. Validate root,
  file type/no links, canonical bytes, storage id, sequence, predecessor/prepared linkage, and
  exact active derivation. No approval based only on cached head/hash/mtime or parse success.
- Under the existing config transaction lock, exclusively create/sync/close object temp; verify;
  no-replace publish immutable object; sync directory; CAS expected head; sync/close head temp;
  guarded atomic head publication and directory sync; re-read proof. Reject incomplete scans or
  bounded-out proof with a named ledger failure, not a claim that unseen evidence is valid.
- Inventory surviving reserved record names sufficiently to detect a head rewound while newer
  objects survive, forks and orphan publications. Non-record artifacts that obstruct no required
  path remain untouched/nonblocking, even inside the ledger directory; no filename allowlist for
  unrelated files. Do not silently choose an older valid record. A valid orphan is a recovery
  candidate, not current authority. A crash after head rename but before
  sync is outcome-unknown; classify from durable evidence on explicit reinvocation, never retry
  inside the failed run or claim a successful durable publication.
- Reuse safe path and lock ownership mechanics, not Git `protectedSurface` dirt classification.
  Snapshot authority/config/ancestor identity only; leave non-obstructing board artifacts and
  concurrently appended logs/reports alone. Never unlink a foreign-looking temp or lock.
- Validate the durability platform contract with real isolated filesystem tests. If directory
  sync/no-replace cannot meet it on a supported platform, stop and surface that implementation
  blocker before rollout. No “best effort” publication grants readiness. Do not conflate process
  crash/restart with power-failure testing or claim cross-platform proof from Linux.

For new-board bootstrap, prepare the exact config bytes/binding without publishing them. Publish
a bootstrap-prepared intent first, then initialize that config at most once, then active evidence.
The schema must represent declaration/bootstrap prepared records without asserting termination;
this differs explicitly from v1's prepared-adoption-only schema. The sole command must recognize
verified pending bootstrap ledger + no config (which currently fails generic config parsing),
bootstrap intent + exact initialized config, and established v2 config + missing ledger. Only
the first two are recoverable bootstrap states; the last is evidence loss, not a new declaration.
A recognized pending bootstrap asks one contextual recovery question, initializes only if still
absent, finalizes without repeated creation and leaves readiness closed on every uncertain step.

Patch A can have unit tests without changing runtime authority. It cannot ship a callable second
writer. All steps remain unused until integration is reviewed; do not run them on shared state.

## 3. Integrate every writer/reader, not only adoption (patch B)

| File / locators at base | Work |
|---|---|
| `src/adoption.ts:survey`, `readClaim`, `assertSnapshot`, `decide` | Select backend from validated format, not Git detection/cache; snapshot ledger head/config/path/session. Remove project HEAD binding for new format; ignore legacy root-claim bytes after import |
| `bootstrap`, `declare`, `transaction`, `reconcile`, `writeCommit`, `commitClaim` | Replace commits with ledger publication protocol; remove status/index/unresolved/root-repo gates in every branch; preserve ordered prepared → pair patch → active → promotion |
| `assertGitSafe`, `blockers`, `inspectBoardNamespace`, Git policy helpers | Remove from new-format call graph; no whole-board unknown-file allowlist as surrogate cleanliness check. Retain only genuinely used legacy read-proof code, with no status queries |
| `claimEvidenceEstablished`, `bootClaimEvidence`, `committedActiveClaimMatches` | Shared format-aware authority proof; new-format missing head/object is never legacy absence; no Git calls/markers/env checks for v2 |
| `src/config.ts:validateConfig`, scanner/patcher, `initialize`, `update`, `replaceCoordinatorEntry` | Add supported format-v2 metadata, preserve byte-lossless pair patch for normal adoptions; admission and final publication/retry proof use ledger; metadata cannot be changed by ordinary mutations |
| `src/runtime.ts:assertActionAuthority`, `assertActionReady`, `openActionEpoch`, startup/adoption wiring | Pin verified ledger head/identity, not root markdown; preserve responsibility, pair, epoch and final-proof fencing across all awaits/callbacks/reminders |
| `src/index.ts:adoptionContext`, offer registration, `SessionManager.list` wiring | Keep captured context and sole bridge. No caller-supplied identity/path/port/confirmation or new API. Continue persisted header + per-cwd listing + endpoint checks |
| `src/adoption-ui.ts`, branch prompt builders | Retain selection implementation/one-question contract; update effect words and migration context only, no unrelated visual changes |
| `dist/` | Generated output only in the implementation PR, built after source; no hand-edited build files |

During preview and again under the lock: authorize role/mode/trust/idle/persisted session,
validate exact backend-selected pairs and collisions, show old-endpoint warning, then bind one
captured yes to immutable preview/transition/hash/effects. No probe result asserts termination.
If Git alone changes while a question is open, continue from unchanged authoritative snapshot;
if config/ledger/identity/path/epoch changes, refuse stale yes. No automatic re-preview/re-ask.

Re-check current proof at admission and the last existing final-effect boundary: ordinary config
publication (including Windows retries), status/result returns, launch/send dispatch, callbacks,
report before-save/after-save notification, reminder delivery. Preserve the current distinction
between invalidation **before** dispatch (refuse effects) and **after** an admitted composite OS
operation (no fictional cancellation, rollback or duplicate retry). No worker lifecycle changes.

## 4. Legacy conversion and crash protocol (part of patch B, separate review section)

Use only bounded read-only Git commands against explicitly selected canonical projects-home
repository metadata; scrub repository/context/config injection for this adapter without touching
global settings. Validate the discovered repository boundary, newest claim commit, canonical bytes,
active prepared ancestry and exact board/pair/hash semantics. Git exit/error/truncation/timeout or
missing metadata is provenance unknown, not never-adopted. Unrelated HEAD movement is irrelevant;
a changed newest **claim anchor** invalidates preview. Never query status/index cleanliness.

A verified history-free v1 board can follow its appropriate first-declaration/adoption branch,
with conversion included in the same question. A v1 board with no readable repository cannot
prove that classification and stops; a fresh v2 bootstrap needs no repository. V1 staged/dirty/
missing/obstructed markdown does not veto valid committed-object import; leave all its bytes and
index entries alone. New-format config/ledger proof does not inspect that markdown at all.
Retain the existing admissible ordinary-adoption case with current session A, configured board
B and differing historical active claim C; show all three, target B, and do not manufacture an
all-three-different prepared recovery fixture. Prepared recovery's exact pair/hash rules stay.

Before coding, specify migration envelope and these crash states in tests. The envelope must
bind the legacy anchor, original v1 raw-config hash, upgraded-v2 **old-pair** config hash, final
v2 **new-pair** hash where adoption is needed, operation kind, same transition and the captured
combined migration/operation decision. The format upgrade is separate from pair replacement:

| Last published state | Recovery obligation |
|---|---|
| No ledger commit; v1 config unchanged | No migration/adoption success; original evidence remains; foreign partial files stop or form a specifically proved recovery candidate |
| Migration/prepared head durable; v1 config unchanged | Upgraded readers fence ordinary action on pending migration; renew one question under same transition, then publish the bound format upgrade; never treat v1 as legacy absence |
| Version-2 config with old pair; prepared/migration head durable | Explicitly recognize the bound intermediate hash; renew one decision and replace pair at most once; do not confuse it with unrelated config drift |
| Version-2 config with new pair; prepared head durable | One evidence-only finalization question; no replacement; preserve original ended attestation |
| Active head durable; local promotion missing | Write-free, zero-question retry; no config/ledger rewrite |
| Migration-only of matching active v1 | One migration question, no new termination claim/pair replacement; retain original authority verbatim and record migration authorization separately |
| Any unknown config hash, foreign adopting session or inconsistent envelope/head | Stop for routing; no silent repair, second writer, normalization or approval from v1 worktree |

This must preserve exact before/intermediate/after bytes, not merely pairs. Subsequent worker
entry changes are not merged into a stale migration preview. A newly upgraded process must
recognize pending ledger evidence even while config remains v1, including ordinary writers
that would otherwise take the legacy bypass. Roll out compatible code to all publishers first.
Old processes that ignore this state are unsupported during cutover; `version: 2` rejection by
old schema is defense in depth, not a proven mixed-version migration fence.

## 5. Fixture matrix and acceptance oracles

All new probes must use disposable nonsecret temp roots with scrubbed HOME/agent/session and
Git context. No parent-board discovery, shared projects-home config/claim, installed role,
credentials/settings, model/provider calls or external endpoints. Domain identity/probe seams
are deterministic. Any existing runtime integration fixture's listeners must be isolated,
bounded loopback only when separately authorized for implementation tests; none ran for this
analysis. Track owners/removal points; cleanup only declared fixture roots, verify removal.

### Positive Git-independence matrix

Cross bootstrap, existing-self declaration, ordinary adoption, prepared-before renewal,
prepared-after clean/derived completion, active promotion/status and post-adoption action proof
against all applicable rows below. Use a shared data table so no branch silently keeps strict
policy. Existing-self declaration is a verified history-free v1 conversion, or completion of an
anchored v2 bootstrap; an established v2 board with deleted ledger is not a declaration fixture.

| Vary Git state only | Required oracle |
|---|---|
| Clean vs tracked unstaged change/delete/rename/type change; unrelated untracked/ignored install/scratch; nested clone/submodule dirt | Identical branch/result/readiness and question count; unrelated bytes retained |
| Staged unrelated/claim/config/ledger path; staged+unstaged different bytes; intent-to-add; staged rename; unmerged index entries | No refusal because staged; byte-for-byte index and referenced staged blobs unchanged; no stage/reset/commit/sweep |
| Merge/rebase/cherry-pick/revert/bisect markers, detached/unborn HEAD, `.git/index.lock` | No inspection/gating on these; all Git metadata untouched |
| No repo, ancestor repo, linked worktree, bare/damaged `.git`, read-only Git metadata, injected foreign Git context | V2 success/proof unchanged; no Git invocation. Filesystem authority root/path rules still enforced |
| Git command seam throws, exits nonzero, hangs, returns truncated output; missing executable | V2 never calls seam, including boot/config/async/sync final proof; no delay/failure caused by Git |
| Unrelated HEAD commit/index change while question open or before final proof | Accepted yes remains valid if authoritative snapshot unchanged; no `STALE_PREVIEW` from HEAD |

Capture Git object/ref/index/metadata hashes **from fixture test code**, outside production call
graph; production v2 Git invocation count must be zero, including child-process spies on sync
and async spawn and injected `GIT_*`. Disable optional Git locks/refresh in fixture-side read-only
oracles and compare raw index snapshots so the test oracle itself does not alter the index.
When Git is intentionally unavailable, compare saved fixture file bytes directly. The only allowed writes are declared config/ledger temps, lock
protocol and durable evidence; no root markdown view is created/rewritten. Holding `.git` read-only
must not be confused with holding the authority filesystem read-only.

### Independent negative controls (not dirty-tree tests)

- Config/ledger bytes or head changes during UI, under-lock recheck, sync/rename await or final
  dispatch: stale/integrity refusal; same test in a non-repository. Actual unsafe file types,
  symlink/root/ancestor swaps, second/wrong board and lock-owner changes still refuse.
- Same bytes with staged versions differing: positive. Actual authoritative corruption with
  Git clean: negative. This paired oracle prevents “protected dirt” from sneaking back in.
- Malformed/noncanonical newest object/head; missing newest object; newest deletion with old
  valid bytes restored; missing prepared ancestor; wrong board/storage id/pair; unlinked active;
  head rewind with surviving descendants; fork/gap; oversized/truncated/failed proof. Never
  select the older valid object or infer absence. Coherent total-store rollback is the ADR's
  explicit threat-model limit, not a passing integrity test.
- Role/mode/trust/session persistence/list/header/endpoint, old connected precheck/re-probe,
  session/port collisions, busy/concurrent request, identity/epoch loss: existing named refusals.
- No/Esc/dismiss, HOST/CONFIRMATION failure and stale yes: no authorized writes. No text input;
  fresh invocation is required, not another prompt in the same run. Migration variants included.

### Durability/recovery injection

Inject failures/barriers at exclusive open, short write, sync, close, immutable publish,
directory sync, head CAS/temp/sync/rename, config stage/rename/platform retry, active object/head
publication and promotion. Kill only disposable fixture children at designated boundaries;
restart against their temp state. Assert exact persisted phase, never false success, no active
readiness on uncertain publication, same transition, old/new/intermediate exact hashes, no
second pair replacement, no regenerated ended evidence on finalization, no cleanup/replay.
Test bootstrap crashes before/after initial config publication and active evidence, including
no second initialize and no false first declaration after deleting established evidence.
Test prepared-before renewal and clean/derived prepared-after with both successful and repeated
failed finalization. A promotion failure must leave verified active head and permit only
write-free retry. Document untested filesystem/power-loss/platform cases, not inferred passes.

Retain admission-epoch/report regressions: blocked requests fail before save/clear/success;
a saved report whose notification is blocked remains stored and reported as such. Tamper the
ledger after admission, during status/probe awaits, after report save and at observation hooks.
No model turn/reminder/dispatch from stale authority; preserved roster/jobs/logs/reports/session
history match seeded hashes except declared concurrent log append. No worker send during adoption.

## 6. Documentation, rollout, rollback (patch C and human actions)

Implementation source docs must update README/reference/ADR links, effects/result terminology,
new-format guarantee and legacy limits. A separately reviewed swactory source-policy change
must replace committed-Git wording in `roles/orchestrator/AGENTS.role.md` and its
`skills/coordinator-adoption/SKILL.md` with approved durable-ledger proof; distinguish authoritative
corruption from Git dirt. Do not install/edit live copies or waive the current policy as part
of runtime implementation. Keep one runbook, one entry path and separate human installation.

Run isolated tests with explicit outer deadlines, serialized after build:

```
env -u PI_ROLE_DIR -u PI_INTERCOM_WORKER_ROLE npm test
npm run typecheck
npm run check:package
PI_ADOPTION_HOST_ROOT=<reviewed isolated public Pi package root> npm run test:adoption-host
# Only if separately authorized as a non-live, synthetic fixture:
timeout 45s npm run test:adoption-dialog
```

Record exact source/build SHA, host versions (pinned 0.84.4 vs previously checked public 1.2.0,
not inferred from locally read 1.3.0 docs), command statuses, test counts/skips and byte-diff scope.
No install/provider call is authorized by this command sketch. Check all new fixtures are in the
normal test invocation. Static call-graph review and zero-Git spies must cover both proof adapters
and all runtime/config effect sites, not only passing domain examples. Independent reviewers
must inspect the exact final SHA; missing host/platform prerequisites are disclosed limits.

Before human cutover: obtain durable external backup of config + complete ledger/legacy evidence
and a written supported-version recovery procedure; identify every publisher and quiesce/upgrade
through normal authorized operations. Never instruct agents to kill workers/rewrite claims as a
shortcut. An unresolved old lock remains a separate human investigation. Release/pin/runbook
installation is human-operated; do not bundle a live adoption or mandatory UX smoke into review.

Rollback boundary:

- Before any new-format/pending-migration write: revert implementation via normal reviewed code
  workflow; existing legacy state remains authoritative. No board migration was performed.
- After a pending ledger write: older code must not be used to ignore it. Preserve all bytes,
  fence authority and route recovery with the compatible version. No automatic unlink/revert.
- After config v2 publication: binary downgrade cannot read v2 and is intentionally unsupported;
  restoring v1 would resurrect stale authority/history. Prefer forward repair under the same
  command/recovery protocol. Disaster restoration needs a separately reviewed human procedure,
  verified quiescence and coherent evidence/config recovery, never a Git reset/clean or blind
  backup restore while processes may act. No reverse converter is proposed in this scope.

## Delivery evidence for this planning change

Only the two `docs/adr/0025-*` files are deliverables. Validation for this change is source/issue/
public-document inspection, local relative-link checks, whitespace diff check, docs-only diff
and clean tree/index after commit. No runtime/fixture/host test was executed; implementation,
crash behavior, migration, SDK compatibility and AC3 acceptance remain unproved. Handoff names
exact committed SHA and diff stat; coordinator owns push/draft PR and subsequent independent review.
