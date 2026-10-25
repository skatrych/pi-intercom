# #25 — Proposed Solution

## Executive Summary

Make adoption a config-entry replacement, not an evidence ceremony. The board config's
coordinator `sessionId` and `port` are the authority. An eligible fresh Orchestrator session
sees the board, old/new pairs and replacement effect, answers **one native No-first yes/no**,
and atomically changes only those two parsed values. JSON formatting may normalize; all other
parsed values survive. All writers share a crash-released native OS lock, not compare/rename CAS.
An already matching session loads responsibility without a question or write. A configured
same-session startup may recover its verified fallback port before any other coordinator effect.
**When no config exists at the safe projects-home root, runtime startup simply creates the first
board and loads responsibility: no adoption command or question.**

Remove all Git and claim/evidence dependencies; do not replace them with a ledger, registration,
migration or authority epochs. Keep cheap identity/collision checks, old-endpoint precheck and
locked re-probe, board isolation and current-config permission checks. This preserves the
human's [minimal-design ruling](https://github.com/skatrych/pi-intercom/issues/25#issuecomment-6325707173)
and the accepted single-confirmation UX. Captain's [P1/P2/P3 ruling](https://github.com/skatrych/pi-intercom/issues/25#issuecomment-6402229840)
selects the revised serialization, preservation and boot-recovery contracts below. [ADR 0025](../adr/0025-git-independent-adoption.md)
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
4. Under the crash-released all-writer lock, revalidate raw config, identity/endpoint, paths, board count
   and collisions; repeat own/old endpoint checks and recheck after awaits. Any drift stops:
   no merge, stale-answer reuse, re-preview or second question in the invocation.
5. Parse the complete JSON, change coordinator id/port, validate and serialize it. Preserve
   name/description, workers, jobs, array order and every tolerated unknown parsed value.
   Duplicate keys and unsafe roundtrips refuse; no byte-span patcher remains. Publish atomically
   and load responsibility in place without worker actions or a model turn.

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

### Boot-only same-session port recovery

At canonical Orchestrator startup only, if the configured coordinator id equals this native session but its saved port
is different, verify the actually bound endpoint, then acquire the shared writer lock. Re-read
and freeze config; require the same coordinator id/old port, no other entry using the new port,
and valid root/lifecycle/board paths. Probe the saved old pair: a matching live endpoint refuses.
After every await and before publication/retry, recheck config, identity, paths and collisions.
Publish only the port change through the same semantic writer. No question or saved consent.
Keep all other coordinator effects closed until publication is verified, the current pair matches
exactly and responsibility is loaded. In particular, do not run handoff recovery, observer
maintenance, reminders, registration/config callbacks or tool/send effects before this boundary.
The minimal bound health endpoint remains available; ordinary worker behavior is unchanged.

This is not permission to un-fence today's whole startup branch: it does recovery/maintenance
before updating the port. Command-time same-id/different-port still refuses and requests restart;
a failed/stale boot does not retry a mutation automatically. Disconnected/unknown old endpoints
still cannot establish termination. As approved in P3, automatic boot recovery accepts the risk
of an unreachable duplicate running the same session id; it does not solve duplicate launch.

### Crash-released serialization

Use exact-pinned `fs-native-extensions@1.5.2` through a thin ConfigStore adapter: native exclusive
nonwaiting `tryLock` on a stable regular `.pi-intercom/config.lock` file, retained process queue/
nesting, and unlock/close in `finally`. Every config writer and initializer uses it through final
publication/retries; never lock the replaceable config inode itself. The guard file is never
unlinked, replaced or treated as held merely because it exists. A crashed holder releases the
kernel lock without manual stale-lock cleanup (Linux last-reference and Windows delayed-cleanup
caveats apply). Unavailable/contended native acquisition refuses and permits a fresh later attempt,
not lock stealing. Provider/load/unsupported-filesystem errors refuse writes without a weaker fallback.

The plan pins provider/API/source evidence, Linux/macOS/Windows constraints and required isolated
platform tests. No native binary was installed or executed for this design. Existing directory-
based legacy locks need offline all-process upgrade maintenance; never delete/convert one during
adoption or infer death from a PID/age. That is a one-time upgrade constraint, not the new normal
crash-recovery path. Compare-then-rename is not CAS: two writers can check the same bytes and then
overwrite each other. Atomic publication still needs serialization.

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
branch after normal lock acquisition (or separate legacy-lock upgrade maintenance). Optional human
claim cleanup is separately requested, not a migration or adoption prerequisite. The withdrawn ledger's durability/capacity/census/proof
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
all review-comment dispositions and the concrete P1/P2/P3 selections. Those selections authorize
this planning revision, not implementation. Provider packaging/platform support remains a required
implementation gate; failure returns to Architect/human rather than a Developer lock redesign.
