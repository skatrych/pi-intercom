# #25 — Proposed Solution

## Executive Summary

Make adoption a config-entry replacement, not an evidence ceremony. The board config's
coordinator `sessionId` and `port` are the authority. An eligible fresh Orchestrator session
sees the board, old/new pairs and replacement effect, answers **one native No-first yes/no**,
and atomically replaces only those two tokens. An already matching session loads responsibility
without a question or write.

Remove all Git and claim/evidence dependencies; do not replace them with a ledger, registration,
migration or authority epochs. Keep cheap identity/collision checks, old-endpoint precheck and
locked re-probe, board isolation and current-config permission checks. This preserves the
human's [minimal-design ruling](https://github.com/skatrych/pi-intercom/issues/25#issuecomment-6325707173)
and the accepted single-confirmation UX. [ADR 0025](../adr/0025-git-independent-adoption.md)
records the lasting authority decision; the separate [Implementation Plan](25-implementation-plan.md)
contains operational branches, source changes and validation.

## Details

### Adoption flow

Keep role-local `/intercom-adopt` → `Intercom.adoptCoordinator` as the sole human entry path.
Use captured native session identity and the runtime's actually bound port, not caller arguments,
registration or persisted-session proof. Retain role/trust/interactive-context, idle/concurrency,
lifecycle, canonical projects-home/root/config-path and strict config checks.

1. Refuse configured session/port collisions, including same id with a different port. Probe the
   bound new endpoint: it must answer for this native session. Unverifiable own identity refuses.
2. Probe the configured old coordinator before asking. A matching live endpoint refuses.
   Disconnected/unknown is not termination evidence; the question authorizes replacement only.
3. Ask once, showing root and old/new pairs. No typed wording, ended attestation, evidence,
   cleanup question or saved answer. No/Esc/dismiss changes nothing.
4. Under the existing all-writer lock, revalidate raw config, identity/endpoint, paths, board count
   and collisions; repeat own/old endpoint checks and recheck after awaits. Any drift stops:
   no merge, stale-answer reuse, re-preview or second question in the invocation.
5. Publish the existing lossless two-token patch; preserve name/description, all other bytes,
   workers and jobs. Load responsibility in place without worker actions or a model turn.

First-board initialization is permitted only at projects home and uses the same single-question
contract plus existing atomic no-replace publication. Child/no-board, extra/wrong boards and
unsafe/aliased roots refuse. `countBoards`, including empty/malformed extra boards, remains
board isolation, not traceability. Status only reads config/identity and local load state.

### Permissions and failure boundaries

Removing proof machinery does not remove permissions. Check the current config pair at existing
final-effect sites, after awaits, and at config-write admission/publication/retry under the lock.
The old coordinator cannot overwrite adoption or initiate later coordinator effects; it must not
fall through as worker traffic. Keep lifecycle/root validity, responsibility requirements and
worker/target/job guards; ordinary worker behavior is unchanged.

A foreign lock stops for separate owner investigation, never age/pid-based stealing. Pre-publish
failure is not adoption success. An uncertain publication is reported as uncertain, without
rollback/replay. Successful publication with failed local loading is **config replaced, local
promotion pending**; a later matching-pair invocation loads only. Saved-but-not-notified outcomes
remain truthful, with no replay. Existing atomic config semantics do not gain a new durability,
cancellation or distributed-fencing guarantee.

### Git independence and obsolete files

Adoption, initialization, status, boot, responsibility loading and coordinator effects make zero
Git calls and inspect no Git markers/environment as authority. For identical config/runtime and
answer, dirty/staged/conflicted/locked-index states, unrelated HEAD changes, ancestor/linked
repositories and absent/failing Git behave identically. Git changes alone cannot stale a yes;
actual config corruption or changed bytes still matter. No Git repair, ignore edits or commits.

Ignore legacy `coordinator-claim.md` in every state, including prepared, malformed, missing or
symlinked. Do not read, classify, follow, recover, rewrite or delete it. Config alone selects the
branch after separate lock-owner resolution. Optional human cleanup is separately requested,
not a migration or adoption prerequisite. The withdrawn ledger's durability/capacity/census/proof
tasks are not carried forward. Worker lease clean-tree and handover rules are unrelated.

### Delivery and acceptance limits

Source baseline: `main@c6e414f22e09c7a9b50f1331eddd31b0f0e35d66`. Preserve this same-issue
lease base; recheck source locators against the later implementation base before coding.
PR28 is docs-only. Independent review of this exact revised snapshot and human design
approval/merge precede implementation; previous approval is not approval of this revision.
No runtime tests, endpoint probes, adoption, installation or live changes are authorized here.
AC3 remains unproved until implementation, independent testing and acceptance. The already
accepted native yes/no smoke is not reopened by a presentation review.

Future implementation updates pi-intercom README/reference and supersession notes for
ADR0009/0012. Track separate swactory alignment of Orchestrator instructions, adoption skill,
ADR0005/0009-C/0012, artifact atlas and projects-home claim requirements; preserve historical
provenance. Do not bundle source-policy, installed/live-copy or projects-home claim edits here.
Existing human runbook-installation and release gates remain separate and unresolved; docs
approval is not implementation, installation or issue-wide acceptance.
