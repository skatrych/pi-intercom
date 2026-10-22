# ADR 0013 — Root-scoped monitor ownership survives coordinator succession

## Decision Statement

Keep monitor ownership and its mutation lock at the canonical board root, independent
of the coordinator session ID. Transfer ownership of an existing monitor only when
committed adoption evidence proves succession and saved pane identities match the
current caller/monitor association. Do not retire or restart panes during handover.

## Short Summary

A board can outlive its coordinator. A monitor displays that board, while the
coordinator session is its current authorized owner, not its persistence key.
Launch uncertainty belongs to the board and must outlive changes of owner.

Status: Proposed. Related: [coordinator adoption](../../references/coordinator-adoption.md).

## Details

- One root-scoped record names the owner session, caller, monitor, workspace, tab
  and launch stage. A root-scoped exclusive lock serializes cooperating monitor
  writers across sessions. Legacy ownership evidence is preserved during migration;
  unresolved legacy locks and partial operations still fence all new mutations.
- Handover requires a current authorized coordinator and a verified completed
  adoption path from the recorded owner to that coordinator, for the same root.
  Committed claims prove succession; root-local ownership and current Herdr inventory
  prove pane association. Neither proof replaces the other.
- Missing evidence, conflicting identities, moved panes and uncertain mutations
  refuse without pane changes. Ownership publication is atomic. An interrupted or
  uncertain publication remains fenced, not permission to launch a replacement.
- Recognition preserves an existing pane without command injection. Neither pane
  existence nor command submission establishes monitor-process readiness.

### Alternatives and rationale

Session-keyed records alone lose both ownership and uncertainty at succession.
Claiming a generic label invents authority. Warning suppression leaves the ownership
problem unresolved. Controlled retirement would add a destructive operation and
uncertain-closure recovery without improving this display-only handover. A verified
root-scoped handover retains the existing identity-based reuse model without them.

### Consequences

Persistence migration and adoption-proof integration are required. Some legacy or
ambiguous states still need inspection; there is no automatic orphan cleanup.
Adoption itself remains pane-effect-free and does not change its consent protocol.
The lock is a cooperating local-filesystem contract, not protection from old writers
that do not implement it or malicious same-user changes. Deployment must not leave
an older monitor writer running concurrently. Handover does not prove a process is
alive or that a person has not repurposed an otherwise identically labelled pane.
