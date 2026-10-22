# Issue 13 — Implementation Plan

Companion: [Proposed Solution](13-proposed-solution.md),
[ADR 0013](../adr/0013-root-scoped-monitor-ownership.md).
Requirements snapshot: issue body SHA256
`a68492345de53c3b422882938757bf2e11996ff9eef4d8a55109f86fdd7be0fb`;
source base `main@23bc10fa959f179811cc43415921a2a144d40e10`.
This is a design baseline for later authorization, not permission to repair a live board.

## 1. Components and persistence

Change `src/monitor-launcher.ts`, narrowly integrate authority/proof in
`src/runtime.ts`, `src/adoption.ts` and `src/index.ts`, extend isolated monitor,
extension and adoption regressions, and update README's monitor operations section.
Follow the repository build convention for generated `dist` during implementation.
Do not add a tool, endpoint, slash command, adoption consent step or dependency.

### Root-scoped state

Use `.pi-intercom/monitor-owner.json` (version 2) and
`.pi-intercom/monitor-owner.lock`, both machine-local. The record contains:

- canonical `boardRoot`, `ownerSessionId`, `workspace`, `tab`, `caller`, optional
  `pane` only while the split identity is unknown, and `stage`;
- operation ID for the last launch/publication;
- optional `importedLegacy`: exact basename and SHA256 of the original v1 record;
- optional `handover`: prior owner session, verified active adoption commit and
  transition ID authorizing the latest transfer.

Require exact types, nonempty bounded identifiers, recognized stage/version and
safe regular-file paths. Keep the existing completed stages `submitted` and
`observed`, and launch stages `split_pending`, `rename_pending`, `swap_pending`,
`run_pending`. Missing required pane identity in a completed record is invalid.
Do not turn an unknown stage into a completed stage. No process-ready stage is added.

The lock is exclusive creation, with an operation ID and owning session/root.
All upgraded checks, imports, handovers and launches use this same lock. Only the
operation holding its matching token may release it. No age/PID-based takeover.
Check canonical root and non-symlink board directory/file paths; do not follow an
ownership file into another root. Temporary publication files are unique, local,
exclusive and atomically renamed. Check authority immediately before publication.

### Legacy inventory, including fences

Under the root lock, enumerate **all** legacy `monitor-<24-hex>.json` records,
their `.lock` files and unfinished monitor publication `.tmp` files in this board,
not just records keyed by current/previous sessions. Revalidate the inventory before
an effect. A partial/invalid/unreadable record, any legacy lock (even without its
record), or unfinished publication refuses further effects. A canonical malformed,
partial or foreign-root record likewise refuses; never fall back to a legacy file.

Validate each v1 filename against its payload session hash. The canonical containing
board directory supplies v1's root binding; v1 has no embedded root or tab. Do not
scan other roots, import user-supplied paths or guess provenance from a label.
The saved caller/workspace/pane plus current Herdr association supply the remaining
legacy identity evidence. This retains the existing cooperating-filesystem trust
model; it does not authenticate a deliberately copied/forged same-user record.

Preserve the imported v1 file unchanged. Once v2 is published, only its exact
`importedLegacy` bytes are superseded for candidate selection, not its locks or
partial-state checks. Missing/changed imported evidence is an inspection case.
Other completed legacy records with positively absent panes are historical evidence,
not candidates; retain them. Other live records are competing ownership evidence and
must be accounted for before creation/handover; do not choose “newest.”

## 2. Authority and succession proof

Expose a narrow **internal**, runtime-owned monitor authorization capability. It
captures runtime/session generation and action-readiness epoch, pins canonical root,
current coordinator identity and responsibility, and provides a fresh assertion for
every effect. Extend the existing runtime guard rather than treating the boolean
`coordinatorActionReady()` as fresh external-evidence approval.

For adopted boards, use `assertActionReady`'s current claim/config/committed-evidence
proof at final-effect boundaries. For claim-free legacy coordinators, still verify
that this session is the current coordinator in the bound board; permit ordinary
same-session behavior but never infer cross-session succession. Session/epoch loss,
changed config/claim, unavailable Git evidence or unloaded responsibility stops the
operation. Check immediately before and after awaited Herdr commands, and before
ownership publication and successful return. A stale capability cannot revive when
readiness later reopens.

Add a read-only adoption proof helper, reusing the existing canonical parser and
active/prepared ancestry proof, not a second weaker interpretation of claim JSON.
It verifies the newest committed active claim, identical worktree bytes, root,
current board pair, local promotion and captured epoch. Then:

1. A completed adoption's `previous` identity is the direct predecessor, including
   adoption from a board without older claim history. Its ended attestation and
   prepared-to-active derivation must already validate through existing proof.
2. If the monitor owner is older, walk `previousRecordCommit` links. Each historical
   active claim must be canonical, committed, same-root, an ancestor of its successor's
   prepared intent, and have a coordinator pair equal to that successor's `previous`.
   Validate its own prepared-to-active derivation before using its `previous` edge.
3. Prepared-before renewal may leave intermediate prepared claims in these links.
   Traverse only anchored renewal records of the **same transition**, root,
   coordinator/previous pairs and before/after hashes, following their prior links
   until the historical active predecessor is reached. A prepared record by itself
   never supplies a completed succession edge.
