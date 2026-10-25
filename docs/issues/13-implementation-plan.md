# Issue 13 — Implementation Plan

Companions: [Proposed Solution](13-proposed-solution.md),
[ADR 0013](../adr/0013-root-scoped-monitor-ownership.md).
Requirements: [issue13](https://github.com/skatrych/pi-intercom/issues/13), unchanged body
SHA256 `a68492345de53c3b422882938757bf2e11996ff9eef4d8a55109f86fdd7be0fb`.
Source base: `main@23bc10fa959f179811cc43415921a2a144d40e10`.
Authority dependency: [PR28](https://github.com/skatrych/pi-intercom/pull/28), exact
`8e46bdbcdb1ddfdc7511f63c2fa61bb2542312a5` (ADR0025 and issue25 solution/plan).
This is docs-only planning, not implementation or live repair authorization. The AC1
caller-relocation coverage gap in §4 prevents unconditional implementation-ready routing.

## 1. State and migration

Later implementation changes `src/monitor-launcher.ts`, runtime/index integration,
monitor/extension/runtime tests, `.gitignore`, README and generated `dist`. Recheck locators
after PR28 integration; no stacking/rebase, adoption helper, endpoint, command or dependency.

Use machine-local `.pi-intercom/monitor-owner.json` version 2 with canonical `boardRoot`,
`ownerSessionId`, `caller`, `pane`, `workspace`, `tab`, `stage` and operation ID.
`pane` may be absent only before a split result is known. Keep completed `submitted`/
`observed` and pending `split_pending`/`rename_pending`/`swap_pending`/`run_pending` stages;
unknown stages or incomplete completed identities refuse. Optional `legacySource` is the
exact imported v1 basename, not a hash or authority token. No handover proof/history fields.

Use exclusive-create `monitor-owner.lock`, containing this operation's root/session/token.
All upgraded monitor writers use it; only its matching holder releases it. This is a
**durable monitor uncertainty fence**, not PR28's crash-released `config.lock`: a launch
can outlive its caller and must not become retryable on caller death. Do not reuse the
config transaction lock or extend it across Herdr commands. No age/PID lock takeover.
Pin canonical root; reject symlink/unsafe board, ownership, lock and publication paths.
Publish through exclusive same-directory temp + atomic rename with final permission
checks. Only confirmed success or a known no-effect refusal releases the owned lock;
publication uncertainty retains it and source/temp evidence for inspection.

Under that lock, enumerate this root's producer-shaped v1 `monitor-<24hex>.json` files,
their locks and monitor publication temps, including sessions older than the immediate
predecessor. Any lock, unfinished temp, partial/invalid/unreadable record fences effects;
an invalid v2 never falls back to v1. Validate v1's existing filename/session-key relation
(the producer's SHA256 truncation is compatibility, not a new proof hash). Its canonical
containing directory supplies root binding; it has no stored root/tab. Verify its saved
caller/workspace/pane through exact inventory and establish tab from both live panes.

Import only one unambiguous completed live candidate after §2/§3 checks. Leave v1 unchanged;
v2's `legacySource` identifies the one corroborating record, not a second candidate.
Require that source to remain a safe completed v1 with the same caller/workspace/pane/
stage tuple and valid filename/session relation. Its original `sessionId` is immutable:
when an imported pane retains `Intercom monitor [A]`, compare against that v1 session A,
never the mutable v2 owner B/C. Read it from retained v1; add no marker/history ledger.
Missing or inconsistent source refuses.
Do not hash arbitrary bytes: field validation/association, not byte provenance, protects
this cooperating-local-filesystem migration. Other live records conflict; completed
records with positively absent panes remain historical, not selectable by age. Locks/
partial states always fence, even for historical or imported records. Revalidate this
inventory and saved identities before publication/effects. No other-root scan or cleanup.

**F1 integration under PR28:** add exact ignore entries for `monitor-owner.json`,
`monitor-owner.lock` and owned publication temps; retain legacy ignores. PR28 deletes
`inspectBoardNamespace`/first declaration, so do **not** revive/extend that obsolete
adoption allowlist. A valid v2/lock must not obstruct first-board initialization or a
matching-config responsibility load merely by existing; a lock still fences monitor
work. Preserve config/root path refusals, monitor-file symlink/foreign-root refusals
and board isolation. Foreign unrelated artifacts are not a new adoption allowlist gate.

## 2. Current permission and bounded lookup

Require PR28's current strict-config coordinator pair to match this runtime's native
session/actually bound port, with local responsibility loaded for the pinned root. Reuse
its fresh runtime-owned check, not cached `me.coordinator` or caller-supplied identity/proof.
Check admission, before/after awaits, immediately before publication/pane effects, retries
and success. Observed drift ends the invocation; later loading cannot resume it. Preserve
lifecycle generation/root/path/worker/target/job guards, empty-roster/non-Herdr behavior.
P3 boot publication/loading precedes monitor work; monitor setup never repairs ports.
No claims, Git, epochs, attestations or chain: the current coordinator can take over the
associated display regardless of how many sessions preceded it.

Use `pane current --current` for the actual caller, workspace inventory for discovery,
and `pane get <exact-id>` for saved caller/monitor identities and any incomplete rows.
Match workspace/tab explicitly; a moved pane is not absent. Only a structured explicit
not-found for the requested ID establishes absence. Empty output, nonzero exit, malformed
JSON, timeout, transport failure or unsupported lookup is uncertainty, not absence.
`src/pane-close.ts` demonstrates exact lookup and a 4000ms bounded runner, but does not
establish a documented not-found payload: test the supported Herdr adapter contract;
if a host cannot distinguish it, refuse replacement rather than interpret an error string.

**Lookup budget:** at most 4000ms per read-only Herdr subprocess, 20000ms aggregate elapsed
read budget per check and 16 read calls, whichever limit is reached first; zero retries,
abort on the first error. Each timeout is `min(4000ms, remaining read budget)`, not 16 × 4s.
Deduct all initial/final inventories and exact lookups. Refuse when a complete classification cannot
fit, not partial success. Apply real subprocess timeout/termination and await settlement,
not a `Promise.race` leaving work pending. Cap output at 1 MiB. The 20s budget is not a hard
OS/process-cleanup or filesystem deadline; a stalled cleanup never licenses lock release
while work is unresolved. Keep existing 40000ms mutation-command bound (`src/launcher.ts`),
no mutation retries; timeout after submission is durable uncertainty. Pre-effect read
failure releases only this operation's no-effect lock; after a pending effect it retains
the record/lock. Test injected runners against these limits without sleeping/live Herdr.

## 3. Reconciliation and failure table

Classify **all** conflicts before reuse/import: every generic/session-bearing label in the
current tab, all root-record candidates irrespective of tab, caller-as-monitor, moved or
competing saved identities. A recorded monitor must retain the generic label, or, for an
imported v1, the immutable source-session legacy marker (§1). A marker-only migration with
no v1 must finish its existing rename; an uncertain rename remains fenced. Mismatched/
missing markers refuse, not automatic rename. Foreign labels discover conflicts, never
confer ownership.
Do not select the newest record or ignore another caller's root record to launch anew.

| State after complete inventory and fresh permission | Result |
|---|---|
| Lock/partial/temp/invalid state, conflict, missing identity or lost permission | Inspection refusal; no fallback or pane mutation |
| Completed v2; exact saved caller/monitor/workspace/tab match current association | Current owner: reuse without rewrite. Different owner: atomically update owner/operation ID only; same pane and stage |
| No v2; one completed v1 live candidate with exact current caller/workspace/tab association | Import v2 for current coordinator, regardless of old session; preserve v1 and pane |
| No record; one current-session legacy marker, same tab and verified caller association; no conflicts | Preserve existing label migration: publish observed v2 and rename only that verified legacy marker |
| Generic-only/foreign marker, different caller/tab/workspace, moved monitor, multiple candidates | Name IDs and failed association; refuse without claim, split, rename, run or close |
| Completed record, exact caller/workspace/tab match, monitor positively absent, no candidates/fences | One ordinary replacement launch for current root coordinator; absence must be exact, not list-filter absence |
| No ownership evidence/candidate/fence | One ordinary launch |
| Legacy history only with no unambiguous associated owner | Refuse; history is not permission for a new first launch |

Handover/import changes no pane; repeated v2 checks make no rewrite/command. Renaming a
current-session legacy marker is the existing exception, not predecessor handover.
Launches retain preflight/quoting/no-focus/geometry checks; save `split_pending` before
split, then distinct returned ID and each pre-effect stage. `submitted` acknowledges
command submission only, not readiness.
On confirmed-absence replacement, the new pending/completed record drops `legacySource`;
the untouched v1 now belongs to positively absent history, not the replacement pane.

Pre-effect refusal names known candidates/root/owner and “no pane mutation attempted.”
After split submission name returned ID or “identity unknown” and persisted stage. An
uncertain filesystem publication, command, lock release or interruption retains evidence;
never auto-unlink a fence, retry, roll back, retire or clean up. Crash after successful
publication but before lock release still requires inspection. Revalidation cannot recall
submitted OS work or make Herdr association checks atomic against external pane changes.

## 4. B2: complete-coverage recommendation — unaccepted

Same-pane handover resolves the reported fixture; different-pane/tab/workspace refusal
still leaves broad AC1 unmet. [Independent B2](https://github.com/skatrych/pi-intercom/pull/31#issuecomment-6402577463)
blocks complete implementation approval. **Everything below is a proposed extension,
not a change to the authorized §3 table or operative AC1/AC2.** Captain's placement decision
is pending. Recommend one display in its original location across all successor locations;
only owner/managing-caller metadata changes, with no pane command or automatic cleanup.

### Feasibility and association meaning

Herdr `workspace_id` is a UI container, not a filesystem board root or Git worktree.
`monitor-launcher.ts` runs the display with `--root options.root`; `monitor.ts:createMonitor`
reads snapshots from that root, not its tab/workspace or the coordinator's pane. Thus a
successor in another **Herdr** workspace can manage the same root display without changing
its command. Another canonical project/board root never qualifies. PR28 root/cwd/board-
isolation guards still determine runtime access; Herdr placement does not widen it.

`pane get <exact-id>` has no workspace filter in `src/pane-close.ts`; the launcher already
uses `pane list --workspace <id>`. These are concrete API shapes for exact old/new lookups
and inventories in both containers, not proof of installed-host cross-workspace support.
Its close provider additionally enforces same-workspace policy for destructive worker
closure: do not weaken/reuse that close permission for monitor metadata. Require adapter
coverage for exact remote lookup/inventory/structured absence on supported hosts; inability
refuses safely and blocks that host's coverage claim, not permission to create locally.

Proposed AC2 meaning: verify **two explicit associations**, never relax matching to a label:
(1) immutable monitor/root/original-location provenance; (2) the current managing runtime/
caller at its own recorded location. Intentional successor caller changes are distinct from
an existing recorded pane moving. Unexpected monitor or prior managing-caller movement,
foreign-root/session mapping, conflicts or missing evidence still refuse. Root config grants
current authority; neither a header/title nor endpoint silence proves termination.

### Proposed schema and operation

1. Keep v2 `caller/workspace/tab` as the original launch/import association and `pane` as
   the monitor. Add optional `manager: {caller, workspace, tab}` only for an intentionally
   different managing caller; absent means the original association. `ownerSessionId`
   names that manager's session. Keep exactly one current manager, no owner history.
   This preserves legacy-source tuple validation and F2's immutable v1 marker session
   without a second imported snapshot. Historical original caller is provenance, not a
   current live-manager requirement after reassociation; the monitor must remain at its
   original workspace/tab. Store this semantic distinction explicitly in the selected
   final schema/docs before coding; unknown shapes remain invalid.
2. Under the existing root lock and §2 permission/budget, get this runtime's actual caller
   with `pane current --current` and exact `pane get`; require returned IDs/workspace/tab
   agreement and caller != monitor. Resolve one completed same-root predecessor, current
   owner session, effective prior manager and exact monitor. Inventory current and saved
   monitor/manager workspaces (deduplicate); all candidates/fences must be accounted for.
3. Exact monitor lookup must match its saved pane/workspace/tab and generic or immutable
   source marker. Same effective caller/location permits ordinary same-pane succession;
   do not demand the *old* session still inhabit the pane now occupied by this successor.
   For a different caller, query the prior manager: explicit not-found suffices for v2;
   if present require saved location and Pi session mapping to the recorded prior owner.
   A moved, repurposed or unidentifiable prior manager refuses, not automatic adoption.
4. Mapping source: `pane-close.ts:verifyPane` requires `agent === 'pi'`,
   `agent_session.source === 'herdr:pi'`, `kind === 'path'` and a canonical session path;
   `verifySessionHeader` uses no-follow regular-file access and a bounded first-header ID
   check. Its full close verifier additionally checks foreground PID/start. Reuse only
   the bounded read-only association pattern, not its close path or a session-history scan.
   Header/path mapping is not a live process/termination proof or hostile-repurposing
   defense. The existing provider is Linux-only; Windows mapping needs actual adapter
   evidence before coverage is claimed. Missing/unsupported data refuses.
5. For v1 import, the original live caller/monitor must still establish their common
   original workspace/tab (v1 stores no tab); check source owner mapping if caller differs
   from successor. An absent v1 caller cannot supply that missing association and refuses
   as insufficient AC2 evidence, not an AC1 success. For valid v1, retain source, populate
   original tuple/tab, and set the current manager separately. For v2 an absent old manager
   is allowed because the completed record already saved its association. Neither path
   infers root binding from a Herdr workspace or accepts a generic-only pane.
6. Revalidate exact prior/new/monitor associations, root/config/load and fences before one
   atomic owner/manager publication; permission checks bracket all awaits. Keep original
   tuple/pane/stage/legacy source unchanged. Same-tab, different-tab and different-workspace
   successors all reuse this original display: no focus/tab switch, split/move/swap/rename/
   run/close. Repeated checks validate the current manager and immutable monitor, with no
   rewrite. Another successor verifies the last manager, not an accumulated chain. On a
   separately permitted confirmed-absence replacement, launch once beside the current
   caller and reset original tuple/manager/source for that new pane; never while uncertain.

Success must name **both** manager and display workspace/tab/pane, explicitly “display
retained in original location; process readiness not checked.” Nothing automatically
appears beside a remote successor. This is the smallest full-AC1 placement recommendation
for verifiably associated monitors. If Captain requires beside-successor placement, it
is not met by metadata-only reuse; a separate safely controlled placement contract is
needed. No scope amendment, AC2 rewrite, pane relocation or caller rebinding is selected
by this analysis; independent review and Captain's decision precede a final integrated plan.

## 5. Sequence, validation and review dispositions

1. After independent design review/human gate and resolution of §4, wait for PR28's
   implementation integration. Recheck exact-pair/load/P3 boundaries and source locators.
   Its selected native provider, semantic config writer and boot recovery are dependencies,
   not decisions to reopen or duplicate in monitor code.
2. Add state/lock/migration and current-permission tests, then root-scoped reconciliation.
   Wire existing serialized startup/reload/first-worker checks; no monitor call from adoption
   or promotion. Include F1 ignore/load regressions; no obsolete declaration namespace scan.
3. Update README operations, build, run focused monitor/extension/runtime tests,
   `npm run typecheck`, `npm test`, then `npm run check:package` where available.
   Independent review of actual implementation follows; no live adoption/Herdr validation.

Use temporary board roots, synthetic session IDs/config and injected Herdr runner/inventory.
Record before/after ownership bytes, inventory and command traces, not only message strings.

| Coverage | Required assertions |
|---|---|
| AC1 supported path | Registered worker, v1 then v2 predecessor, current successor config pair + loaded responsibility, unchanged association: one successor-owned original pane, v1 preserved, no split/run/close; repeat after multiple replacements without any claim/history |
| B2 proposal, pending selection | Valid completed v1/v2: same caller, different pane/same tab, different tab and different Herdr workspace **for the same root** each retain one original display; publish only owner/manager metadata, then repeat and transfer again. v1 with absent caller/missing tab evidence refuses. No full-AC1 pass claim before selection/implementation |
| Proposed AC2 controls | Changed actual canonical root, moved original monitor/prior manager, wrong Pi session mapping, current/monitor caller collision, competing marker in either workspace, unsupported exact lookup/absence or changed source refuse. One absent original caller after a completed v2 reassociation is historical, not permission to skip current-manager checks |
| AC2 | Wrong session **or bound port**, unloaded responsibility, replaced runtime/root, malformed config, foreign root/record/marker, wrong caller/workspace/tab, moved exact pane, caller marker, multiple candidates, changed/missing legacy source: refuse without ownership/pane mutation |
| AC3 | Every pending stage, old lock without record, root lock, temp, publication/release uncertainty, crash boundaries, read error/budget exhaustion, split timeout before/after simulated mutation, permission loss before/after each await/publication retry: fence survives reload/new successor; concurrent sessions at most one winner |
| AC4–5 | Repeated recognized v2 has no rewrite/rename/run/split/close; exact absence permits one launch, moved/unknown does not. Known-unowned/no-split and genuinely uncertain split diagnostics differ; readiness never inferred |
| Regression/F1/F2 | Retain creation/reuse/geometry/focus/build/quoting/empty-roster/non-Herdr/worker/adoption regressions and F1 ignores/startup/load/path tests. Import valid observed v1 `[A]` under B → repeat → C transfer → repeat: accept immutable A marker, v1 byte-identical, no rename/run/split/close; wrong `[B]`/`[C]` or changed/missing source refuses |

This round validates docs/links/whitespace only, not behavior (including the historical
8/8 baseline). No build/runtime test, probe, install or board/pane write. Retire/reload old
monitor writers before deployment; PR28's whole-board upgrade is not termination proof.
Risks: mixed writers, filesystem interruption, unsupported identity/not-found data and
same-user record/pane forgery. No distributed/process-provenance/cancellation guarantee.

| Review source | Disposition in this round |
|---|---|
| Petro [original review](https://github.com/skatrych/pi-intercom/pull/31#pullrequestreview-5622249196), [authority inline](https://github.com/skatrych/pi-intercom/pull/31#discussion_r4354675537), [chain inline](https://github.com/skatrych/pi-intercom/pull/31#discussion_r4354675630) | Addressed: current-config/root/loaded responsibility + exact association replace all removed proof machinery, fields, tests and ADR consequence; implementation after PR28 integration |
| Petro [caller/tab inline](https://github.com/skatrych/pi-intercom/pull/31#discussion_r4354675717), original review §2 | Coverage gap acknowledged, source matrix and concrete unaccepted metadata-only option in §4; no silent AC1 narrowing or unauthorized rebinding |
| Original review size, migration, lookup, consequences | Addressed: remove history/proof sections and repeated narrative, keep actionable state/migration/tests; no new source-byte hash; concrete 4s/20s/16-read/zero-retry budget; concise ADR |
| Petro [drift review](https://github.com/skatrych/pi-intercom/pull/31#pullrequestreview-5630892995), [claim-free inline](https://github.com/skatrych/pi-intercom/pull/31#discussion_r4361483318) | Addressed: no claim-free cross-session refusal; same rule for every current coordinator. ADR top headings match current Architect rules and PR28 exact dependency: Decision Statement / Short Summary / Details |
| Independent [B1](https://github.com/skatrych/pi-intercom/pull/31#issuecomment-6362731506) and [Captain routing](https://github.com/skatrych/pi-intercom/issues/13#issuecomment-6402437740) | Authority choice settled by Captain; incompatible proof contract removed. Fresh independent review still required; §4 remains a separate coverage choice |
| Independent [F1](https://github.com/skatrych/pi-intercom/pull/31#issuecomment-6344223490), [accepted carry](https://github.com/skatrych/pi-intercom/pull/31#issuecomment-6344246768) | Retained and adapted explicitly in §1/§5: artifact/lock ignores and load/startup regression; obsolete adoption allowlist/declaration removed by PR28, not revived; path/foreign-root safety retained |
| Independent [F2/B2](https://github.com/skatrych/pi-intercom/pull/31#issuecomment-6402577463), [routing/handover](https://github.com/skatrych/pi-intercom/issues/13#issuecomment-6402585516) | F2 corrected in §1/§3/test matrix using retained immutable v1 session. B2 remains blocking/unselected: §4 now proposes all Herdr placements for one canonical root, explicit remote-display semantics and AC2 association meaning; not authority to implement/rebind or silently narrow AC1 |

Deliver exactly these three docs; no fixtures/submodules. Hand back pushed SHA/clean tree/
index to Coordinator on issue13 for mandatory independent review. No implementation, install,
board repair, thread resolution or operative issue-body change is authorized.
