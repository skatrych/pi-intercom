# ADR 0025: Coordinator authority is the board config entry

Status: **proposed; not implemented**. Independent review and human design approval/merge
remain required before implementation.

## Decision Statement

Use the board config coordinator entry's `sessionId` and `port` as the whole coordinator
authority. Adoption is one atomic, lossless replacement of those two tokens under the existing
all-writer lock, authorized by one native No-first yes/no. A matching pair needs only local
responsibility loading, without another question or write. If no config exists at the safe
projects-home root, runtime startup creates the first board without adoption or confirmation,
using atomic no-replace initialization. This does not permit child/private-board creation,
unsafe roots, or replacement/repair of malformed or unreadable existing config.

## Short Summary

Remove claim/evidence authority rather than replace Git with another store. Git state and legacy
`coordinator-claim.md` have no influence on adoption, initialization, status, boot, responsibility
loading or subsequent coordinator permissions. No registration, ledger, migration, config version
bump, authority epoch or stored consent is introduced. Legacy claims remain untouched by default.

Coordinator effects require the current config pair to match this runtime, with loaded
responsibility where needed. Recheck at final-effect boundaries and under the shared lock for
config publication/retry; a cached coordinator flag is not permission. Retain lifecycle, root,
board-isolation, path, caller/target/job and ordinary worker safeguards.

## Details

### Context

[Issue #25](https://github.com/skatrych/pi-intercom/issues/25) requires one native confirmation
and zero Git-tree influence. The human's [minimal-design ruling](https://github.com/skatrych/pi-intercom/issues/25#issuecomment-6325707173)
rejects special adoption registration and traceability machinery for this prototype-stage tool.

### Alternatives and rationale

- **Keep committed Git claims:** rejects otherwise valid adoption because of unrelated repository
  state and retains history, commit and recovery dependencies.
- **Replace Git with an evidence ledger:** adds persistence, migration and proof machinery beyond
  the stated need; the earlier proposal in PR28 is withdrawn.
- **Config-entry authority (selected):** uses the existing config, lock and atomic publication
  boundary. Cheap identity/collision checks and old-endpoint precheck/locked re-probe retain
  useful local safety without a second authority system. Serialization is independent of claims:
  compare-then-rename is not atomic CAS. Byte preservation remains the selected compatibility
  guarantee, not merely a way to maintain now-obsolete evidence hashes. Relaxing it is separate.

### Consequences

The native session's bound endpoint must verify its identity; configured session/port collisions
and a matching live old coordinator refuse. Config/path/identity drift invalidates the answer.
Disconnected/unknown old endpoints do not prove termination: yes authorizes replacement only.
Board-isolation refusals name offending paths and distinguish human removal of a confirmed empty
stray from preservation/investigation of populated data; no automatic cleanup is permitted.
Exact-pair permission deliberately excludes automatic same-session port-fallback rebinding.
Abandoned locks can block writes until separate human maintenance establishes safe removal.
Both availability limitations remain explicit; changing them needs a separately reviewed decision.

This is a cooperating-local-process contract, not hostile-same-user protection, distributed
fencing, recall of submitted OS work, coherent-rollback detection or a new power-loss guarantee.
There is no claim/history recovery or stored-consent replay. Publication uncertainty and local
load failure must be reported separately from success; current config selects the next action.

Issue-specific branches, removal inventory, failures, tests and delivery gates belong in the
[Proposed Solution](../issues/25-proposed-solution.md) and
[Implementation Plan](../issues/25-implementation-plan.md), not this enduring decision.
