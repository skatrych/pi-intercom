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
stage tuple and valid filename/session relation. Missing or inconsistent source refuses.
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
competing saved identities. A recorded monitor must retain the generic or recorded-owner
legacy marker; mismatched/missing marker refuses, not automatic rename. Foreign labels
discover conflicts, never confer ownership.
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

## 4. AC1 gap and unaccepted metadata-relocation option

The solution's source-supported matrix is mandatory coverage, not optional clarification.
Same-pane handover satisfies the reported fixture; different-pane succession remains a
coverage gap against broad AC1. Do not represent its safe refusal as full AC1 completion.
The smallest recommended extension is **ownership metadata relocation only**, not moving,
closing or restarting a monitor. It needs explicit approval of the changed association
contract (and AC2 interpretation); it is **not part of the authorized algorithm above**:

- Require §2's current exact config pair/root/responsibility and the exact current caller
  from this runtime's `pane current --current` plus `pane get`. Never accept a caller ID
  argument or bind an unrelated root. Reject current caller equal to monitor.
- Resolve one completed predecessor root record (or unambiguous completed v1); validate
  its recorded owner session, original caller, monitor, workspace and original tab. Query
  both old caller and monitor exactly. The monitor must still match its recorded location
  and marker, not have moved. Any extra candidate/lock/partial state refuses.
- For the old caller: explicit not-found can establish it is gone; if present, require its
  original workspace/tab and verifiable Pi session identity matching the saved predecessor
  owner, not merely a label. Existing `src/pane-close.ts:verifyPane` queries `pane get`,
  requires `agent === 'pi'`, `agent_session.source === 'herdr:pi'`, `kind === 'path'`, then
  canonicalizes that path; `verifySessionHeader` safely opens a regular no-follow file and
  checks its first header's session ID. That provider is Linux-only: the recommendation
  needs injected/real supported-host adapter evidence before claiming Windows coverage.
  Reuse this bounded read-only pattern only where supported; no session-history listing.
  A header alone proves neither live process ownership nor termination; even this mapping
  is not hostile repurposing protection. Missing/mismatched data refuses, never means “old
  coordinator ended.” Current config, not endpoint silence/title/header, revokes authority.
- Same-tab new caller: update owner/caller metadata after fresh exact checks, retain the
  original monitor. Different-tab new caller: reuse the **remote display in its original
  tab**, with no new monitor in the successor tab. Store current `callerTab` separately
  from monitor `tab`; each later check verifies both rather than requiring their equality.
  Cross-workspace relocation stays refused unless separately authorized. No need to scan
  session history, persist a succession chain or authenticate old config ports.
- Atomically publish new owner/caller/current-caller-tab after revalidation across awaits;
  preserve monitor identity/location/stage and legacy source. Migration validation must
  compare legacy evidence against the original association, not the rebound caller: the
  extension would need one immutable imported association tuple, **not a growing history**.
  Tests must cover interruption, repeated remote reuse and repurposed/missing old caller.

This is a concrete recommendation for independent review, not authority to add those
fields/checks now. Alternative: explicitly amend AC1 to unchanged same-pane association
and separately track relocation. An undocumented scope cut, or automatic cleanup/rebinding
based only on “old caller no longer coordinator,” is not acceptable. If different-tab AC1
also requires the display to appear beside the successor, metadata-only reuse is insufficient;
that separate placement/destructive-operation choice needs human direction.

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
| AC1 gap | Different-pane same-tab, different-tab and different-workspace fixtures prove baseline reachability/refusal differences and proposed no-duplicate refusals; not marked AC1 passing until §4 resolved |
| AC2 | Wrong session **or bound port**, unloaded responsibility, replaced runtime/root, malformed config, foreign root/record/marker, wrong caller/workspace/tab, moved exact pane, caller marker, multiple candidates, changed/missing legacy source: refuse without ownership/pane mutation |
| AC3 | Every pending stage, old lock without record, root lock, temp, publication/release uncertainty, crash boundaries, read error/budget exhaustion, split timeout before/after simulated mutation, permission loss before/after each await/publication retry: fence survives reload/new successor; concurrent sessions at most one winner |
| AC4–5 | Repeated recognized v2 has no rewrite/rename/run/split/close; exact absence permits one launch, moved/unknown does not. Known-unowned/no-split and genuinely uncertain split diagnostics differ; readiness never inferred |
| Regression/F1 | Creation/reuse/legacy marker, geometry/focus, missing build, Linux/Windows quoting, no workers/first worker/saved disconnected worker, non-Herdr, messaging/worker guards, adoption/promotion pane-effect-free; v2 before matching-pair load/first startup; exact artifact ignores, monitor lock still fences, config/monitor path refusals preserved |

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

Deliver exactly these three docs; no fixtures/submodules. Hand back pushed SHA/clean tree/
index to Coordinator on issue13 for mandatory independent review. No implementation, install,
board repair, thread resolution or operative issue-body change is authorized.
