# Issue #25: Minimal adoption removal plan

## Decision and scope

Implement [ADR 0025](0025-git-independent-adoption.md): **the coordinator config entry is the
whole authority; adoption replaces its `sessionId` and `port` after one native yes/no.** Remove
Git/claim/proof machinery without adding another persistence layer, registration or migration.
The human's [simple-and-stupid ruling](https://github.com/skatrych/pi-intercom/issues/25#issuecomment-6325707173)
supersedes the earlier ledger design and its review-correction tasks.

Status: **docs-only, awaiting mandatory independent review of the exact delivered SHA**.
Source locators are at `main@c6e414f22e09c7a9b50f1331eddd31b0f0e35d66`; recheck against the
implementation base before coding. This PR authorizes no runtime, board, installed-policy or
claim edits, no new probes and no live retest. Implementation is a subsequent assignment.

## 1. Remove, do not replace with a subsystem

| Source at base | Required change |
|---|---|
| `src/adoption.ts` claim types/renderers/parsers, `declarationEvidence`, `adoptionEvidence`, `leftUnchanged`, `ENDED_WORDING` | Delete evidence schemas, attestation wording/timestamps, transition UUIDs, historical pair/date, roster/job hashes and rebrief fields. Keep byte-preservation assertions in tests, not records |
| `writeCommit`, `commitClaim`, `readClaim`, `latestClaimCommit`, `readCommitRecord`, `previousClaimDate`, `verifyActiveAnchor`, `activeIntentProof` and supporting proof adapters | Delete the evidence writer/reader/history chain entirely; no replacement ledger/module/export |
| `claimEvidenceEstablished`, `bootClaimEvidence`, `committedActiveClaimMatches` | Delete and remove every boot/config/runtime call site, including synchronous final-effect Git checks |
| `assertGitSafe`, `blockers`, `statusEntries`, `unresolvedOperation`, `protectedSurface`, `inspectBoardNamespace`, Git policy/helpers and `reconcile` Git precheck | Delete; remove the recovery flow itself. No protected-file dirty exception or whole-board unknown-file allowlist |
| `survey`, `pathSnapshot`, `assertPaths`, `assertSnapshot` | Retain config/path/board-count and live runtime identity checks only. Remove HEAD/newest-claim/claim-worktree bindings and claim-path type checks. Git-only or obsolete-claim changes cannot stale a preview |
| `decide`, `bootstrap`, `declare`, `humanAdoptionDecision`, `transaction`, `reconcile`, prompt builders and phase seams | Collapse to initialization, already-current/load-only, collision/refusal, or replacement. Delete declaration, prepared intent, renewal, finalization and generated-record phases/prompts/results |
| `resolveIdentity`, `AdoptionOptions`, `src/index.ts` adoption wiring | Use captured native session id and bound endpoint, revalidated against the same current runtime/context. Remove adoption's persisted-header/session-file/per-cwd `SessionManager.list` requirement, self-health evidence probe and ordinary-turn-to-persist preamble. Do not remove session APIs still needed by worker resume |
| `src/config.ts:update`, `ConfigGuard` | Remove dynamic adoption-proof imports, legacy-absence discovery and claim-specific admission/final-publication guard phases. Retain locked current-coordinator permission, root/lock ownership, caller/lifecycle guards, config validation and final publication checks described below |
| `src/runtime.ts` authority state and wiring | Remove `readyClaimBytes`, `bootEvidenceReady`, claim readiness state, `authorityEpoch`, `actionEpoch`/`assertActionEpoch`, `callbackEpoch`, claim-related `configGuard` phases, and `assertActionAuthority`/`assertActionReady`/`openActionEpoch` authority machinery. Replace their permission effects with ordinary current-config checks, not renamed proof epochs |
| `src/adoption-ui.ts`, `src/index.ts` bridge | Retain captured-context routing and the existing No-first native selection. Shorten question/effect text; no evidence UI, new widget, input field or alternate entry path |
| Generated declarations/output | Rebuild `dist/` in the implementation PR; remove obsolete exports/types there by generation, not hand edits |

No config version bump, authority metadata, consent record, history import, private Git store,
capacity limit, artifact census, fsync protocol or benchmark project. **Keep `countBoards` at
startup and command survey/recheck: it is board isolation, not traceability.** Keep canonical
projects-home/cwd/root checks; no discovery above that boundary or private child initialization.
Keep current safe config/lock/temp path checks, not a directory-wide artifact scan.

## 2. One replacement path and its real effects

