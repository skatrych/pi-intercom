# ADR 0025: Adoption authority independent of the project Git tree

## Decision requested — not granted

**Recommend a board-local, Git-independent durable authority ledger, replacing project-Git
commits as the authority persistence mechanism.** Remove *all* cleanliness/index/operation/HEAD
conditions from adoption, declaration, recovery, promotion and subsequent authority checks. Do
not implement this by deleting `assertGitSafe` alone, or by ignoring only unrelated files.

Status: **proposed; human policy decision and independent architecture review required before
implementation**. This document authorizes no installation, migration, adoption or policy edit.
Inspected implementation: `main@c6e414f22e09c7a9b50f1331eddd31b0f0e35d66` (`fork-v0.9.0`).
Companion: [bounded implementation and verification plan](0025-git-independent-adoption-plan.md).

The human must decide these compatibility changes, not re-decide AC3:

1. Approve replacing “declaration/active evidence must be **Git committed**” with “must be
   **durably published and verified in the authority ledger**,” including the policy/runbook
   changes listed below. Durability, exact evidence, history and readiness remain mandatory.
2. Approve a versioned board-format migration, including its one-time exception to “only two
   coordinator tokens change.” The single existing native yes/no must show and authorize both
   migration and the selected declaration/adoption/recovery; no additional consent prompt.
3. Accept the conservative legacy boundary: import only independently verifiable legacy
   committed evidence. If it cannot be verified, stop for evidence recovery, never manufacture
   a first declaration or trust an edited claim. This is not a cleanliness refusal. If the
   requirement is instead that *every pre-migration board must succeed with Git unavailable*,
   that conflicts with retaining legacy committed-proof safety; a separate explicit authority
   re-establishment policy would be necessary and is **not** proposed as an automatic fallback.

These decisions block implementation, not this analysis. The already accepted single native
question/no-typed-wording smoke is not reopened. Merged swactory PR92's human installation is a
separate action, not an analysis prerequisite or proof of AC3.

## Authority and provenance

