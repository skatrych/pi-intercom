# #25 — Implementation Plan

## Decision and scope

Implement the [Proposed Solution](25-proposed-solution.md) and
[ADR 0025](../adr/0025-git-independent-adoption.md): **the coordinator config entry is the
whole authority; adoption replaces its `sessionId` and `port` after one native yes/no.** Remove
Git/claim/proof machinery without adding another persistence layer, registration or migration.
The human's [simple-and-stupid ruling](https://github.com/skatrych/pi-intercom/issues/25#issuecomment-6325707173)
supersedes the earlier ledger design and its review-correction tasks.

Status: **docs-only, awaiting mandatory independent review of the exact delivered SHA**.
Source locators are at `main@c6e414f22e09c7a9b50f1331eddd31b0f0e35d66`; recheck against the
implementation base before coding. This PR authorizes no runtime, board, installed-policy or
claim edits, no new probes and no live retest. Implementation is a subsequent assignment after
independent review and human design approval/merge. Earlier approval covers the old snapshot,
not this review-comment revision.

## Operational contract

For existing-board coordinator replacement, keep the sole human entry path: role-local
`/intercom-adopt` → `Intercom.adoptCoordinator`. First-board startup is automatic, not adoption.
No model tool, HTTP writer, second command, caller-provided identity/port or confirmation flag.
Capture the native session id and actually bound port; verify that port with the existing bounded
loopback identity probe. No adoption registration, persisted-session proof, session-store listing
or evidence record. Show the projects-home board, configured old
pair, actual new pair and replacement effect in the existing native No-first question.
No/Esc/dismiss changes nothing. No typed wording, termination attestation, UUID, recorded answer,
prepared-intent, renewal or finalization question.

| Current config state | Behavior |
|---|---|
| No config, cwd is safe projects home | Runtime startup uses atomic no-replace creation, then loads responsibility; no adoption command, question or claim. A later command seeing removed config stops and requests restart |
| No board in a child cwd | Stop; do not create a board |
| Coordinator pair already equals this runtime pair | Already authorized by config; no declaration/question/write; load responsibility if needed |
| Same session id but different endpoint port | Identity mismatch; do not silently rebind it |
| This session id is a configured worker | Session collision; no worker promotion/removal/rebind |
| Different coordinator, fresh unconfigured session and unused port | One adoption yes/no, locked recheck/probe, one atomic pair replacement |
| Invalid/unreadable config, unsafe path, foreign lock or stale preview | Stop; no repair, lock stealing or stale-answer reuse |

`countBoards` counts `.pi-intercom` directories from cwd to projects home, including empty or
malformed extra boards. It is board isolation, not traceability. Refuse second/wrong boards or
outside/aliased roots; never discover above projects home, create a private child board, or scan
unrelated files as an adoption namespace policy. Diagnostics name the expected projects-home
root and every offending `.pi-intercom` path. Say a human may remove a confirmed empty,
unintended stray and retry; populated/malformed data needs separate investigation/preservation,
not recursive deletion. Never clean up automatically. Existing role/trust/interactive-context,
lifecycle, canonical path and strict-config checks remain prerequisites for adoption.

### First-board source basis