4. Stop at the first matched owner. A first declaration supplies no predecessor;
   cycles, missing objects, unrelated transitions, inconsistent pairs, resource-bound
   exhaustion or broken ancestry refuse. Do not search arbitrary older commits for
   a convenient match. Pin the proof to the current active commit/epoch and reprove
   it before ownership publication.

Keep this capability inside runtime/launcher integration. No external caller may
supply an owner, predecessor, “confirmed” flag or serialized proof as authority.
Preserve adoption's existing transaction and promotion semantics: do not call monitor
setup from `adoptCoordinator` or `promoteCoordinator`.

## 3. Reconciliation algorithm

Preserve non-Herdr early return and empty-roster skip. Use Herdr's actual
`pane current --current`, not focused-pane or stale environment-ID fallback.
Use complete workspace inventory for current-tab candidates. Discover both generic
and session-bearing monitor labels, including foreign-session markers; an unowned
foreign marker in the caller tab blocks creation, never grants ownership. For each
recorded pane that appears missing, query `pane get <exact-id>` (already used by this repo's
close provider): only an explicit not-found is absence; transport errors, malformed
results or unsupported lookup are uncertainty. Lookup that finds another workspace
or tab means moved, not absent. Validate workspace/tab identity of rows, querying
the exact pane when a list does not supply enough identity data.

After acquiring the root lock and validating all evidence, classify conflicts
**before** any positive reuse/import path. Extra current-tab generic labels or
session markers are competing candidates, including when one owned pane already
matches. The exact imported legacy record corroborates v2, not a second candidate.
Apply this order:

| State | Action |
|---|---|
| Any unresolved lock, partial publication/launch, invalid state or lost authority | Refuse; no pane changes, no fallback. |
| Completed v2 with live matching caller/monitor/workspace/tab | Reuse if owner is current; otherwise require verified succession and publish owner transfer. |
| No v2; exactly one completed v1 live candidate bound to this caller/workspace, same current tab | Import if same-session; otherwise require verified succession, then publish v2 for successor. |
| No record; exactly one current-session legacy marker, valid caller association and no other candidate | Retain existing legacy-label migration, capture v2 identities; rename only that verified legacy pane. |
| Foreign owner without succession, generic-only, caller marker, multiple/conflicting candidates, or moved pane | Refuse with exact IDs/failed association; no claim, rename, split or command injection. |
| Completed owned state and positively absent monitor | Require current ownership or succession proof, matching saved caller/workspace/tab where recorded, and no competing candidate/fence; allow one normal replacement launch. |
| No ownership records, candidate or fence | Allow one normal launch. |
| Legacy history exists but no unambiguous completed current/verified-predecessor owner can be selected | Refuse; do not select a record by age or treat its absence as a claim-free first launch. |

For v1, establish tab association from the live saved caller and monitor, since it
was not persisted. For v2, saved tab must also match. Any additional recorded identity
must match; never discard a mismatch to make migration succeed. A known record for
another caller does not become permission to create a monitor for the new caller.
A current-tab generic label or session marker with no verified association blocks
creation even when an owned record's old pane has disappeared.

For handover, preserve pane/caller/workspace/tab and completed stage. Atomically
publish v2 with successor owner, operation ID and handover evidence; no rename,
split, swap, close, focus change or `pane run`. On legacy import record its byte hash.
Release the owned lock only after confirmed publication and final authority check.
Repeated checks then recognize v2, with no ownership rewrite or pane command.

For a new/replacement launch, retain the existing explicit entrypoint preflight,
no-focus split, geometry/focus verification, quoting and platform behavior. Persist
`split_pending` **before** splitting; persist the returned distinct pane ID before
renaming; preserve each existing pre-effect stage. Publish `submitted` only after
command submission is acknowledged. Never run a command in a reused pane.

## 4. Interruption and diagnostics

- Pre-effect refusal releases only this operation's lock, changes no ownership
  evidence/panes, and identifies the known candidate(s), root, owner and failed
  identity/proof or fence. Say “no pane mutation attempted,” not “unknown pane remains.”
- Once a launch stage is persisted, any failure/timeout/authority loss retains that
  durable partial record. Once handover/import publication is attempted, an uncertain
  filesystem outcome retains the root lock, source evidence and any temp file. No
  finally block may erase a fence to make the next session work. Known no-effect
  refusals and fully verified success are the only normal lock-release paths.
- Crash after lock acquisition, after successful ownership publication but before
  release, or uncertain lock release is an inspection case. A lock left by a finished
  operation is still not auto-cleared. State may be published despite a failed receipt;
  report that accurately, never retry or overwrite automatically.
- During split uncertainty, distinguish “split submitted; resulting pane ID unknown”
  from a known returned pane ID. Later failures name pane ID and persisted stage.
  A command failure does not establish whether its mutation occurred.
- Success says “ownership handed over / existing pane preserved; process readiness
  not checked” or “command submitted; readiness not awaited.” Never report a live
  monitor process, retirement or cleanup from inventory alone.

