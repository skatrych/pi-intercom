# ADR 0025: Adoption is a config-entry replacement, not an evidence system

## Decision

**Use the board config entry itself as coordinator authority: its `sessionId` and `port`.
Remove the claim/evidence system, rather than replace Git with another authority store.**

The human's 2026-10-21 [ruling](https://github.com/skatrych/pi-intercom/issues/25#issuecomment-6325707173)
is the policy basis:

> i want things to be simple and stupid. No special registration of new session adoption,
> not traceability etc. We just a step beyond prototype.

Together with issue #25's zero-Git-tree-influence requirement, this supersedes this PR's earlier
ledger proposal. No ledger approval, schema migration or provenance-recovery decision is requested.
Status: **design for independent review; not implemented**. Inspected source base:
`main@c6e414f22e09c7a9b50f1331eddd31b0f0e35d66` (0.9.0).
[Implementation/test rewrite plan](0025-git-independent-adoption-plan.md).

### Minimal contract

- Keep the sole human entry path: role-local `/intercom-adopt` → `Intercom.adoptCoordinator`.
  No model tool, HTTP writer, second command, caller-provided identity/port or confirmation flag.
- Capture this running Pi session's native id and actually bound runtime endpoint port. No
  adoption registration, persisted-session-file proof, session-store listing or evidence record.
- Show the projects-home board, configured old pair, actual new pair and replacement effect.
  Ask **one native No-first yes/no**. No typed wording, termination attestation, UUID, recorded
  answer, prepared-intent, renewal or finalization question. No/Esc/dismiss changes nothing.
- Refuse if the new session id is already configured as another entry, or its port is already
  used by any configured entry. Binding the endpoint must also succeed; never adopt a guessed or
  caller-supplied port.
- Probe the configured old coordinator before asking and again under the all-writer lock before
  replacing it. A matching live endpoint refuses. Disconnected/unknown is not proof of death;
  show that limitation, then let the single yes authorize replacement, not certify termination.
- Under the existing all-writer lock, recheck the displayed config and current identity, then
  atomically publish the existing lossless **two-token patch**. That publication is adoption.
  Preserve the coordinator entry's name/description and all other config bytes, workers and jobs.
- Load responsibility in place from that entry. Do not restart/reload workers, send them work,
  clear reports, rewrite jobs, or start a model turn as part of adoption.

Existing role/trust/interactive-context checks, runtime lifecycle validity, canonical config/path
safety and config validation remain ordinary prerequisites, not new proof machinery.
**`countBoards` stays:** counting `.pi-intercom` directories on cwd → projects home, including
empty/malformed extra boards, is the **board-isolation gate, not traceability**. Refuse a second
or wrong board, or an outside/aliased root; do not discover above projects home or create a
private child board. Drop the claim path and unrelated-file namespace scans from adoption.

## Branches and failures

| Current config state | Behavior |
|---|---|
| No board, cwd is projects home | One initialization yes/no; use existing atomic no-replace config initialization, then load responsibility. No declaration record |
| No board in a child cwd | Stop; do not create a board |
| Coordinator pair already equals this runtime pair | Already authorized by config; no declaration/question/write. Load responsibility if needed |
| Same session id but different endpoint port | Identity mismatch; do not silently rebind it |
| This session id is a configured worker | Session collision; no worker promotion/removal/rebind |
| Different coordinator, fresh unconfigured session and unused port | One adoption yes/no, locked recheck/probe, one atomic pair replacement |
| Invalid/unreadable config, unsafe path, foreign lock or stale preview | Stop; no repair, lock stealing or stale-answer reuse |

After a yes, any config-byte/roster change, changed runtime identity/endpoint, changed board path
or board count invalidates the preview. Stop, do not merge/re-preview/re-ask in that invocation.
Ordinary writers and two adopters serialize on the same existing lock. The old coordinator's
queued config update must fail when it acquires the lock after the replacement.

Status is read-only: report current config/identity and whether local responsibility is loaded;
no question, promotion or write. It never classifies historical claims.