1. Check existing launch-role, interactive/trusted captured context, idle/concurrent-request and
   runtime lifecycle validity. Take id from this runtime/native session context, port from its
   actually bound endpoint, never arguments or a session-history search. Endpoint binding failure
   stops. An unconfigured Orchestrator may adopt directly: no registration/configure/reload
   prerequisite. Ordinary workers' registration protocol is not redesigned.
2. Count boards, read strict config and freeze its raw bytes plus old/new pair for this invocation.
   No board at projects home gets one initialization question; child/no-board stops. An already
   matching pair needs no question or declaration, just responsibility loading if necessary.
   Same id/different port stops; a configured worker id or any configured-entry port collision
   stops. Do not silently rebind a coordinator after endpoint port fallback.
3. For a replacement, probe the configured old pair. Matching live identity stops. Display old
   and new pair, root, two-token replacement and preservation of other entries/jobs. State that
   disconnected/unknown does not establish termination. Ask the existing single native No/Yes;
   yes authorizes replacement only. No typed/ended attestation or persisted answer.
4. On yes, acquire the existing all-writer transaction lock. Re-read strict config and compare
   the original raw bytes, current identity/endpoint and path/board-count snapshot. Recheck
   session/port collisions and probe old pair again. Recheck after the probe's await. On drift,
   stop with stale preview; do not merge concurrent roster updates or ask again in this run.
5. Call existing `replaceCoordinatorEntry` for the lossless two-token patch and guarded atomic
   publish. Keep the shared process queue + filesystem lock across recheck/probe/swap; all
   ordinary writers and initialization use that same lock. Keep temp write/sync/close, owned
   temp cleanup and existing bounded Windows publication retries. Revalidate lifecycle, paths,
   expected config and lock ownership before each rename attempt. Do not retry mutation/OS work.
6. After publication, read/load responsibility in place from the current entry. Verify it still
   names this runtime pair before reporting local readiness. No worker action, extension reload,
   job recovery, observer maintenance, report clear or work turn is part of adoption.

Initialization uses existing atomic no-replace config creation under that lock, only after its
one yes. It creates no claim. A repeated invocation seeing its own pair is load-only. Status
only reads/reports config and local load state; it asks nothing and performs no promotion/write.

### Replace proof sites without dropping permissions

The deleted machinery currently supplies real effect guards as well as obsolete claim proof.
Review each call site, not just imports. A cheap read/validation of the current config pair at
existing final-effect boundaries replaces that permission effect. It checks the bound root,
current runtime session/endpoint and coordinator entry; local responsibility is also required
where used. It does not inspect Git or retain a historical readiness generation.

| Boundary | Permission to retain |
|---|---|
| `ConfigStore.update` admission | Under the all-writer lock, read valid config and require current coordinator caller before mutating. No legacy-absence bypass or prepared-state check |
| Ordinary update after async mutation/temp close, and every publication retry | Re-read current config and verify admitted coordinator pair and expected pre-mutation config bytes are still current; otherwise refuse. Keep full caller/target/job guards. A queued old coordinator must not overwrite the replacement |
| Runtime startup/preflight, `promoteCoordinator`, `reload`, `coordinatorActionReady` callers | Config match, current lifecycle/root and loaded responsibility as applicable, not boot claim evidence. Matching config does not need a declaration. Anonymous/worker sessions gain no coordinator permission |
| `tool`, `transmit`, launch/send dispatch, status/success return and observation hooks | Recheck current config permission after awaits and immediately before the existing effect; do not authorize from a cached `me.coordinator`. An admitted coordinator request must still check if it has since become unconfigured, not fall through as worker traffic |
| `receive` registration/status/message, handoff callbacks/recovery, report queue/before-save/notification, reminder delivery | Preserve current recipient/sender, worker-target and close-job rules plus current coordinator permission at effects. No save/clear/registration change/model turn/reminder by the replaced coordinator |

Keep runtime `generation`/`validity`/`id` session-replacement checks and configured-root pinning;
these are lifecycle/root safety, not adoption authority epochs. Keep target-specific guards in
handoff/store callbacks; deleting a proof phase must not discard their predicates. Ordinary
worker-to-worker delivery/health stays usable and does not acquire coordinator-only requirements.
Do not extend the config lock over worker launch/send as a new global transaction; the bounded
old-endpoint re-probe inside the adoption transaction remains required.

The contract is cooperating local processes: final current-config checks reject revoked authority,
not an impossible guarantee of recalling an OS action already submitted or detecting coherent
config rollback. No new epoch/proof fence is introduced to cover that limitation.

## 3. Failure and old-file behavior

