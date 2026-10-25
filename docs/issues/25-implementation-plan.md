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
not this Captain-ruling revision. Captain's exact ruling (recorded by [Coordinator](https://github.com/skatrych/pi-intercom/issues/25#issuecomment-6402229840)):

> P1: proposed design looks good. P2: promised byte-exact leftovers is not what i need.
> JSON parse and re-serialize, as suggested in last review comments is good way, from my
> point of view. P3: proposed design looks good

This selects genuinely crash-released serialization, parse/serialize preservation and narrow boot
port recovery, superseding optional/default dispositions at `c2f1cd2`. These are architecture
choices for review, not authorization to code, install or change a live board.

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
| Same coordinator session id but different endpoint port | Boot only: guarded verified-port recovery (§P3), then exact-pair load. Command/status never repairs; command requests restart |
| This session id is a configured worker | Session collision; no worker promotion/removal/rebind |
| Different coordinator, fresh unconfigured session and unused port | One adoption yes/no, locked recheck/probe, one atomic pair replacement |
| Invalid/unreadable config, unsafe path, active native lock or stale preview | Stop; no repair, lock stealing or stale-answer reuse. Mere existence of the new regular lock file is not contention |

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
Active native-lock contention instead refuses this startup attempt; do not wait/retry publication
or read a partly initialized board as authority. A later startup reads the winner normally.
Do not load/act as another initializer's coordinator. If `/intercom-adopt` later sees no config,
stop with restart guidance; it is not a second bootstrap entry path. No claims, extra startup
consent or session-history proof. Existing malformed/unreadable config remains an error.
This implements [Captain's two inline requests](https://github.com/skatrych/pi-intercom/pull/28#discussion_r4366725494)
without changing fork root isolation or ordinary explicit-worker behavior.

Existing-board replacement changes only parsed `sessionId` and `port`: preserve coordinator
name/description and every other parsed value, including workers, jobs and array order. Formatting
may normalize. Raw config bytes still bind a displayed preview; see P2 for duplicate/roundtrip
safety. Loading responsibility in place must not restart/reload workers, send work, clear reports,
rewrite jobs or start a model turn. Status is read-only:
report current config/identity and whether local responsibility is loaded, never classify claims,
promote, ask a question or write.

## 1. Remove, do not replace with a subsystem

| Source at base | Required change |
|---|---|
| `src/adoption.ts` claim types/renderers/parsers, `declarationEvidence`, `adoptionEvidence`, `leftUnchanged`, `ENDED_WORDING` | Delete evidence schemas, attestation wording/timestamps, transition UUIDs, historical pair/date, roster/job hashes and rebrief fields. Keep semantic-preservation assertions in tests, not records |
| `writeCommit`, `commitClaim`, `readClaim`, `latestClaimCommit`, `readCommitRecord`, `previousClaimDate`, `verifyActiveAnchor`, `activeIntentProof` and supporting proof adapters | Delete the evidence writer/reader/history chain entirely; no replacement ledger/module/export |
| `claimEvidenceEstablished`, `bootClaimEvidence`, `committedActiveClaimMatches` | Delete and remove every boot/config/runtime call site, including synchronous final-effect Git checks |
| `assertGitSafe`, `blockers`, `statusEntries`, `unresolvedOperation`, `protectedSurface`, `inspectBoardNamespace`, Git policy/helpers and `reconcile` Git precheck | Delete; remove the recovery flow itself. No protected-file dirty exception or whole-board unknown-file allowlist |
| `survey`, `pathSnapshot`, `assertPaths`, `assertSnapshot` | Retain config/path/board-count and live runtime identity checks only. Remove HEAD/newest-claim/claim-worktree bindings and claim-path type checks. Git-only or obsolete-claim changes cannot stale a preview |
| `decide`, `bootstrap`, `declare`, `humanAdoptionDecision`, adoption `transaction`, `reconcile`, prompt builders and phase seams | Move first-board creation to ordinary runtime startup; remove adoption bootstrap/question. Command becomes already-current/load-only, collision/refusal, replacement, or no-config/restart guidance. Delete declaration, prepared intent, renewal, finalization and generated-record phases/prompts/results; retain ConfigStore writer serialization |
| `resolveIdentity`, `AdoptionOptions`, `src/index.ts` adoption wiring | Use captured native session id and bound endpoint, revalidated against the same current runtime/context. Remove adoption's persisted-header/session-file/per-cwd `SessionManager.list` requirement and ordinary-turn-to-persist preamble; retain the existing bounded bound-port identity probe as a cheap port-in-use check. Do not remove session APIs still needed by worker resume |
| `src/config.ts:update`, `ConfigGuard` | Remove dynamic adoption-proof imports, legacy-absence discovery and claim-specific guard phases. Retain locked current exact-pair permission, root/held-handle validity, caller/lifecycle/target guards, raw expected-config and final-publication/retry checks. Share the semantic reader/writer with adoption and boot recovery (P2/P3) |
| `src/config.ts:exclusive/acquireLock/publicationGuard`, lock types/options; `package.json`, lockfile | Keep outer/process queues, `transaction` and async-local nesting. Replace mkdir/token/owner-json/rmdir locking with exact-pinned native file-lock adapter and stable regular file/handle checks (P1). Delete lock-owner age/PID/UUID metadata, not serialization. Add dependency/packaged native-provider gates in the later implementation PR |
| `JsonDocument`, `JsonSpan`, `rawSpan`, `scanConfigDocument`, `scanConfig`, `patchCoordinatorEntry`, `replaceCoordinatorEntry`, raw temp writer | Remove span tree, hashes of entry/job spans and byte patching. Replace strict read with `{raw, config}` using JSON.parse + duplicate-key preflight; use one validated semantic serialization path. Keep raw preview hash/bytes only for stale checks; retain a narrow pair-replacement operation, not a general unguarded edit API (P2) |
| `src/runtime.ts:start` / `preflight` no-board hold and coordinator `port_update` | Restore safe-root initialization. Replace current id-only fallback refresh with the boot-only P3 store operation before responsibility load, handoff recovery, observer maintenance or other coordinator effects. Never simply un-fence the existing branch. Keep all non-boot permissions exact-pair |
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
   Command-time adoption never repairs a same-session fallback; only startup may use P3.
3. For a replacement, probe the configured old pair. Matching live identity stops. Display old
   and new pair, root, two-value replacement and preservation of other parsed values/jobs. State that
   disconnected/unknown does not establish termination. Ask the existing single native No/Yes;
   yes authorizes replacement only. No typed/ended attestation or persisted answer.
4. On yes, acquire the crash-released all-writer transaction lock (P1). Re-read strict config and compare
   the original raw bytes, current identity/endpoint and path/board-count snapshot. Recheck
   session/port collisions and bound-port identity, and probe old pair again. Recheck after the
   probe's await. On drift,
   stop with stale preview; do not merge concurrent roster updates or ask again in this run.
5. Use the narrow pair-replacement operation with P2 parse/change/validate/serialize and guarded
   atomic publish. Keep the shared process queue + native lock across recheck/probe/swap;
   all ordinary writers, initialization and P3 boot recovery use the same transaction. Keep
   temp write/sync/close, owned temp cleanup and bounded Windows publication retries. Revalidate
   lifecycle, paths, expected raw config and held-handle identity before every rename attempt.
   Never retry the mutation, probe sequence or OS work outside publication.
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
| Runtime startup/preflight, `promoteCoordinator`, `reload`, `coordinatorActionReady` callers | Before any coordinator effect, exact config pair, lifecycle/root and loaded responsibility as applicable. Only the private boot P3 publication can run before pair match/load; it cannot authorize recovery/maintenance/tools. No declaration, anonymous/worker promotion or general id-only permission |
| `tool`, `transmit`, launch/send dispatch, status/success return and observation hooks | Recheck current config permission after awaits and immediately before the existing effect; do not authorize from a cached `me.coordinator`. An admitted coordinator request must still check if it has since become unconfigured, not fall through as worker traffic |
| `receive` registration/status/message, handoff callbacks/recovery, report queue/before-save/notification, reminder delivery | Preserve current recipient/sender, worker-target and close-job rules plus current coordinator permission at effects. No save/clear/registration change/model turn/reminder by the replaced coordinator |

Ordinary `ConfigStore.update`/`configure` and their runtime/handoff callbacks must carry this
runtime's captured `{sessionId, port}` caller pair, not only today's id argument; require it to
match current coordinator config at locked admission and final publication. Capture port from
the bound endpoint internally, not message/tool arguments. Update every call site and direct
store test. `requireCoordinator(config, id)` may still locate an entry but is not sufficient
publication authority. Adoption and P3 retain separate narrow operations with their own guards.
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
| Native lock contention / provider or path failure | Contention: `LOCKED`, name path and report native acquisition unavailable/contended; no fabricated holder/owner/PID claim, deletion or stealing. Fresh invocation may retry. Provider/unsupported primitive: storage-unavailable refusal, no weaker fallback. Regular-file existence alone never blocks |
| Legacy directory `config.lock` | Named upgrade-required refusal; leave it untouched. Complete whole-board offline upgrade and separately authorized maintenance (P1), never runtime PID/age cleanup |
| Same configured session id, different bound port after `EADDRINUSE` fallback | At boot only, attempt P3 verified locked publication before all other effects. Collision/live-old/identity/config/path/lifecycle drift refuses with saved/actual pair and board path; keep held. Command-time mismatch requests restart, never repair. Free saved port safely and restart, or use eligible fresh-session adoption if boot cannot recover |
| Invalid/unreadable/duplicate-key config or unsafe root/config/lock path | Config/path refusal; no implicit initialization/normalization |
| Temp/write/sync/close or definite pre-publication failure | No adoption success; current config remains authoritative. Clean only this call's owned temp |
| Atomic publish submitted, outcome uncertain | Report uncertainty, not rollback or zero effects. Stop; a later explicit invocation reads current config: old pair needs a new adoption decision, matching pair loads only, a different pair needs a new preview. Infer no stored consent |
| Publish succeeded, session changed or promotion failed | Report config replacement separately from local failure/pending promotion. Do not revert. Matching pair retry loads only, with zero questions and zero config writes |
| Replacement occurred during a queued report/callback/reminder | Current-config permission refuses later effects. If report was already saved, preserve it and report stored-but-not-notified, no false delivery success/replay |
| Process interruption | Config is old or new complete JSON; the permanent regular guard remains, but kernel ownership releases on last close/process cleanup. A later writer can acquire it without deletion. Old pair needs a fresh decision, matching pair loads only; boot recovery may run only in a new startup. No prepared/active recovery state |

These cases reuse existing atomic config semantics, not the withdrawn power-loss/directory-fsync
protocol. Do not claim new cross-platform durability from rename mocks or process-kill fixtures.

**N1 source/behavior change:** `listen` (`src/transport.ts`) falls back on `EADDRINUSE`.
At this base, `start` finds the coordinator by id and runs handoff recovery/observer maintenance
before `port_update` once claim readiness permits it. P3 deliberately reorders this: publish and
verify the guarded boot port first, then load responsibility and enable exact-pair effects.
This supersedes the [previous mismatch-refusal disposition](https://github.com/skatrych/pi-intercom/issues/25#issuecomment-6362794024)
under Captain's newer ruling, not merely deletion of claim gates. Same-port boot needs no port
write; do not perform a redundant normalization write. Test both normal and fallback startup.

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
| `tests/adoption.test.mjs`, `fixtures/adoption-runner.mjs`, `adoption-cases.mjs`, `adoption-fixture.mjs`, `adoption-support.mjs` | Remove claim builders, commit hooks, evidence fields/assertions, prepared/renew/finalize variants and record-only faults. Keep direct fresh-session success, role/context/idle checks, collisions, old probe/reconnect, config formats/duplicate keys, semantic preservation, jobs/history untouched, lock failures and publish/promotion failures. Unpersisted/wrong-header/store-missing-id become successful native-identity cases, not refusals. Keep `new-health-mismatch` as a cheap bound-port/foreign-identity refusal |
| `tests/adoption-contract.test.mjs` | Replace claim-gate damage with obsolete-claim irrelevance and current-config mismatch/corruption controls. Delete failed-active-commit recovery, UUID/hash/timestamp evidence and claim-symlink-refusal expectations. Keep path drift, nested-board mutex, outer queue, queued old update, promotion load-only retry and concurrent log preservation |
| `tests/adoption-ux.test.mjs` AC1–AC6 | First-board startup has zero questions/commands and no generated evidence; existing-board replacement has exactly one question. Existing self entry no longer asks declaration. Different old claim id has no display/authority role. Remove evidence-origin/ended wording/prepared renewal/finalization cases. Keep visible old/new config pairs, one question, No/dismiss/capture/host failures, fresh invocation, stale yes and live-old precheck |
| `tests/adoption-ux.test.mjs` AC7–AC9 | Replace strict adoption/recovery and staged/tracked/protected/unresolved refusal/diagnostic cases with positive zero-Git influence cases. Remove Git path-category diagnostics/schema-extreme evidence tests. Keep actual config-byte drift and actual unsafe config/board paths as independent negatives |
| `tests/adoption-review-regressions.test.mjs` | Delete newest/missing/dirty claim and intent-ancestry proofs, legacy-absence rediscovery, Git-context-discovery and authority-epoch close/reopen tests. Rewrite admission/final-temp-close/Windows retry/startup-port/after-save/launch-observation guards to revoke/change the actual config pair (or lifecycle/root). Retain independent store final check despite a throwing caller, full handoff target predicates and saved-vs-notified outcomes; do not test private authority epochs that no longer exist |
| `fixtures/adoption-runtime-cases.mjs`, `adoption-process.mjs`, `adoption-race-cases.mjs` | Collapse bootstrap/declaration/active-dirty/commit-failed/clean-advance barriers to before/after atomic config publication and local load. Replace cross-epoch stimuli with current-config replacement or lifecycle replacement. Claim changes are nonblocking. Keep separate-process writers/two adopters, stale-preview race, queued old writer, initialize race, native handle/path validity, crash reacquisition, config old/new interruption tests and worker routing old→new with no reload. Remove intent/claim crash boundaries |
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
- Same-port configured startup loads with no port write. Occupied saved port may recover only
  through P3; assert publication precedes load/recovery/maintenance and every coordinator effect.
  Matching live old endpoint, configured new-port collision, unverifiable own endpoint or changed
  lifecycle/root/config refuses with no later effects. Test command-time mismatch stays read-only
  until restart, and exercise collision/endpoint diagnostics and the accepted unknown-old risk.
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
- One atomic swap changes exactly the two parsed fields; complete non-target config values and
  worker/job array order deep-equal (formatting may normalize). Logs/reports/session files stay
  byte-identical. Failed load retries without write/question. Two adopters cannot both replace
  one preview; queued old-coordinator writes cannot restore it. Add all P1/P2/P3 cases below.

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
rules. Record obsolete status/optional human deletion without rewriting historical ADR provenance.
Do not edit those sources, installed copies or live claim in this docs-only PR. Worker lease cleanliness and lifecycle policies stay unchanged. PR31's
claim/epoch-based monitor design must be reconciled in its own planning round before it can be
implemented against this model; #25 does not authorize monitor redesign.

This delivery changes only `docs/issues/25-proposed-solution.md`, this plan, and the concise
`docs/adr/0025-git-independent-adoption.md`; the prior presentation round already moved the
former ADR-directory plan here. Keep `feature/25-git-independence-plan` and PR28 as the single
vehicle; preserve the same-issue lease base without rebasing. Check relative links, `git diff --check`,
docs-only diff and clean tree/index after commit. Handoff exact SHA/diff stat and validation
limits in an issue comment naming Coordinator as next sole write owner; push this docs-only
round to the same draft PR28 and request mandatory independent review. Any PR-body update must
first pass projects-home `scripts/pr-body-guard.sh`; never mark ready/merge or resolve human
threads unilaterally.
Runtime/test/build validation and AC3 acceptance remain outstanding.

## 6. Review dispositions and Captain's selected P1/P2/P3 design

Captain's [new ruling](https://github.com/skatrych/pi-intercom/issues/25#issuecomment-6402229840)
supersedes the prior optional/unaccepted status. P1/P2/P3 below are the selected revised design,
subject to independent review, human design approval/merge and separate implementation assignment.
Earlier exact-SHA reviews remain historical evidence, not approval of this changed snapshot.

| Comment / request | Disposition and rationale |
|---|---|
| Captain [solution inline](https://github.com/skatrych/pi-intercom/pull/28#discussion_r4366709481), [ADR inline](https://github.com/skatrych/pi-intercom/pull/28#discussion_r4366725494), [changes request](https://github.com/skatrych/pi-intercom/pull/28#pullrequestreview-5637760281) | **Accepted/addressed.** Safe-root first-board runtime startup creates config without adoption or questions; all three docs and startup/UX/race tests now distinguish it from existing-board replacement. Upstream source basis is above; child/private creation and unsafe/invalid existing state remain refused. |
| Petro [port-collision inline](https://github.com/skatrych/pi-intercom/pull/28#discussion_r4354665457) and [review §1](https://github.com/skatrych/pi-intercom/pull/28#pullrequestreview-5622238458) | **Diagnostic accepted/addressed; relaxation not adopted.** Name the conflicting entry/pair and remediation. Successful binding proves current endpoint ownership, not authority to remove/rebind another configured identity; allowing duplicate endpoint routing is not a stale-entry cleanup protocol. No extra adoption cleanup action/question. |
| Petro [boot-port inline](https://github.com/skatrych/pi-intercom/pull/28#discussion_r4354665546), [N1 inline](https://github.com/skatrych/pi-intercom/pull/28#discussion_r4361482732), [drift review](https://github.com/skatrych/pi-intercom/pull/28#pullrequestreview-5630892059) | **Addressed; P3 now selected by Captain.** Replace the earlier N1 mismatch-refusal baseline with a narrow verified/locked boot port update before any other coordinator effects. Ordinary permissions and command-time mismatch stay exact-pair. Do not un-fence today's recovery-before-update branch. |
| Petro [board-path inline](https://github.com/skatrych/pi-intercom/pull/28#discussion_r4354665634), original/drift reviews | **Accepted/addressed.** Startup and command refusals name offending paths and expected root, explain human removal only for a confirmed empty unintended stray, preserve populated/malformed data and never auto-delete. Tests require these diagnostics. |
| Petro original review §2 scope; drift review scope | **Accepted/addressed.** Reviewed matching swactory alignment + human install + release/whole-board upgrade explicitly block #25 closure/AC1/AC4; installer Git dirt no longer affects adoption. Historical swactory#64 provenance was corrected in [issue25](https://github.com/skatrych/pi-intercom/issues/25#issuecomment-6293336265); it is not the runbook owner. No cross-repo or installed writes here. |
| Petro original review §3 size/density; drift review structure | **Addressed.** Keep separate concise summary/details, lasting ADR and actionable source/test inventory in this plan. No arbitrary source-line target; removing obsolete machinery is required, preserving every old test is not. No extra ledger history or new subsystem. |
| Petro original review §4 helper; drift review missing doc note | **Accepted as local factoring, addressed.** §2 now recommends a shared predicate with the full effect-site checklist; helper name is Developer authority. No narrowed permission surface or coordinator-only gate on worker traffic. |
| Petro original review smaller points: stale base, mixed versions, own-endpoint refusal | **Addressed.** Recheck source against implementation base; do not rebase this preserved planning lease. Document all-process upgrade before use, no handshake/mixed-version claim. Endpoint diagnostic requests restart/retry and reporting persistent failure. Tests cover the message. |
| Petro [fold-ins A–C / #36](https://github.com/skatrych/pi-intercom/pull/28#issuecomment-6382758474) | **Availability concern accepted; genuine crash-released P1 now selected.** Native handle locking replaces the abandoned-directory protocol for every writer. Compare-then-rename remains rejected, not CAS; process queue, atomic publication, current-config/path checks and platform retries remain. No PID/age steal. |
| Same fold-ins / [#38](https://github.com/skatrych/pi-intercom/issues/38) | **P2 accepted by Captain.** Remove byte patching; JSON.parse/change/validate/stringify preserves all other parsed values. Keep duplicate-key refusal through a small key-only preflight, not the span subsystem; retain raw preview staleness and complete roundtrip/deep-equality tests. |
| Same fold-ins / [#35](https://github.com/skatrych/pi-intercom/issues/35), [#37](https://github.com/skatrych/pi-intercom/issues/37) | **Already covered, no additional design adopted.** Remove Git/claim/phases/obsolete result codes/prompts and authority epochs; retain current-config effects and target safeguards. Lines-of-code estimates are not acceptance budgets. Bot closure/Done labels on #36/#38 do not accept their proposed contract changes. |
| Petro drift review cross-PR31 | **Addressed as dependency, not implemented.** Monitor's claim/epoch assumptions must be reconciled separately; no monitor behavior is redesigned or approved here. |

### P1 — Concrete crash-released all-writer serialization

**Provider selected:** exact dependency `fs-native-extensions@1.5.2`, Apache-2.0, tag
[`ff65474005c5fa4d46952a27a65f1e028ea7ef2a`](https://github.com/holepunchto/fs-native-extensions/tree/ff65474005c5fa4d46952a27a65f1e028ea7ef2a).
Inspected pinned [API/index](https://github.com/holepunchto/fs-native-extensions/blob/ff65474005c5fa4d46952a27a65f1e028ea7ef2a/index.js),
[binding](https://github.com/holepunchto/fs-native-extensions/blob/ff65474005c5fa4d46952a27a65f1e028ea7ef2a/binding.c),
[build](https://github.com/holepunchto/fs-native-extensions/blob/ff65474005c5fa4d46952a27a65f1e028ea7ef2a/CMakeLists.txt)
and platform sources, plus [shared error normalization](https://github.com/holepunchto/fs-native-extensions/blob/ff65474005c5fa4d46952a27a65f1e028ea7ef2a/src/shared.c)
and [provider lock tests](https://github.com/holepunchto/fs-native-extensions/blob/ff65474005c5fa4d46952a27a65f1e028ea7ef2a/test/lock.js).
[npm 1.5.2 metadata](https://registry.npmjs.org/fs-native-extensions/1.5.2)/tar listing includes Node `.node` prebuilds for
Linux/macOS/Windows x64 and arm64; build selects N-API 9, within repo Node `>=22.19.0`.
This establishes a viable provider/API, **not tested ABI/libc/filesystem/host compatibility**.
No package was installed, addon loaded, binary executed or board probed during this analysis.

| Platform | Real primitive and constraints |
|---|---|
| Linux | [Source](https://github.com/holepunchto/fs-native-extensions/blob/ff65474005c5fa4d46952a27a65f1e028ea7ef2a/src/linux.c) uses `fcntl(F_OFD_SETLK)`. [Kernel contract](https://man7.org/linux/man-pages/man2/F_OFD_SETLK.2const.html): Linux >=3.15, locks belong to open file descriptions and release on last close, not arbitrary other opens. Do not duplicate/inherit/pass the descriptor to subprocesses; verify Node/libuv close-on-exec behavior in package/process tests. Unsupported kernel/filesystem errors refuse |
| macOS | [Source](https://github.com/holepunchto/fs-native-extensions/blob/ff65474005c5fa4d46952a27a65f1e028ea7ef2a/src/apple.c) uses exclusive nonblocking `flock`; only whole-file offset=0,length=0 is supported. Same no-inheritance/stable-file rule; no expansion of existing launcher support is implied |
| Windows | [Source](https://github.com/holepunchto/fs-native-extensions/blob/ff65474005c5fa4d46952a27a65f1e028ea7ef2a/src/win32.c) uses `LockFileEx(EXCLUSIVE_LOCK | FAIL_IMMEDIATELY)` and `UnlockFileEx`; binding maps Node fd via libuv. [OS contract](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-lockfileex): process exit/handle close releases locks, but system cleanup can be delayed. Do not promise immediate crash reacquisition; retry only a fresh invocation, never steal. Separate guard avoids mandatory byte-lock conflicts on config reads/rename |

Use the same API on supported **local** filesystems: `tryLock(fd)` (exclusive whole file),
`unlock(fd)`; no blocking wait, async native waiter, helper process or new lock service. Native
`false` means acquisition unavailable: provider normalizes EACCES/EAGAIN/EBUSY to this result,
so report contention/unavailability, not a proved owner. Other load/syscall errors are storage
unavailable. Load the provider lazily for lock acquisition so read-only diagnostics remain usable
when its binding cannot load. No automatic retry loop or new timeout protocol. Network/remote filesystems (NFS/SMB), unsupported prebuild/libc/ABI
combinations and alternate runtimes are outside this guarantee; unsupported deployments must
not be represented as supported by a successful unit mock. Keep platform evidence explicit.

**ConfigStore integration, every writer:**
1. Keep outer queue → canonical-path process queue → native lock acquisition, and async-local
   reentrant transaction reuse. Key by pinned canonical config path, including distinct store
   instances. A nested write reuses its held handle, never acquires a second lock or queue.
2. Under existing safe-root/path checks, create/open `.pi-intercom/config.lock` as a regular file
   read/write, nontruncating, mode 0600 on creation. Reject symlink/junction/directory/unsafe
   aliases. Compare open-handle `fstat` identity to path `lstat` before/after acquisition; pin that
   identity. Use the handle only for locking, not owner metadata. No token, PID, timestamp or
   `owner.json`; no reader needs to inspect locked bytes. Do not lock `config.json`, whose inode
   is replaced by publication. Do not unlink, rename or recreate the guard during release.
3. Acquire with nonwaiting `tryLock`. On contention close this unowned handle and report `LOCKED`
   with path/fresh-retry guidance. Every partial acquisition failure closes the opened handle
   (unlock first if acquired), including path/guard failures before transaction entry; transfer
   cleanup responsibility only once the transaction owns it. On success keep an internal held-handle assertion in the
   transaction; every admission, final publication and Windows retry validates held state,
   canonical root/guard-file identity and expected raw config independently of caller guards.
   Retain full current caller/lifecycle/target checks. No caller-supplied handle or lock bypass.
4. Hold through all read/mutate/probe awaits, temp write/sync/close, publication/retries and owned
   temp cleanup. Apply to `initialize`, ordinary `update` (and configure/jobs), adoption and P3.
   Retain a strong FileHandle reference for the whole transaction. Release in `finally`: explicit
   unlock, then close even on unlock/error paths; preserve original publication outcomes when
   reporting cleanup failure. Never release while a submitted rename
   promise is unresolved. Never export/duplicate the descriptor or include it in child stdio.
5. Leave the regular file after release/death. Existence is not ownership, so no abandoned-file
   cleanup is required. A live or stalled holder may still block; crash release is not cancellation.
   File replacement outside this protocol refuses on identity drift; hostile same-user TOCTOU,
   distributed recovery and arbitrary external hand edits are not solved.

**Legacy upgrade:** the current `config.lock` is a directory. If present, refuse with its exact
path and offline-upgrade guidance, never auto-convert/delete or infer owner death. Stop/settle all
old board processes and their pending writes under separately authorized human maintenance, then
remove only the established obsolete lock directory and start upgraded processes. If absent,
first upgraded writer creates the regular file; old mkdir-lock writers then fail closed on that
file, but this is not mixed-version support. Upgrade all processes before use. No config schema
migration, automatic directory census or adoption question is added. Historical stale directories
are a one-time compatibility constraint; normal native-holder crashes no longer require cleanup.

**Why not compare/rename:** A and B read C, both check C, A renames A', then B renames B': A's
update is lost. Hashing or avoiding awaits does not combine syscalls. All writers must acquire
the same real lock before reading; a queued old coordinator rechecks its pair after acquiring.
Two adopters may ask once each but only one can replace the same preview: the other contends or
subsequently refuses stale bytes, without merging or reusing consent.

**Required later evidence:** separate processes, not just mocked locks: (a) stable-file repeated
acquisition and two-store queue/nesting/rejection cleanup, (b) two ordinary writers either both
serialize and preserve both updates or contender refuses with no effects, (c) simultaneous
adopter previews yield at most one swap, (d) queued old writer/adoption/initializer/P3 races,
(e) kill holder at pre-temp, post-sync/pre-rename and post-publication boundaries, prove later
acquisition without removing the regular file and old/new complete config, (f) spawn a long-lived
child then kill holder, proving the child did not inherit the lock, (g) file/root replacement and
unsupported binding/syscall fail closed, (h) Windows retry holds the handle and rechecks config/
identity, including revocation before the second attempt. Never use PID/age deletion in fixtures.
Exercise actual packaged Node >=22.19 and supported Linux/Windows hosts (macOS if distributed
there), architectures/libcs claimed by the release, and native prebuild inclusion/loading via
normal package gates. Existing advisory Windows CI is not proof these tests passed. If a claimed
platform cannot supply this primitive/provider, **block that implementation/rollout and return
concrete evidence/options to Architect/human**; Developer may not substitute a weaker lock.

### P2 — JSON parse/change/validate/serialize, no span subsystem

Keep `JSON.parse` as grammar/value owner. Before accepting a config for decision or permission,
run a small duplicate-key-only lexical pass: track object/array frames; skip full string tokens
including escapes; decode a string followed by `:` with `JSON.parse(token)` and record it in
that object's `Set`. Reject repeated decoded names (including escaped aliases) at any depth.
The prior JSON.parse already validates grammar. Keep no Node tree, span records, member ranges,
entry/job hashes or patch concatenation. This safety pass is proportionate ambiguity refusal,
not a second value parser. Use this same reader for async/sync current-config checks and writes;
ordinary read previously accepted last-key-wins, which now intentionally refuses as invalid.

Retain the full parsed object, not a schema projection. `validateConfig` validates in place and
must not strip unknown fields. Adoption modifies only coordinator `sessionId`/`port`; P3 only
`port`. Serialize `JSON.stringify(config, null, 2) + '\n'` through the shared existing synced temp
publisher. Validate the output by re-reading it and require complete deep equality with the
intended object (e.g. Node `isDeepStrictEqual`). Refuse non-finite or other non-roundtrippable
values rather than silently converting them (including unknown values and negative zero).
JSON.parse objects, including an own `__proto__` key, must not be reconstructed via unsafe
assignment or schema allowlists. No new JSON dependency or byte-preservation compatibility layer.

Tests compare complete before/after parsed config excluding only the allowed fields, not merely
non-coordinator entries. Include nested tolerated root/coordinator/worker/job unknowns, array
order, close jobs/handoffs/history, escaped strings/keys, `__proto__`, duplicate known/unknown/
escaped keys at multiple depths, numeric overflow/negative-zero roundtrip refusal and schema
errors. Formatting (indentation, whitespace, escapes, line endings) may change; do not retain
span or format-losslessness assertions. Keep raw preview bytes/hash to refuse any intervening
config change, even a formatting-only edit; never use semantic equality to reuse a stale yes.
Logs/reports/session files are not reserialized and stay byte-identical.

### P3 — Private boot-only verified-port publication

On a canonical Orchestrator launch only, `start` captures the initial strict raw config, native
id, lifecycle and canonical root. For a configured coordinator with the same id but a different
successfully bound port, verify this own endpoint before lock acquisition and keep the runtime
held with no responsibility loaded and only minimal read-only endpoint/status/diagnostics.
Defer observer writes/maintenance, handoff recovery, reminders, registration/status/config
callbacks, tools/send/launch and other coordinator effects. Service object construction is allowed
only if inert; no queued callback may bypass the held check. Since fallback is known only after
`listen`, move observer construction/writes and service side effects out of the pre-bind configured-
coordinator path, not just the visible `port_update` block. Ordinary worker startup is unchanged.

Expose a narrow internal store operation for **port only**, reachable solely from this captured
startup, not a tool/HTTP/config flag or `update` id-only escape hatch. It acquires P1 transaction,
requires unchanged initial raw config and current coordinator id/old port, validates root/board/
path/lifecycle, checks no other entry has the new port and verifies this bound endpoint again.
Bounded-probe the saved old pair; a matching live identity refuses. Disconnected/unknown may
proceed under the accepted risk below. After each await (including probes and temp close),
re-read expected raw config, validate native identity/bound port/lifecycle/root/path/guard/collisions.
Immediately before each publication attempt, perform the same synchronous final guards; preserve
bounded Windows rename-only retries without rerunning mutation or deciding on newer config.
The probe is a bounded observation, not a liveness fence against a later reconnect.

Publish only coordinator port with P2 semantic preservation, retaining id/name/description/all
other values. Once publication settles, re-read current exact pair; only then load responsibility,
recheck exact pair/lifecycle after load, and enable ordinary coordinator effects. Load failure
reports port-published/local-load-pending; a subsequent matching invocation loads only, without
write/question. Stale config, identity/endpoint drift, contention, collisions or a live old pair
stops this boot attempt without repair/retry/other effects. A later restart begins a fresh boot;
commands/status never trigger recovery. Publication uncertainty stays uncertain, no rollback or
in-process replay; restart reads current config. Same-port startup performs no port write.

Tests cover both probes, a reconnecting old endpoint, unknown/different-identity old endpoint,
worker id/new-port collisions, two boot attempts and adoption/ordinary writer racing boot,
config-only/formatting drift, lifecycle/root/endpoint replacement at every await, temp failures,
Windows retries and late revocation, uncertain publication and failed load. Assert no recovery/
observer/reminder/tool/callback effect before verified publication plus load, and command mismatch
cannot call the operation. At most one port change may use the captured boot snapshot.

**Accepted P3 risk:** disconnected/unknown does not prove termination. A duplicate same-session
process may be unreachable (or reconnect after the probe); automatic boot repair can proceed
without a question despite that risk. Exact-pair subsequent checks revoke later effects once
config changes, but cannot recall submitted actions or solve duplicate launch. Captain accepted
this narrow availability trade-off; do not claim a duplicate-session detector or stronger fence.

**Remaining gates:** selected P1/P2/P3 need fresh independent review and human design approval/
merge before a separately assigned implementation. Native-platform/package evidence remains
unexecuted. Separate release/install/alignment gates and AC3 acceptance still block issue closure;
none is waived by this ruling or by Petro's earlier planning approval.