If a step fails before publication: report the storage/lock/identity failure; do not claim adoption.
After successful publication but failed responsibility loading: report **config replaced,
local promotion pending**. The config remains authoritative; explicit invocation retries the
load without a question or second replacement. If a publication result is uncertain, say so;
read the current config on a later explicit invocation. Old pair means a new adoption decision;
matching new pair means load only; a different pair means a new preview. No rollback, replay,
prepared state or durable consent is inferred. A surviving foreign lock remains a stop requiring
separate owner investigation, never automatic age/pid cleanup.

Atomic publication means readers see complete old or new JSON; it is not a new power-loss or
distributed-fencing guarantee. Reuse the store's synced-temp/atomic-publish mechanics and their
existing platform retries, not a new fsync/barrier/recovery protocol.

## Authority after removal

Delete claim-derived readiness/proof epochs, not real permissions. Coordinator actions still
require the **current config entry** to name this runtime's pair, and local responsibility must
be loaded where the operation needs it. Re-read that entry at the existing final-effect sites;
do not treat a cached `coordinator` flag as permission. Ordinary config writes check their
caller under the lock and recheck the current config before publication/retry, so old authority
cannot overwrite adoption. Keep lifecycle/root/session validity and existing worker/job guards.

This is a cheap config permission check, not a new authority epoch, ledger proof, boot ceremony
or history fence. Once the pair changes, the former coordinator cannot initiate further
coordinator effects even if it remains running. An already-submitted composite OS action cannot
be recalled; no cancellation, transactional network fence or hostile-same-user protection is
claimed. Saved-but-not-notified report outcomes remain truthful; do not replay them on adoption.

## Git and old claims have no influence

Adoption, initialization, status, boot, responsibility loading and ordinary coordinator effects
must neither invoke Git nor inspect its markers/environment as authority inputs. Dirty, staged,
untracked, ignored, conflicted, locked-index, unborn/detached HEAD, ancestor/linked repositories,
failed Git and **no Git executable/repository** all have the same behavior for the same current
config/runtime and answer. No stage/reset/commit, hooks, ignore edits or Git repair instructions.
Changing Git state alone while the question is open cannot stale a yes. Actual config corruption
or changed config bytes still matter, regardless of Git status.

An existing `coordinator-claim.md` is obsolete, **even if prepared, malformed, missing,
uncommitted, symlinked or contradicted by Git history**. Adoption does not read/validate it,
recover from it or write it. The current config decides, including after an interrupted legacy
adoption. There is no import, format bump, migration marker or history-based exception. Leave
old files untouched by default. A human may delete the obsolete file once in a separately
requested cleanup; adoption neither needs that deletion nor adds another cleanup prompt, follows
its symlink, stages its removal or rewrites history.

Remove the claim schema/attestation fields and all their readers/writers, Git-root/cleanliness/
index/HEAD gates, prepared/active recovery flows and config/runtime proof fencing. The earlier
ADR0025 ledger, linked history, durability barriers, capacity budgets, record census and proof
benchmarks are withdrawn, not deferred implementation tasks. Only the ancestor **board count**
remains; it must not be mistaken for that discarded ledger census.

## Documentation boundary and acceptance

This PR changes only these two design documents. Future implementation updates pi-intercom's
README/reference and marks superseded portions of ADR0009/0012 appropriately; released behavior
is not changed by this design. Worker lease clean-tree/handover rules are unrelated and unchanged.

Track a **separate swactory docs-alignment issue**, not extra scope in PR28: Orchestrator
instructions/adoption skill; ADR0005, ADR0009-C and ADR0012 references to claims, Git and evidence;
`docs/artifact-atlas.md`'s coordinator-claim/tenure/path-scoped-commit description; and the
projects-home `coordinator-claim.md` and instructions that require it. Explain obsolescence and
optional human cleanup, preserving historical ADR provenance. Do not edit installed/live copies
or the projects-home claim in this PR.

Source reading only for this rewrite: no runtime tests, endpoint probes, adoption, installation
or live changes. Independent review of the exact pushed docs SHA precedes implementation.
AC3 remains unproved until the removal is implemented, independently tested and accepted; the
already accepted native yes/no smoke does not need to be repeated for this docs review.