| Failure/state | Required outcome |
|---|---|
| No/Esc/dismiss, unavailable widget, malformed capture, wrong role/context, busy host, stale yes, collision, live old endpoint | Named refusal; no config replacement. Host/capture errors are not silently No or a text fallback |
| Foreign/abandoned/unreadable lock | `LOCKED`; no timeout/pid-based stealing or automatic repair |
| Invalid/unreadable/duplicate-key config or unsafe root/config/lock path | Config/path refusal; no implicit initialization/normalization |
| Temp/write/sync/close or definite pre-publication failure | No adoption success; current config remains authoritative. Clean only this call's owned temp |
| Atomic publish submitted, outcome uncertain | Report uncertainty, not rollback or zero effects. Stop; a later explicit invocation reads current config before deciding |
| Publish succeeded, session changed or promotion failed | Report config replacement separately from local failure/pending promotion. Do not revert. Matching pair retry loads only, with zero questions and zero config writes |
| Replacement occurred during a queued report/callback/reminder | Current-config permission refuses later effects. If report was already saved, preserve it and report stored-but-not-notified, no false delivery success/replay |
| Process interruption | Config is old or new complete JSON; a leftover lock still stops. After separate lock-owner resolution, old pair needs a fresh decision, matching pair loads only. No prepared/active recovery state |

These cases reuse existing atomic config semantics, not the withdrawn power-loss/directory-fsync
protocol. Do not claim new cross-platform durability from rename mocks or process-kill fixtures.

Legacy `coordinator-claim.md` is ignored in every branch, including prepared-before/after,
foreign/malformed/uncommitted bytes, missing file, symlink/directory and unreadable history.
No Git read is needed to classify old boards; the current config is enough. Leave the file
untouched by default. Optional one-time human deletion is a separately requested cleanup, not a
migration step, command prerequisite, second question or auto-unlink. Never follow a legacy
symlink or stage/commit its deletion. No runtime/import compatibility adapter remains.

## 4. Test rewrite inventory

Make a named-case disposition table in the implementation PR: **retain**, **rewrite to current
config**, or **delete as superseded**. Do not preserve every old behavior under new terminology.
The 108-case scenario count at this base is not a required minimum: deliberately shrink it and
update the count after removing obsolete cases and duplicate evidence phases.

| Existing surface | What shrinks / what stays |
|---|---|
| `tests/adoption.test.mjs`, `fixtures/adoption-runner.mjs`, `adoption-cases.mjs`, `adoption-fixture.mjs`, `adoption-support.mjs` | Remove claim builders, commit hooks, evidence fields/assertions, prepared/renew/finalize variants and record-only faults. Keep direct fresh-session success, role/context/idle checks, collisions, old probe/reconnect, config formats/duplicate keys, two-token preservation, jobs/history untouched, lock failures and publish/promotion failures. Unpersisted/wrong-header/store-missing-id become successful native-identity cases, not refusals |
| `tests/adoption-contract.test.mjs` | Replace claim-gate damage with obsolete-claim irrelevance and current-config mismatch/corruption controls. Delete failed-active-commit recovery, UUID/hash/timestamp evidence and claim-symlink-refusal expectations. Keep path drift, nested-board mutex, outer queue, queued old update, promotion load-only retry and concurrent log preservation |
| `tests/adoption-ux.test.mjs` AC1–AC6 | First-board still one question, no generated evidence. Existing self entry no longer asks declaration. Different old claim id has no display/authority role. Remove evidence-origin/ended wording/prepared renewal/finalization cases. Keep visible old/new config pairs, one question, No/dismiss/capture/host failures, fresh invocation, stale yes and live-old precheck |
| `tests/adoption-ux.test.mjs` AC7–AC9 | Replace strict adoption/recovery and staged/tracked/protected/unresolved refusal/diagnostic cases with positive zero-Git influence cases. Remove Git path-category diagnostics/schema-extreme evidence tests. Keep actual config-byte drift and actual unsafe config/board paths as independent negatives |
| `tests/adoption-review-regressions.test.mjs` | Delete newest/missing/dirty claim and intent-ancestry proofs, legacy-absence rediscovery, Git-context-discovery and authority-epoch close/reopen tests. Rewrite admission/final-temp-close/Windows retry/startup-port/after-save/launch-observation guards to revoke/change the actual config pair (or lifecycle/root). Retain independent store final check despite a throwing caller, full handoff target predicates and saved-vs-notified outcomes; do not test private authority epochs that no longer exist |
| `fixtures/adoption-runtime-cases.mjs`, `adoption-process.mjs`, `adoption-race-cases.mjs` | Collapse bootstrap/declaration/active-dirty/commit-failed/clean-advance barriers to before/after atomic config publication and local load. Replace cross-epoch stimuli with current-config replacement or lifecycle replacement. Claim changes are nonblocking. Keep separate-process writers/two adopters, stale-preview race, queued old writer, initialize race, lock ownership, config old/new interruption tests and worker routing old→new with no reload. Remove intent/claim crash boundaries |
| `tests/adoption-bridge.test.mjs`, `adoption-runtime-extra.test.mjs` | Keep captured UI/context/sole bridge, backend role authorization and no-board/above-home isolation. Remove ordinary-turn-to-persist prerequisite; prove a fresh native session reaches its one question without session-store evidence |
| `tests/adoption-ui.test.mjs`, `adoption-host.test.mjs`, dialog-host script | Keep No-first explicit activation, no text fallback, rendering/capture failures, captured selection wiring, package/host public API compatibility. Shorten text fixtures; remove declaration/recovery dialog variants and adoption-only persisted-session/listing proof. Retain session APIs' coverage where worker resume still needs them; no new live smoke gate |
| `tests/root-isolation.test.mjs`, `runtime-http.test.mjs`, `reports.test.mjs`, `reminders.test.mjs`, `core.test.mjs`, handoff/resume/package tests | Preserve unrelated behavior; add/retain current-config revocation at real final effects and startup. Claim file damage alone must no longer block actions. Keep ordinary worker registration, delivery, jobs and lifecycle checks |