Recovery remains operator inspection, outside automatic setup. Documentation names
root/legacy records and locks and the exact association to inspect; it does not
instruct deleting locks, closing a label-matched pane or editing an owner session to
bypass the proof. Repeated checks, session replacement and time passage grant no
recovery authority. There is no retirement or closure branch in this implementation.

## 5. Implementation sequence and validation

1. Add persistence/legacy classification and root-lock tests, then implement them.
2. Add verified succession and pinned runtime authority capability; cover immediate,
   multi-adoption and renewal history paths and all proof refusals.
3. Wire reconciliation through existing serialized monitor task/startup/configure
   paths. Keep adoption/promotion pane-effect-free. Add accurate diagnostics.
4. Update operational docs; build and run focused tests, full tests and typecheck.
   Run package gate separately where network is available. Do not run live adoption
   or production Herdr commands as implementation validation.

All new tests use temporary board roots, synthetic session IDs/claims and an
injected Herdr inventory/runner. Git proof fixtures use disposable Git repositories;
no installed role or live `.pi-intercom` access. Retain before/after record bytes,
inventory and **command traces**, with explicit no-mutation assertions:

| Coverage | Required evidence |
|---|---|
| AC1 | Registered worker, completed predecessor v1 generic-label pane, valid committed adoption, unchanged caller association: one v2 successor owner, original v1 unchanged, exactly the same monitor pane, no split/run/close. Repeat for existing v2, multi-adoption and renewed adoption. |
| AC2 | Foreign root/session, config-only ID edit, declaration without predecessor, malformed/deleted/newer/dirty/prepared/unreachable claim, unloaded promotion, wrong caller/workspace/tab, moved exact pane, caller marker, multiple candidates, missing fields and changed source hash: refusal, unchanged panes/ownership evidence. |
| AC3 | Every pending stage, legacy lock without record, canonical lock, temp publication, malformed state, split timeout before/after simulated mutation, unknown returned pane, publication/lock-release uncertainty, crash boundaries and epoch/authority loss before/after each await: fence survives reload and another successor; no blind retry or cleanup. Include concurrent different-session checks, with at most one mutation winner. |
| AC4 | Repeated same/successor-session checks after successful import/handover: one pane, no further record rewrite/rename/run/split/close, truthful readiness outcome. Confirmed absent completed pane may launch once; moved/unknown absence never may. |
| AC5 | Known-unowned generic pane refusal names its ID and no attempted split. Genuinely uncertain split names the pending stage and unknown/new pane accurately. Compare traces, not only strings. |
| Regression | Ordinary creation, same-session reuse, current-session legacy-label migration, missing pane, no workers, first worker, saved disconnected worker, non-Herdr, missing build, Windows quoting and Linux quoting, geometry/focus, messaging unaffected by monitor refusal, adoption/promotion no pane effects. |

Suggested gates: `node --test tests/monitor-launcher.test.mjs` after build,
`npm run typecheck`, `npm test`, `npm run check:package`. Extend relevant runtime,
extension and adoption tests rather than relying only on a mocked proof boolean.
Unsupported/missing Herdr identity data must produce a tested safe refusal, not a
claim of all-host support. Real Windows/Linux Herdr smoke, if separately authorized,
is deployment evidence rather than a substitute for isolated fault injection.

## 6. Design validation, risks and handover

Read the full current issue body/comments and the reviewed Swactory shared/Architect
source instructions (`swactory origin/main` at
`c80197daa373723a1834ba48b15081d30d32869e`). No approved-body drift.
Read launcher/runtime/adoption proof and relevant tests at the recorded base.
Ran the committed baseline `tests/monitor-launcher.test.mjs`: 8/8 pass, no build or
tracked changes. An isolated ephemeral injected-runner probe reproduced the
successor generic-label refusal with only `current,list`, unchanged predecessor
record and unchanged inventory. A prior `split_pending` record and lock were ignored
by the successor, which reached entrypoint preflight instead of reporting the fence.
All temporary probe/test roots were removed. No live board/pane was inspected.

These checks do not validate the proposed implementation; its new behavior remains
unimplemented. No full suite, package gate, new fault-injection suite, installed
version comparison or real Herdr smoke is claimed for this docs-only assignment.

Main risks are incomplete legacy provenance, ancestry/renewal proof mistakes,
cross-version writers and filesystem interruption. Conservative refusal is preferred
to duplicate creation. Deployment must retire/reload older monitor writers before
using the new lock protocol; active adoption already requires the named predecessor
ended. A same-user forged root-local v1 record or identically repurposed pane cannot
be authenticated retrospectively; no process readiness/provenance detector is added.
There are no unresolved design choices requiring Developer risk acceptance and no
live recovery authorization. Local helper structure, bounded I/O implementation and
error formatting remain Developer choices, subject to the contracts above.

Deliverables are exactly the Proposed Solution, this plan and ADR 0013 under `docs/`.
Declared remaining fixtures: **none**. Intended handover: Coordinator publishes the
docs-only draft architecture PR and dispatches independent review; implementation
waits for subsequent workflow authorization. Workspace write ownership remains with
the assigned Architect until the Coordinator records its transfer.