Inspected [upstream `runtime.ts` at `6af57284`](https://github.com/mbundgaard/pi-intercom/blob/6af57284abe93db37dee36015f808ddf688fc840/src/runtime.ts)
`Intercom.start`: discover config, bind the actual endpoint, call `store.initialize` when
`previous` is absent, read config, enter coordinator startup/load. There is no adoption command
or prompt. [Upstream `config.ts`](https://github.com/mbundgaard/pi-intercom/blob/6af57284abe93db37dee36015f808ddf688fc840/src/config.ts)
`initialize` writes/syncs/closes a complete temp and uses no-replace `link`; `EEXIST` reads the
winner, never overwrites it. Fork source at the stated base already has this primitive; its
Orchestrator `preflight` hold and adoption `bootstrap` question are the divergence to remove.

Restore that runtime startup path only at the canonical projects-home cwd, after launch-role,
root/path/lifecycle and ancestor-board checks and successful endpoint binding. Absence means
missing config (`ENOENT`), not parse, permission or path failure; an existing empty root metadata
directory is allowed, but never an extra child board. Preserve no-replace publication under the
shared writer transaction; recheck path/board layout before creation. If another initializer
wins, read valid config and require this exact pair before local coordinator effects; otherwise
hold for normal existing-board adoption, with no automatic replacement or question at startup.
Do not load/act as another initializer's coordinator. If `/intercom-adopt` later sees no config,
stop with restart guidance; it is not a second bootstrap entry path. No claims, extra startup
consent or session-history proof. Existing malformed/unreadable config remains an error.
This implements [Captain's two inline requests](https://github.com/skatrych/pi-intercom/pull/28#discussion_r4366725494)
without changing fork root isolation or ordinary explicit-worker behavior.

Existing-board replacement changes only `sessionId` and `port`: preserve coordinator name/description and all
other config bytes, workers and jobs. Loading responsibility in place must not restart/reload
workers, send work, clear reports, rewrite jobs or start a model turn. Status is read-only:
report current config/identity and whether local responsibility is loaded, never classify claims,
promote, ask a question or write.

## 1. Remove, do not replace with a subsystem

| Source at base | Required change |
|---|---|
| `src/adoption.ts` claim types/renderers/parsers, `declarationEvidence`, `adoptionEvidence`, `leftUnchanged`, `ENDED_WORDING` | Delete evidence schemas, attestation wording/timestamps, transition UUIDs, historical pair/date, roster/job hashes and rebrief fields. Keep byte-preservation assertions in tests, not records |
| `writeCommit`, `commitClaim`, `readClaim`, `latestClaimCommit`, `readCommitRecord`, `previousClaimDate`, `verifyActiveAnchor`, `activeIntentProof` and supporting proof adapters | Delete the evidence writer/reader/history chain entirely; no replacement ledger/module/export |
| `claimEvidenceEstablished`, `bootClaimEvidence`, `committedActiveClaimMatches` | Delete and remove every boot/config/runtime call site, including synchronous final-effect Git checks |
| `assertGitSafe`, `blockers`, `statusEntries`, `unresolvedOperation`, `protectedSurface`, `inspectBoardNamespace`, Git policy/helpers and `reconcile` Git precheck | Delete; remove the recovery flow itself. No protected-file dirty exception or whole-board unknown-file allowlist |
| `survey`, `pathSnapshot`, `assertPaths`, `assertSnapshot` | Retain config/path/board-count and live runtime identity checks only. Remove HEAD/newest-claim/claim-worktree bindings and claim-path type checks. Git-only or obsolete-claim changes cannot stale a preview |
| `decide`, `bootstrap`, `declare`, `humanAdoptionDecision`, adoption `transaction`, `reconcile`, prompt builders and phase seams | Move first-board creation to ordinary runtime startup; remove adoption bootstrap/question. Command becomes already-current/load-only, collision/refusal, replacement, or no-config/restart guidance. Delete declaration, prepared intent, renewal, finalization and generated-record phases/prompts/results; retain ConfigStore writer serialization |
| `resolveIdentity`, `AdoptionOptions`, `src/index.ts` adoption wiring | Use captured native session id and bound endpoint, revalidated against the same current runtime/context. Remove adoption's persisted-header/session-file/per-cwd `SessionManager.list` requirement and ordinary-turn-to-persist preamble; retain the existing bounded bound-port identity probe as a cheap port-in-use check. Do not remove session APIs still needed by worker resume |
| `src/config.ts:update`, `ConfigGuard` | Remove dynamic adoption-proof imports, legacy-absence discovery and claim-specific admission/final-publication guard phases. Retain locked current-coordinator permission, root/lock ownership, caller/lifecycle guards, config validation and final publication checks described below |
| `src/runtime.ts:start` / `preflight` no-board hold and coordinator `port_update` | Restore automatic safe-root initialization as above. Remove session-id-only fallback port repair; exact-pair mismatch remains held/refused with the recovery diagnostic in §3, not silently un-fenced |
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
   actually bound endpoint, never arguments or a session-history search. Binding failure stops;
   keep the existing bounded probe of that port and require this native session identity. A live
   different coordinator/identity or unverifiable own endpoint refuses; diagnostic says to restart
   Pi and retry, and report a persistent identity/bind failure rather than bypassing it. An unconfigured
   Orchestrator may adopt directly: no registration/configure/reload
   prerequisite. Ordinary workers' registration protocol is not redesigned.
2. Count boards, read strict config and freeze its raw bytes plus old/new pair for this invocation.
   No config stops with startup/restart guidance; only runtime startup creates the first board.
   An already matching pair needs no question or declaration, just responsibility loading if needed.
   Same id/different port stops; a configured worker id or any configured-entry port collision
   stops. Name conflicting entry, session id, port and board path; no automatic removal/rebind.
   Resolve a stale worker through established lifecycle/configuration maintenance, or restart this
   session on a non-conflicting port. Binding/own identity does not revoke a configured identity.
   Do not silently rebind a coordinator after endpoint port fallback.
3. For a replacement, probe the configured old pair. Matching live identity stops. Display old
   and new pair, root, two-token replacement and preservation of other entries/jobs. State that
   disconnected/unknown does not establish termination. Ask the existing single native No/Yes;
   yes authorizes replacement only. No typed/ended attestation or persisted answer.
4. On yes, acquire the existing all-writer transaction lock. Re-read strict config and compare
   the original raw bytes, current identity/endpoint and path/board-count snapshot. Recheck
   session/port collisions and bound-port identity, and probe old pair again. Recheck after the
   probe's await. On drift,
   stop with stale preview; do not merge concurrent roster updates or ask again in this run.
5. Call existing `replaceCoordinatorEntry` for the lossless two-token patch and guarded atomic
   publish. Keep the shared process queue + filesystem lock across recheck/probe/swap; all
   ordinary writers and initialization use that same lock. Keep temp write/sync/close, owned
   temp cleanup and existing bounded Windows publication retries. Revalidate lifecycle, paths,
   expected config and lock ownership before each rename attempt. Do not retry mutation/OS work.
6. After publication, read/load responsibility in place from the current entry. Verify it still
   names this runtime pair before reporting local readiness. No worker action, extension reload,
   job recovery, observer maintenance, report clear or work turn is part of adoption.

Runtime initialization uses existing atomic no-replace config creation under that lock, with
zero questions, as specified above. It creates no claim. An adoption invocation seeing its own
pair is load-only. Status only reads/reports config and local load state; it asks nothing and
performs no promotion/write.

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

Use a shared current-coordinator permission helper where appropriate to avoid divergent checks;
its name/factoring is a Developer choice. The table is a call-site checklist, not permission to
reduce it to send/report/reminder only or to apply coordinator-only checks to ordinary workers.

Keep runtime `generation`/`validity`/`id` session-replacement checks and configured-root pinning;
these are lifecycle/root safety, not adoption authority epochs. Keep target-specific guards in
handoff/store callbacks; deleting a proof phase must not discard their predicates. Ordinary
worker-to-worker delivery/health stays usable and does not acquire coordinator-only requirements.
Do not extend the config lock over worker launch/send as a new global transaction; the bounded
old-endpoint re-probe inside the adoption transaction remains required.

The contract is cooperating local processes: once the pair changes, the former coordinator
cannot initiate further coordinator effects even if still running. Final current-config checks
cannot recall an already-submitted composite OS action or detect coherent config rollback;
no cancellation, transactional network fence or hostile-same-user protection is claimed.
No new epoch/proof fence is introduced to cover that limitation.

## 3. Failure and old-file behavior

| Failure/state | Required outcome |
|---|---|
| No/Esc/dismiss, unavailable widget, malformed capture, wrong role/context, busy host, stale yes, collision, live old endpoint | Named refusal; no config replacement. Host/capture errors are not silently No or a text fallback |
| Foreign/abandoned/unreadable lock | `LOCKED`; name lock path and available diagnostic owner details. No timeout/pid-based stealing. Human maintenance may remove an abandoned lock only after establishing no holder/in-flight publication remains; then retry with a fresh decision |
| Same configured session id, different bound port after `EADDRINUSE` fallback | Refuse coordinator effects and automatic boot `port_update`; display saved/actual pair and board path. Safely free the saved port and restart to regain exact-pair authority, or use normal eligible fresh-session adoption. No in-tool same-session repair; automatic rebinding is not authorized (N1) |
| Invalid/unreadable/duplicate-key config or unsafe root/config/lock path | Config/path refusal; no implicit initialization/normalization |
| Temp/write/sync/close or definite pre-publication failure | No adoption success; current config remains authoritative. Clean only this call's owned temp |
| Atomic publish submitted, outcome uncertain | Report uncertainty, not rollback or zero effects. Stop; a later explicit invocation reads current config: old pair needs a new adoption decision, matching pair loads only, a different pair needs a new preview. Infer no stored consent |
| Publish succeeded, session changed or promotion failed | Report config replacement separately from local failure/pending promotion. Do not revert. Matching pair retry loads only, with zero questions and zero config writes |
| Replacement occurred during a queued report/callback/reminder | Current-config permission refuses later effects. If report was already saved, preserve it and report stored-but-not-notified, no false delivery success/replay |
| Process interruption | Config is old or new complete JSON; a leftover lock still stops. After separate lock-owner resolution, old pair needs a fresh decision, matching pair loads only. No prepared/active recovery state |

These cases reuse existing atomic config semantics, not the withdrawn power-loss/directory-fsync
protocol. Do not claim new cross-platform durability from rename mocks or process-kill fixtures.

**N1 source/behavior change:** `listen` (`src/transport.ts`) falls back from a requested occupied
port on `EADDRINUSE`. At this base `start` finds the configured coordinator by session id, then
its boot `port_update` writes the bound port once `authorityReady` permits it. The new exact-pair
permission rule intentionally no longer permits that mismatch write. Keep same-port startup
usable (a redundant same-port refresh may remain); test occupied-saved-port refusal explicitly.
This is the [previously carried limitation](https://github.com/skatrych/pi-intercom/issues/25#issuecomment-6362794024),
now durable as requested by [Petro's N1 follow-up](https://github.com/skatrych/pi-intercom/pull/28#discussion_r4361482732).
Deleting claim gates alone must not silently restore session-id-only rebinding. P3 below is an
optional changed contract, not an implementation instruction.

Legacy `coordinator-claim.md` is ignored in every branch, including prepared-before/after,
foreign/malformed/uncommitted bytes, missing file, symlink/directory and unreadable history.
No Git read is needed to classify old boards; the current config is enough. Leave the file
untouched by default. Optional one-time human deletion is a separately requested cleanup, not a
migration step, command prerequisite, second question or auto-unlink. Never follow a legacy
symlink or stage/commit its deletion. No runtime/import compatibility adapter remains. Remove
claim schema/attestation fields and all their readers/writers. The withdrawn ledger, linked history,
durability barriers, capacity budgets, record census and proof benchmarks are not deferred
implementation tasks; the retained ancestor board count is unrelated to that discarded census.

## 4. Test rewrite inventory

Make a named-case disposition table in the implementation PR: **retain**, **rewrite to current
config**, or **delete as superseded**. Do not preserve every old behavior under new terminology.
The 108-case scenario count at this base is not a required minimum: deliberately shrink it and
update the count after removing obsolete cases and duplicate evidence phases.

| Existing surface | What shrinks / what stays |
|---|---|
| `tests/adoption.test.mjs`, `fixtures/adoption-runner.mjs`, `adoption-cases.mjs`, `adoption-fixture.mjs`, `adoption-support.mjs` | Remove claim builders, commit hooks, evidence fields/assertions, prepared/renew/finalize variants and record-only faults. Keep direct fresh-session success, role/context/idle checks, collisions, old probe/reconnect, config formats/duplicate keys, two-token preservation, jobs/history untouched, lock failures and publish/promotion failures. Unpersisted/wrong-header/store-missing-id become successful native-identity cases, not refusals. Keep `new-health-mismatch` as a cheap bound-port/foreign-identity refusal |
| `tests/adoption-contract.test.mjs` | Replace claim-gate damage with obsolete-claim irrelevance and current-config mismatch/corruption controls. Delete failed-active-commit recovery, UUID/hash/timestamp evidence and claim-symlink-refusal expectations. Keep path drift, nested-board mutex, outer queue, queued old update, promotion load-only retry and concurrent log preservation |
| `tests/adoption-ux.test.mjs` AC1–AC6 | First-board startup has zero questions/commands and no generated evidence; existing-board replacement has exactly one question. Existing self entry no longer asks declaration. Different old claim id has no display/authority role. Remove evidence-origin/ended wording/prepared renewal/finalization cases. Keep visible old/new config pairs, one question, No/dismiss/capture/host failures, fresh invocation, stale yes and live-old precheck |
| `tests/adoption-ux.test.mjs` AC7–AC9 | Replace strict adoption/recovery and staged/tracked/protected/unresolved refusal/diagnostic cases with positive zero-Git influence cases. Remove Git path-category diagnostics/schema-extreme evidence tests. Keep actual config-byte drift and actual unsafe config/board paths as independent negatives |
| `tests/adoption-review-regressions.test.mjs` | Delete newest/missing/dirty claim and intent-ancestry proofs, legacy-absence rediscovery, Git-context-discovery and authority-epoch close/reopen tests. Rewrite admission/final-temp-close/Windows retry/startup-port/after-save/launch-observation guards to revoke/change the actual config pair (or lifecycle/root). Retain independent store final check despite a throwing caller, full handoff target predicates and saved-vs-notified outcomes; do not test private authority epochs that no longer exist |
| `fixtures/adoption-runtime-cases.mjs`, `adoption-process.mjs`, `adoption-race-cases.mjs` | Collapse bootstrap/declaration/active-dirty/commit-failed/clean-advance barriers to before/after atomic config publication and local load. Replace cross-epoch stimuli with current-config replacement or lifecycle replacement. Claim changes are nonblocking. Keep separate-process writers/two adopters, stale-preview race, queued old writer, initialize race, lock ownership, config old/new interruption tests and worker routing old→new with no reload. Remove intent/claim crash boundaries |
| `tests/adoption-bridge.test.mjs`, `adoption-runtime-extra.test.mjs` | Keep captured UI/context/sole bridge, backend role authorization and no-board/above-home isolation. Remove ordinary-turn-to-persist prerequisite; prove a fresh native session on an existing board reaches its one question without session-store evidence, and first-board startup needs none |
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
  No stage/reset/commit, hooks, ignore edits or Git repair instructions.
- Fresh canonical projects-home startup with no config creates the board and loads responsibility
  with zero prompts and without invoking adoption; allow an empty root metadata directory.
  Child/no-board, above-home/aliased roots, explicit worker missing config, malformed/unreadable
  config and empty/malformed extra child boards refuse. Competing initializers never overwrite;
  a loser is not promoted without an exact-pair match. A command after config removal requests
  restart, not initialization. Assert offending paths and safe empty-stray guidance in diagnostics.
- Configured coordinator with saved port available starts normally; occupied saved port causes
  fallback and named exact-pair refusal with no config write or coordinator effects. Assert the
  documented recovery guidance. Configured-port collision names the entry and never removes it;
  unverifiable own endpoint offers restart guidance. No automatic N1 rebind.
- Snapshot fixture index/refs/metadata and unrelated files outside production code; all remain
  byte-identical. Non-obstructing extra board artifacts are not an allowlist refusal. Legacy
  claim variation alone, including changes while UI is open, never changes the result or bytes.
- Negative controls without a repository: actual config drift/corruption, session/port collision,
  live different identity at the new port, unverifiable own port, reconnecting old endpoint,
  unsafe/changed root/config/lock, second/wrong board (including an empty extra board) and changed
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
version upgrade: **all processes sharing a board must be upgraded before new adoption is used**.
This is a documented operator prerequisite, not a new runtime version handshake; no mixed-version
safety is claimed when older code still reads claims. Config stays version 1: there is no
migration/downgrade data protocol to build.
A code rollback would restore old claim gates, not recover authority through history.

**Separate docs-alignment issue, not PR28 scope:** swactory Orchestrator instructions and
coordinator-adoption skill; ADR0005/0009-C/0012 claim/evidence/Git references;
`docs/artifact-atlas.md` coordinator-claim/tenure/path-scoped commits description; projects-home
claim file and instructions requiring it. This reviewed alignment, matching human runbook
installation, and fork release/whole-board upgrade block #25 closure and AC1/AC4 acceptance;
track the dependency explicitly before implementation delivery. The installer-dirties-Git symptom
becomes irrelevant to adoption once Git is ignored, without changing worker lease-cleanliness
rules. Record obsolete status/optional human deletion without rewriting historical ADR provenance. Do not edit those sources, installed copies or live claim
in this docs-only PR. Worker lease cleanliness and lifecycle policies stay unchanged. PR31's
claim/epoch-based monitor design must be reconciled in its own planning round before it can be
implemented against this model; #25 does not authorize monitor redesign.

This delivery changes only `docs/issues/25-proposed-solution.md`, this plan, and the concise
`docs/adr/0025-git-independent-adoption.md`; the prior presentation round already moved the
former ADR-directory plan here. Keep `feature/25-git-independence-plan` and PR28 as the single
vehicle;
preserve the same-issue lease base without rebasing. Check relative links, `git diff --check`,
docs-only diff and clean tree/index after commit. Handoff exact SHA/diff stat and validation
limits in an issue comment naming Coordinator as next sole write owner; push this docs-only
round to the same draft PR28 and request mandatory independent review. Any PR-body update must
first pass projects-home `scripts/pr-body-guard.sh`; never mark ready/merge or resolve human
threads unilaterally.
Runtime/test/build validation and AC3 acceptance remain outstanding.

## 6. Review dispositions and optional human choices

Taking comments into work is not blanket approval of their suggestions. The selected baseline
retains serialization, byte preservation and exact-pair permission. Only Captain's first-board
change and the diagnostic/dependency clarifications below amend that baseline in this round.

| Comment / request | Disposition and rationale |
|---|---|
| Captain [solution inline](https://github.com/skatrych/pi-intercom/pull/28#discussion_r4366709481), [ADR inline](https://github.com/skatrych/pi-intercom/pull/28#discussion_r4366725494), [changes request](https://github.com/skatrych/pi-intercom/pull/28#pullrequestreview-5637760281) | **Accepted/addressed.** Safe-root first-board runtime startup creates config without adoption or questions; all three docs and startup/UX/race tests now distinguish it from existing-board replacement. Upstream source basis is above; child/private creation and unsafe/invalid existing state remain refused. |
| Petro [port-collision inline](https://github.com/skatrych/pi-intercom/pull/28#discussion_r4354665457) and [review §1](https://github.com/skatrych/pi-intercom/pull/28#pullrequestreview-5622238458) | **Diagnostic accepted/addressed; relaxation not adopted.** Name the conflicting entry/pair and remediation. Successful binding proves current endpoint ownership, not authority to remove/rebind another configured identity; allowing duplicate endpoint routing is not a stale-entry cleanup protocol. No extra adoption cleanup action/question. |
| Petro [boot-port inline](https://github.com/skatrych/pi-intercom/pull/28#discussion_r4354665546), [N1 inline](https://github.com/skatrych/pi-intercom/pull/28#discussion_r4361482732), [drift review](https://github.com/skatrych/pi-intercom/pull/28#pullrequestreview-5630892059) | **Documentation accepted/addressed; automatic recovery proposed only (P3).** §1 inventory, §3 and tests explicitly retire session-id-only fallback repair under the selected pair rule, retain working same-port startup, and state recovery limits. This honors the [existing N1 disposition](https://github.com/skatrych/pi-intercom/issues/25#issuecomment-6362794024), not an unnoticed un-fencing of boot writes. |
| Petro [board-path inline](https://github.com/skatrych/pi-intercom/pull/28#discussion_r4354665634), original/drift reviews | **Accepted/addressed.** Startup and command refusals name offending paths and expected root, explain human removal only for a confirmed empty unintended stray, preserve populated/malformed data and never auto-delete. Tests require these diagnostics. |
| Petro original review §2 scope; drift review scope | **Accepted/addressed.** Reviewed matching swactory alignment + human install + release/whole-board upgrade explicitly block #25 closure/AC1/AC4; installer Git dirt no longer affects adoption. Historical swactory#64 provenance was corrected in [issue25](https://github.com/skatrych/pi-intercom/issues/25#issuecomment-6293336265); it is not the runbook owner. No cross-repo or installed writes here. |
| Petro original review §3 size/density; drift review structure | **Addressed.** Keep separate concise summary/details, lasting ADR and actionable source/test inventory in this plan. No arbitrary source-line target; removing obsolete machinery is required, preserving every old test is not. No extra ledger history or new subsystem. |
| Petro original review §4 helper; drift review missing doc note | **Accepted as local factoring, addressed.** §2 now recommends a shared predicate with the full effect-site checklist; helper name is Developer authority. No narrowed permission surface or coordinator-only gate on worker traffic. |
| Petro original review smaller points: stale base, mixed versions, own-endpoint refusal | **Addressed.** Recheck source against implementation base; do not rebase this preserved planning lease. Document all-process upgrade before use, no handshake/mixed-version claim. Endpoint diagnostic requests restart/retry and reporting persistent failure. Tests cover the message. |
| Petro [fold-ins A–C / #36](https://github.com/skatrych/pi-intercom/pull/28#issuecomment-6382758474) | **Availability concern accepted; requested compare-then-rename/delete-all-locks amendment not adopted.** See P1. Atomic rename publishes complete JSON but is not a conditional swap. Retain shared queue/lock/ownership checks across all writers and platform retries. Expose abandoned-lock limitation and safe human-maintenance route. No PID/age steal. |
| Same fold-ins / [#38](https://github.com/skatrych/pi-intercom/issues/38) | **Proposed, not adopted (P2).** Semantics-only preservation would simplify writing, but changes the selected compatibility guarantee. Do not remove strict duplicate-key validation with the span patcher by accident. Keep current patch/strict-read behavior pending human choice. |
| Same fold-ins / [#35](https://github.com/skatrych/pi-intercom/issues/35), [#37](https://github.com/skatrych/pi-intercom/issues/37) | **Already covered, no additional design adopted.** Remove Git/claim/phases/obsolete result codes/prompts and authority epochs; retain current-config effects and target safeguards. Lines-of-code estimates are not acceptance budgets. Bot closure/Done labels on #36/#38 do not accept their proposed contract changes. |
| Petro drift review cross-PR31 | **Addressed as dependency, not implemented.** Monitor's claim/epoch assumptions must be reconciled separately; no monitor behavior is redesigned or approved here. |

### P1 — Serialization and abandoned-lock recovery

**Current/default:** retain the all-writer lock and process queue. Abandoned locks require
separate human maintenance; current diagnostics must reveal that limitation and safe route.
Source `ConfigStore.exclusive/acquireLock/publish` serializes read/mutate/stage/rename, including
other store instances and processes. Ordinary config mutation callbacks are asynchronous.
Upstream's per-instance `tail` is insufficient for the fork's multiple cooperating adopters.

**Why the requested algorithm is not CAS:** A and B read config C; both stage changes; A checks
C, B checks C, A renames A', B renames B'. Both succeed; A's update is lost. An old coordinator
can similarly overwrite adoption after passing its last check. No await between user-space
compare and submitting rename makes them one interprocess operation. Neither a hash nor the
existing Windows rename retry closes this gap. A race test that only lets B read after A's
rename would miss it. Removing only the adoption lock also leaves ordinary writers unsafe.
PID/age-based deletion adds owner-death/PID-reuse and lock-replacement races, not a proven fix.

**Human choice:** accept the disclosed manual-recovery limitation for this minimal baseline,
or require a follow-up design for genuinely crash-released cross-process serialization across
*all* writers on supported platforms before implementation. The latter must identify a real
OS/provider locking primitive, lifecycle and platform support; preserve no-lost-update and
one-adopter behavior; test two last-checks-before-rename and process death/reacquisition. Do not
implement compare-then-rename under the name CAS or promise it meets #36's concurrency AC.
Changing to a real crash-released primitive would require another reviewed architecture round;
this plan authorizes neither a new dependency nor weaker concurrency in the meantime.

### P2 — Byte preservation versus normalized semantic preservation

**Current/default:** retain byte-lossless two-token adoption, the existing strict reader and
span patcher. Ordinary update reserialization is not evidence that adoption's explicit byte
guarantee was already waived. The strict reader also rejects duplicate keys independently of
claim hashes (`JsonDocument` / `scanConfig`); `JSON.parse` alone silently accepts them.

**Human choice:** retain this compatibility guarantee, or authorize adoption to normalize
formatting via parse/change/validate/serialize while preserving every other parsed value
(including unknown tolerated fields, coordinator fields other than id/port, worker jobs and
order). Under the latter, require deep equality of the entire config after excluding only the
two changed fields, keep raw preview comparison for staleness, and retain explicit duplicate-key
refusal through a reviewed strict parsing approach. Then revise source/test inventory to remove
byte-span patching and byte-format assertions, not permissions, serialization or schema checks.
No decision to drop duplicate-key safety is bundled with formatting normalization.

### P3 — Same-session boot fallback recovery

**Current/default:** exact-pair mismatch refuses, including startup after fallback. No automatic
rebinding. Same-port restart and eligible fresh-session adoption remain available as described
in §3; there is no guarantee a same-session retry can repair the occupied saved port.

**Concrete proposed exception for human choice:** permit a *boot-only* port update when the
current coordinator session id still equals this native session id, but its saved port differs
from the successfully bound/identity-verified endpoint. Under the shared writer lock, freeze and
recheck the same config, canonical root and lifecycle, require no other configured entry at the
new port, and bounded-probe the saved old pair: a matching live identity refuses. Recheck after
awaits and before publication/retry; change only that coordinator port. Until publication,
allow no other coordinator effects, handoff recovery or observer maintenance. Load responsibility
and require the resulting exact pair before enabling them. No adoption question, worker
promotion or general id-only permission exception. Disconnected/unknown still does not prove
termination: this exception would explicitly accept duplicate-same-session/unknown-old-endpoint
risk for availability, not solve it. It is narrower than simply un-fencing the current startup
branch, which currently does recovery/maintenance before updating the port.

Approving this exception requires another reviewed amendment of ADR/flow/effect guards and
race/failure tests; it is **not authorized** by Captain's first-board direction or by Petro's
request. Human may retain refusal instead. No automatic recovery should reach the Developer
through a brief contradicting this baseline.

**What blocks what:** P1–P3 are optional departures, not blockers to finishing this authorized
docs round or implementing the explicitly selected baseline after review/human approval. Human
design approval must acknowledge its lock/fallback availability limits and preservation choice.
If a departure is chosen, implementation of that changed contract waits for a revised independently
reviewed design; the Developer must not decide it. Fresh independent review and human approval/
merge remain mandatory for this draft PR; separate release/install/alignment gates block final
issue acceptance regardless of these optional choices.