The [complete issue #25](https://github.com/skatrych/pi-intercom/issues/25) body and **all 11
comments returned by the paginated API** were read on 2026-10-21, through
[lease comment 6324633161](https://github.com/skatrych/pi-intercom/issues/25#issuecomment-6324633161).
The human ruling is unambiguous:

> Git tree cleanliness has ZERO influence on adoption: no clean-worktree halt, no dirty refusal
> — not for untracked installs, not for anything else.

The successful smoke was recorded in comment 6294312742. Comment 6295662045 explicitly corrects
its overbroad AC3 claim; comments 6296007076 and 6296043792 keep the behavior gap open. Swactory
[PR92](https://github.com/skatrych/swactory/pull/92) was independently approved at
`deda5a623cdcf84a001aacb90a73c2835c55402e`, then merged as
`a65c16cb1ce4d100e6ff391a1d19811c8ba2cb2f`; its skill describes the released strict checks and
explicitly says AC3 does not hold. That merged source, not the stale local swactory checkout,
was read through the public contents API. Earlier attribution to swactory#64 was corrected in
issue comment 6293336265; do not revive it.

This proposal would supersede the Git-isolation decisions in
[ADR 0009-C](0009-first-declaration-git-safety.md), the Git-specific preserved gates in
[ADR 0012](0012-single-decision-selection.md), and corresponding portions of the current
[reference](../../references/coordinator-adoption.md), **only after approval and delivery**.
Those documents still accurately describe the released code. This docs-only change does not
silently rewrite them to describe unimplemented behavior.

## Why a helper deletion cannot satisfy the contract

Source locators below are symbols at the inspected SHA, not claims about an installed runtime.

| Dependency | Present behavior | Required disposition |
|---|---|---|
| `src/adoption.ts:assertGitSafe`, `blockers`, `unresolvedOperation` | Canonical Git-root requirement; refuses staged paths (including claim), tracked changes, unresolved operations; strict mode refuses untracked content too | Remove from the new authority path, including before/after writes; no narrower dirty allowlist |
| `reconcile` | Separate global staged/tracked/untracked/unresolved precheck before recovery classification | Remove that precheck; recovery depends on ledger/config evidence, not index |
| `survey`, `assertSnapshot` | Records and compares repository HEAD as well as newest claim commit | Bind the authority-ledger head/config/path/identity snapshot instead; unrelated Git commits must not stale a yes |
| `writeCommit`, `commitClaim` | Writes root claim; intent-to-add in real index; `commit --only`; user identity fallback; hooks; parent/path/content checks | Replace persistence primitive, not just status queries; never use the project's index or create project commits |
| `readClaim`, `latestClaimCommit`, `activeIntentProof` | Newest reachable committed claim wins; worktree comparison; prepared ancestry required | Canonical, linked ledger objects and published head become the proof; legacy committed proof only in migration |
| `claimEvidenceEstablished` | Detects bytes/history even if worktree claim deleted, with Git-context/discovery checks | New format marker makes missing ledger evidence a refusal; no return to legacy absence after migration |
| `bootClaimEvidence`, `committedActiveClaimMatches` | Async boot and sync final-effect proofs run `log`/`show`/`merge-base` | Both must prove current ledger evidence with identical semantics and no Git invocation |
| `src/config.ts:update` | Under-lock admission and every final publication retry re-prove Git evidence | Replace both proof sites; preserve all-writer serialization and final guards |
| `src/runtime.ts:assertActionAuthority`, `assertActionReady`, `openActionEpoch` | Pins root claim bytes, pair, local promotion, epoch; sync Git proof at final effects | Pin ledger head/record identity and re-prove fresh evidence; preserve epoch and responsibility gates |

`commit --only` does not decouple this: it still uses the real index/locks and repository HEAD,
can run hooks/signing/configured helpers, needs writable Git metadata, and produces a commit
whose verification or hooks can fail after effects. An alternate index alone leaves HEAD,
merge state, hooks and committed-history readiness coupled. Deleting only cleanliness checks
also leaves absent repos and failed commits as accidental barriers and can consume staged claim
content. The current tolerant `latestClaimCommit` read must not become a new “Git failed means
never claimed” migration rule.

## Required independence and independent safety

For fixed board/config/ledger bytes, path identities, session/port evidence and human answer,
changing **only Git state** must leave the decision branch, question count, effects, result and
readiness unchanged. The positive cases include staged claim/config/ledger paths as well as
unrelated paths; unstaged modifications, deletion/rename, untracked/ignored files, mixed index
states, unmerged index entries, merge/rebase/cherry-pick/revert/bisect markers, detached/unborn
HEAD, dirty submodules, a locked/unreadable index, read-only Git metadata and failed/missing Git.
New-format boards also work with no repository, inside an ancestor repo or linked worktree.
Do not traverse unrelated repositories/submodules or inspect Git markers on that path.

This does **not** make damaged authoritative bytes valid. Examples:

- Staging any version of `.pi-intercom/config.json` has no effect; changing its actual raw bytes
  after preview still produces `STALE_PREVIEW`, whether tracked, ignored or outside Git.
- Staging a ledger record, or a stale `coordinator-claim.md`, has no effect. Changing/removing the
  authoritative ledger record or head is an evidence-integrity refusal even in a non-repository.
- An untracked file next to the board, installer files, or an unexpected non-obstructing board
  artifact cannot trigger a cleanliness/namespace allowlist refusal. A symlink/directory at the
  actual config/ledger/lock target, replaced ancestor, unreadable required evidence or foreign
  lock is still unsafe. Preserve unrelated files; never infer ownership from a temp filename.
- A read-only `.git` is irrelevant. A read-only authority/config location can prevent the
  necessary durable write. Report that storage failure and the exact persisted phase; do not
  tell the human to clean, stage, commit or repair Git.

The safety criterion must be expressible and tested without Git present. Do not relabel all
old “protected dirt” as integrity: reject only a concrete authority/path/lock/config violation,
not a path's Git status or a whole-board filename allowlist. Non-authorizing logs/reports may
continue appending; adoption neither scans their contents nor snapshots their whole tree.

## Proposed authority storage

Use a dedicated `.pi-intercom/authority/` namespace, under the same canonical projects home
and existing all-writer config lock. It is board data, not a Git repository; tracking or ignoring
it is not a prerequisite. Do not edit `.gitignore` or move human files to enable adoption.
A fresh board starts in a new config schema (proposed version 2) with a fixed authority storage
id/format/genesis binding. A migrated board records that same binding. Unsupported versions
must refuse. The exact schema and bounded sizes need review in the first implementation patch.

Bootstrap must also have a recoverable ordering: durably publish a bootstrap-prepared ledger
intent binding the exact to-be-created config before publishing that config, then publish active
evidence. A board directory/ledger with no config can therefore be a specifically verified pending
bootstrap, not an invalid board silently repaired. Missing evidence on an established format-2
board never becomes a fresh declaration. A failed first write that published no intent remains
unapproved; unrecognized partial state stops. The same command recognizes these explicit states
and asks at most one recovery question, never re-asks within the failed invocation.

The ledger contains immutable canonical objects, addressed by SHA-256, and a small atomically
published head descriptor (format, storage id, generation, object digest). Each object binds:

- canonical board root and storage id; monotonically increasing generation and predecessor
  digest (or a fully evidenced legacy genesis import);
- claim schema/version, transition id, prepared/active phase, old/new verified pairs and dates;
- the single captured-yes authority provenance, canonical ended attestation where applicable,
  config-before/config-after hashes, untouched-entry/closeJob hashes and rebrief source;
- prepared object digest for an active adoption, with exact derivation from that prepared
  object; prior claim linkage as a digest, not an overloaded Git commit field;
- explicit migration provenance when present: legacy commit ids and exact canonical committed
  record bytes/proof material, not a new claim that legacy evidence was typed or regenerated.

Use a new claim schema rather than placing 64-character digests in v1's 40-character
`intentCommit`/`previousRecordCommit`. Preserve the semantic fields and attestation; do not
rewrite historical v1 bytes. `coordinator-claim.md` becomes untouched legacy material after
migration, not an authorization input or mandatory generated view. No automatic Git export,
commit, hook execution, remote publication or best-effort audit task is part of adoption.
A later human archival action is not a readiness gate and is not designed here.

### Durable publication and integrity

This must be specified/tested as a persistence protocol, not “write JSON and trust it”:

1. Under the existing shared lock, re-read exact preview/head/config, canonical no-follow paths,
   role/trust/session/endpoint/epoch and collisions; re-probe the selected old endpoint.
2. Write one canonical object to an exclusively created mode-0600 temp; fully write, sync and
   close; verify digest/bytes/schema. Publish to its immutable name with a no-replace operation,
   then durably sync its directory. An existing name is usable only if its bytes match exactly.
3. Compare the still-current published head with the expected predecessor under the lock.
   Write/sync/close a new head temp, perform guarded atomic replace and sync its directory.
   Only a fully verified, durably published head constitutes a ledger commit. Re-read proof
   and config before proceeding. There is no project-Git hook to bypass.
4. Preserve the current config token-patch/publication guards. Prepared ledger commit precedes
   coordinator replacement; active ledger commit follows it; local promotion and a final fresh
   proof precede opening readiness. Ordinary config writes retain admission and final-rename
   authority proofs under the same lock, including every platform retry.

An object visible without a corresponding published head is **not** authority. Unrecognized
ledger-record candidates, partial publications, a corrupt/missing head, gaps/forks, or a head
inconsistent with the config binding must not silently fall back to an older active object.
Use a reserved record-name grammar; non-record artifacts that obstruct no required path are
preserved and nonblocking, not a new directory-wide “untracked files” refusal. Recognized
interrupted publication can be classified for explicit same-command recovery; no automatic
head repair, deletion or replay.
Temps/objects left after uncertainty stay available for diagnosis and cannot approve action.
Synchronizing a file alone does not establish directory-entry durability. Filesystem/platform
support for no-replace publication, directory sync, rename and the crash model is an explicit
implementation gate; an unsupported durability primitive stops as storage unavailable, not
success. Do not claim Windows/power-loss proof from a mocked rename or Linux process-kill test.

Fresh proofs check published head, exact object bytes/digests, linked prepared/prior records,
board root/storage binding and current coordinator pair on **every existing effect boundary**;
no cached “ready” bit, mtime or once-observed hash substitutes for that proof. Do not require
that current config bytes always equal the historical adoption hash after ordinary authorized
roster updates: exact before/after hashes bind the transition/recovery, while live authority
checks preserve the existing pair/local-promotion semantics.

This remains a cooperating local-filesystem contract, not a distributed or hostile-same-user
fence. Hash links and a head detect corruption, missing referenced records and unilateral head
rewind with surviving newer objects; they cannot prove against coherent rollback/deletion of
*all* board/ledger witnesses or a malicious same-user rewrite. Git HEAD/history was not an
external monotonic witness either. Stronger anti-rollback needs an external authority and a
separate decision, not an unspoken claim that a hash chain supplies it.

## Recovery and one-confirmation semantics

| Durable evidence/config | Same-command behavior |
|---|---|
| No evidence and genuinely new format-2 bootstrap | One contextual first-board/declaration yes; no ended attestation |
| Bootstrap-prepared + absent/exact expected initial config | One bootstrap recovery question; initialize at most once, finalize evidence, no ended attestation |
| Prepared + exact before-config | One renewal question, same transition/pairs/hashes; refresh authority evidence as currently specified, then replace once |
| Prepared + exact after-config | One finalization question; active evidence completion only, no replacement/new ended attestation |
| Recognized exact derived active object not yet head-published + after-config | One finalization question; preserve anchored authority; publish only validated completion, never normalize arbitrary bytes |
| Active + exact current pair, local responsibility not loaded | Zero-question, write-free promotion retry; readiness remains closed until success |
| Foreign intent, mismatched config/roster, malformed/newer missing evidence, unrecognized partial append | Stop with exact evidence/phase; no fallback, supersession, repair or second writer |
| Foreign/dead-owner lock | `LOCKED`; existing human owner-death investigation remains, no age/pid cleanup |

The existing role-local `/intercom-adopt` bridge and `Intercom.adoptCoordinator` remain the sole
entry replacement path. No model tool/HTTP writer/CLI/serialized identity or confirmation flag.
Each deciding invocation has exactly one native No-first/Yes question, full context and effects,
no text fields, no extra acknowledgement. Status and active promotion ask none; early refusals
may ask none. Stale decisions refuse; a later explicit invocation asks anew, never loops asking
again within the same run. Ledger terminology changes the displayed effects, not the accepted
widget/selection behavior. The human's yes still attests the backend-selected old coordinator
ended, and disconnected/unknown still proves no termination.

Until active durable evidence and local promotion both verify, coordinator tools, registration,
report persistence/clear, callbacks and reminders remain fenced. Preserve stored-but-not-notified
outcomes, outcome-unknown receipts, no buffering/replay and epoch invalidation across awaits.
Workers/jobs/reports/logs/session history remain untouched; adoption sends no worker messages.

## Legacy migration — bounded, explicit exception

New-format bootstrap and already-migrated boards require **zero Git calls**, even if a `.git`
appears/disappears or injected Git context changes. Legacy v1 is a distinct read-only import
adapter, never an alternative ongoing authority backend once migrated.

For a v1 board, obtain newest reachable claim evidence from the *explicit canonical projects-home
repository*, not a caller-selected Git context. Use bounded/time-limited read-only Git queries
with context/config injection removed; verify newest committed bytes, deletion/malformed-newest
refusal, board root, transition hashes/pairs, and prepared ancestry. Freeze that proof's identity
in the preview and re-prove it under the lock. Bind **claim** history, not unrelated HEAD changes.
A malformed/failed/truncated query is unknown, never absence. Do not execute hooks, stage, commit,
reset, clean, create a repo, or read credential/settings stores.

Crucially, import **committed objects only**, not root-claim worktree or index bytes. Dirty,
staged, deleted, malformed or obstructed `coordinator-claim.md` must not itself veto import of
valid committed evidence: leave it untouched. Staged versions of config are irrelevant too;
actual config bytes still must validate and match the chosen transition. Keep the legacy
prepared-after/derived-active recovery meaning by deriving active from the committed prepared
anchor, not trusting the worktree derivative. No requirement to restore/unstage that file.
If the newest committed claim is deleted/malformed/unreachable, refuse the evidence itself.
Retain the current admissible distinction between configured coordinator and a differing
historical active-claim pair: show both, select the target from the backend's existing branch
rules, and do not introduce a new blanket claim-pair-equals-board prerequisite for adoption.
Prepared recovery still requires its exact before/after config and recorded pairs.

Use the same sole command and existing single question to authorize the selected operation
**plus** copying the verified legacy anchor into the ledger and publishing the version-2 format
binding. A matching v1 active board needs a one-time migration question (not a new adoption or
termination attestation); after migration matching-active retries again ask zero. This is an
explicit compatibility exception to the old zero-question active path, requiring decision 2.
Status remains write-free and reports migration required, never auto-migrates.

The format upgrade changes metadata in addition to the pair **once**; its complete before/after
raw bytes/hashes and unchanged-worker evidence must be preview-bound and persisted. Subsequent
ordinary adoptions still replace only the two coordinator tokens. Crash recovery must distinguish
v1-before-upgrade, v2-upgraded-old-pair, and v2-new-pair and complete the same transition without
a second pair replacement. All config publishers must understand the new format/ledger before
cutover. Existing v1 `validateConfig` rejects `version !== 1`, providing a useful downgrade
barrier after publication, not a guarantee against old cached processes. No mixed-version safety
claim: human-controlled upgrade/quiescence is required; worker relaunch topology is not in scope.

A v1 board with no verifiable repository/history is **migration-provenance unknown**, not a new
format-2 board. A deleted `.git` is not proof that adoption never happened. A truly new board
can be bootstrapped without Git; silently reclassifying an existing v1 board cannot. The human
must recover provenance or separately authorize a different re-establishment policy. Approval
of this ADR must not be described as proof that this legacy availability conflict disappeared.

## Alternatives and policy consequences

- **Only remove unrelated/untracked checks:** rejected; explicitly contradicts “anything else.”
- **Keep other dirty refusals for safety:** rejected; cleanliness is not necessary authoritative
  record safety. Re-express only the independent concrete invariants above.
- **Delete `assertGitSafe`, keep project commits:** rejected; index/HEAD/hooks and live history
  coupling remain; cannot promise unchanged staged content or no dirty-tree influence.
- **Separate index / plumbing commit / private bare Git store:** possible isolation techniques,
  but still require Git object/ref durability, migration and all reader changes. A private bare
  store avoids project cleanliness, not Git availability; no-repo support needs a new store
  anyway. Do not mutate shared HEAD or bypass project hooks using these as a covert workaround.
- **Best-effort Git commit, accept uncommitted root claim on failure:** rejected; loss of durable
  authoritative anchor, unsafe absence/recovery fallback, conditional behavior and false readiness.
- **Pi session `appendEntry` as board authority:** rejected; per-session branchable history is not
  the cross-process board authority or shared config lock. It may record audit context, never grant
  adoption by itself. No new Pi SDK capability is needed for the proposed file store.

At swactory merge `a65c16c`, `roles/orchestrator/AGENTS.role.md` says “declaration must be committed”
and “invalid/prepared/dirty evidence ... stop action.” Its adoption skill step 2/5/6 and the fork's
README/reference describe Git commits/history. A reviewed, human-authorized instruction/source
change must distinguish **invalid authoritative ledger bytes** from **Git dirt** and use durable
ledger evidence/ids. This ADR contains proposed semantics, not an edit of live instructions,
claims or config. Keep worker lease cleanliness/handover/closure policy unchanged: that is
separate from coordinator adoption, not a backdoor adoption prerequisite.

## Evidence and limits of this analysis

Read-only source inspection and public issue/PR/documentation reads only; no fixture execution,
endpoint access, adoption, package installation, settings/credentials access or provider calls.
Pi public README, SDK, extensions, TUI, skills, sessions, session-format and message-types docs,
SDK session example, and relevant exported declarations were read from installed package **1.3.0**.
They support external cross-session storage, read-only captured session manager methods,
`SessionManager.list(cwd, sessionDir)`, command-only idle waiting and existing custom selection;
they do **not** provide an atomic cross-process board transaction/durability proof. The fork's
pinned dev dependency is **0.84.4** and its earlier public-host evidence is **1.2.0**. Reading
1.3.0 docs is not compatibility validation against either; the plan retains explicit host gates.
No new UI, SDK lifecycle/shutdown behavior or provider integration is proposed.

The implementation plan must prove the new persistence/crash protocol and reader equivalence;
this ADR proves neither. AC3 remains open until reviewed behavior is delivered and accepted.
No fresh live smoke is requested or required by this analysis.
