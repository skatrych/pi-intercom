# #25 — Proposed Solution

## Executive Summary

Make adoption a config-entry replacement, not an evidence ceremony. The board config's
coordinator `sessionId` and `port` are the authority. An eligible fresh Orchestrator session
sees the board, old/new pairs and replacement effect, answers **one native No-first yes/no**,
and atomically replaces only those two tokens. An already matching session loads responsibility
without a question or write. **When no config exists at the safe projects-home root, runtime
startup simply creates the first board and loads responsibility: no adoption command or question.**

Remove all Git and claim/evidence dependencies; do not replace them with a ledger, registration,
migration or authority epochs. Keep cheap identity/collision checks, old-endpoint precheck and
locked re-probe, board isolation and current-config permission checks. This preserves the
human's [minimal-design ruling](https://github.com/skatrych/pi-intercom/issues/25#issuecomment-6325707173)
and the accepted single-confirmation UX. [ADR 0025](../adr/0025-git-independent-adoption.md)
records the lasting authority decision; the separate [Implementation Plan](25-implementation-plan.md)
contains operational branches, source changes and validation.

## Details

### Adoption flow

For replacing an existing board's coordinator, keep role-local `/intercom-adopt` →
`Intercom.adoptCoordinator` as the sole human entry path.
Use captured native session identity and the runtime's actually bound port, not caller arguments,
registration or persisted-session proof. Retain role/trust/interactive-context, idle/concurrency,
lifecycle, canonical projects-home/root/config-path and strict config checks.

1. Refuse configured session/port collisions, including same id with a different port. Probe the
   bound new endpoint: it must answer for this native session. Name the conflicting config entry
   and pair; binding a port is not permission to remove/rebind that entry. An unverifiable own
   endpoint refuses with a restart-Pi/retry instruction, not a config-edit or bypass instruction.
2. Probe the configured old coordinator before asking. A matching live endpoint refuses.
   Disconnected/unknown is not termination evidence; the question authorizes replacement only.
3. Ask once, showing root and old/new pairs. No typed wording, ended attestation, evidence,
   cleanup question or saved answer. No/Esc/dismiss changes nothing.
4. Under the existing all-writer lock, revalidate raw config, identity/endpoint, paths, board count
   and collisions; repeat own/old endpoint checks and recheck after awaits. Any drift stops:
   no merge, stale-answer reuse, re-preview or second question in the invocation.
5. Publish the existing lossless two-token patch; preserve name/description, all other bytes,
   workers and jobs. Load responsibility in place without worker actions or a model turn.

### First-board creation and root safety

[Captain's first-board direction](https://github.com/skatrych/pi-intercom/pull/28#discussion_r4366709481)
restores upstream's automatic initialization, not an adoption branch: at startup, if config is
absent at the canonical projects-home cwd, bind the endpoint, use existing atomic no-replace
`initialize`, then load responsibility. Zero questions, claims or adoption registration. A
concurrent initializer must not be overwritten; re-read its config and grant no authority unless
it names this exact runtime pair. `/intercom-adopt` does not recreate a board removed while this
runtime was running; restart Pi for ordinary first-board startup. Status stays read-only.

This preserves upstream's create-board behavior within the fork's safe root boundary, not
upstream's ability to initialize at any cwd. Child/no-board, extra/wrong boards, unsafe/aliased
roots and malformed/unreadable existing config still refuse. `countBoards`, including empty or
malformed extra boards, remains isolation, not traceability. Name every offending `.pi-intercom`
path and the expected root. A human may remove a confirmed empty, unintended stray directory
and retry; never automatically delete it or recommend removing populated/malformed board data.
The [plan](25-implementation-plan.md#first-board-source-basis) records upstream source evidence.

### Permissions and failure boundaries

Removing proof machinery does not remove permissions. Check the current config pair at existing
final-effect sites, after awaits, and at config-write admission/publication/retry under the lock.
The old coordinator cannot overwrite adoption or initiate later coordinator effects; it must not
fall through as worker traffic. Keep lifecycle/root validity, responsibility requirements and
worker/target/job guards; ordinary worker behavior is unchanged.

The selected exact-pair rule also refuses a configured coordinator after `EADDRINUSE` changes
its bound port. Today's session-id-only boot `port_update` will not repair that mismatch once
claim gates are removed: this is a known recovery limitation, not authorization to un-fence it.
Recover by safely freeing the saved port and restarting, or use an eligible fresh session's
normal adoption; no in-tool same-session rebind is provided. The plan proposes a narrow
boot-only exception for human choice, not implementation.

A foreign or abandoned lock stops for separate owner investigation, never age/pid-based stealing.
Its diagnostic must name the lock path and available owner details; after establishing no holder
or in-flight publication remains, human maintenance may clear the abandoned lock and retry.
Petro's compare-then-rename suggestion is not atomic CAS and cannot replace serialization: two
writers can both compare the same old bytes before overwriting each other. Crash-released
serialization and parse/serialize preservation are explicit proposals in the plan, not adopted.

Pre-publish failure is not adoption success. An uncertain publication is reported as uncertain, without
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
accepted native yes/no smoke is not reopened by this review-comment correction.

Future implementation updates pi-intercom README/reference and supersession notes for
ADR0009/0012. Track separate swactory alignment of Orchestrator instructions, adoption skill,
ADR0005/0009-C/0012, artifact atlas and projects-home claim requirements; preserve historical
provenance. Do not bundle source-policy, installed/live-copy or projects-home claim edits here.
The reviewed swactory alignment, human installation of that matching runbook, and fork release/
upgrade are blocking dependencies for #25 closure and AC1/AC4 acceptance, not optional follow-up.
The installer-dirties-Git symptom becomes irrelevant to adoption once Git has zero influence;
this does not waive worker lease cleanliness. Upgrade every process sharing the board before
using the new adoption model (documented operator prerequisite, not a new version handshake).
Docs approval is not implementation, installation or issue-wide acceptance. The plan records
all current review-comment dispositions and the precise optional human choices; none is implied
accepted by taking comments into work.