### Small acceptance matrix

Use isolated disposable fixture roots only for later implementation tests; no shared board,
installed roles, credentials, external endpoints, model/provider calls or live workers. Nothing
in this matrix was run for this docs change.

- Across initialization, adoption, already-current/load-only, status, boot and subsequent actions:
  clean/dirty/untracked/ignored; staged unrelated/config/claim paths; mixed index and unmerged
  entries; merge/rebase/cherry-pick markers; locked/unreadable index; unborn/detached HEAD;
  ancestor/linked repo, no repo, absent/failing Git executable and injected `GIT_*`. Same current
  config/runtime/answer gives same branch, question count and result. Production Git invocation
  count is zero (async and sync child-process spies); no Git-marker inspection either.
- Snapshot fixture index/refs/metadata and unrelated files outside production code; all remain
  byte-identical. Non-obstructing extra board artifacts are not an allowlist refusal. Legacy
  claim variation alone, including changes while UI is open, never changes the result or bytes.
- Negative controls without a repository: actual config drift/corruption, session/port collision,
  reconnecting old endpoint, unsafe/changed root/config/lock, second/wrong/empty board and changed
  native session/endpoint. Refuse before replacement; no second question in the invocation.
- At temp close, retry, send/launch observation, queued report before-save/after-save and reminder/
  handoff callback boundaries, replace the actual config pair. Old process cannot perform the
  next coordinator effect; preserve already-submitted/stored outcomes honestly, no replay.
- One atomic swap changes exactly two tokens, workers/jobs/logs/reports/session files untouched;
  failure to load retries with no write/question. Two competing adopters produce one swap;
  a queued former-coordinator writer cannot restore its entry.

## 5. Delivery, docs and review

Future implementation updates pi-intercom README/reference, stale result/error text and
supersession notes for ADR0009/0012 with the implementation, not this PR. Require independent
review of the final code/test SHA and normal test/type/package gates on an explicit host version.
Do not infer compatibility from installed package docs or silently skip a missing host gate.
No installation, live adoption or new UX smoke is bundled into review. Coordinate an ordinary
version upgrade for cooperating publishers; do not claim mixed-version safety when older code
still reads claims. Config stays version 1: there is no migration/downgrade data protocol to build.
A code rollback would restore old claim gates, not recover authority through history.

**Separate docs-alignment issue, not PR28 scope:** swactory Orchestrator instructions and
coordinator-adoption skill; ADR0005/0009-C/0012 claim/evidence/Git references;
`docs/artifact-atlas.md` coordinator-claim/tenure/path-scoped commits description; projects-home
claim file and instructions requiring it. Record obsolete status/optional human deletion without
rewriting historical ADR provenance. Do not edit those sources, installed copies or live claim
in this two-doc PR. Worker lease cleanliness and lifecycle policies stay unchanged.

This delivery commits/pushes only `docs/adr/0025-git-independent-adoption.md` and this plan on
`feature/25-git-independence-plan`; PR28 remains the single vehicle. Check relative links,
`git diff --check`, docs-only diff and clean tree/index after commit. Handoff exact SHA/diff stat
and validation limits to Coordinator, then wait for mandatory independent review dispatch.
Runtime/test/build validation and AC3 acceptance remain outstanding.
