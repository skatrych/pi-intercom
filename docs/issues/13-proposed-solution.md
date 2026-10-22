# Issue 13 — Proposed Solution

## Executive Summary

Resolve a predecessor monitor by **verified ownership handover**, not retirement.
On the next ordinary monitor check after completed adoption, retain the existing
pane and atomically record its successor owner. Prove succession from the existing
committed adoption evidence; a display label or an unexplained old JSON file is
not sufficient. Never close a pane or send another monitor command during handover.

Use one board-root-scoped ownership record and lock so changing coordinator sessions
cannot discard launch uncertainty. Keep unresolved legacy records and locks fenced.
This changes monitor ownership persistence, not adoption, transport or display behavior.

## Details

### Evidence and scope

Requirements: [issue 13](https://github.com/skatrych/pi-intercom/issues/13), body SHA256
`a68492345de53c3b422882938757bf2e11996ff9eef4d8a55109f86fdd7be0fb`.
The full body and its approval comment were read; no requirement drift was found.
The body's historical “Refinement” sentence is superseded operationally by the
approval comment routing the issue to Ready.

At `23bc10fa959f179811cc43415921a2a144d40e10`, `ensureMonitorPane` reads only the
current session's record/lock. An isolated injected-runner reproduction confirmed
that a successor refuses the predecessor's generic label before splitting, yet
reports “Pane unknown may remain.” A successor also fails to consult a
predecessor's pending record/lock. Existing monitor-launcher tests pass (8/8).
These are source/fixture observations, not an installed-runtime or live-incident claim.

### Resolution contract

- Retain the current readiness, registered-worker and Herdr prerequisites. Adoption
  remains pane-effect-free; its success does not start a monitor. A separate normal
  startup/reload or first-worker configuration check performs reconciliation.
- Require the current coordinator's fresh authority, canonical board root and
  completed local promotion. The verified active adoption claim binds predecessor
  and successor identities. Use a verified chain of completed adoptions if the
  monitor owner predates the immediate predecessor; broken/missing history refuses.
  A first declaration or merely changing config does not prove succession.
- Match the root-local ownership record to the exact saved caller, monitor and
  workspace identities, and verify both panes' current tab/workspace association.
  Reject caller-as-monitor, moved, foreign, conflicting or multiple candidates.
  A generic label supplies discovery/diagnostics only. Legacy root association comes
  from its canonical machine-local record location, not an invented embedded root;
  legacy tab association must be established from the live caller and monitor.
- Preserve completed legacy v1 ownership as evidence when importing into the new
  record. Never migrate a pending stage or ignore any legacy launch lock. Subsequent
  checks read the same root-scoped record irrespective of session ID.
- Before replacement of a genuinely absent completed monitor, verify absence by
  exact pane lookup, not only a workspace-filtered list: a moved pane is not missing.
  All uncertain launch/publication states remain inspection cases, including after
  reload or another adoption. There is no automatic cleanup or recovery command.

The lasting ownership decision is [ADR 0013](../adr/0013-root-scoped-monitor-ownership.md).
The [Implementation Plan](13-implementation-plan.md) specifies migration, authority
proof, failure handling and acceptance coverage.

### Diagnostics and limits

Name inventory-known unowned pane IDs and the failed ownership condition, and say
that no pane mutation was attempted when refusal precedes a split. Reserve
“created pane may remain / identity unknown” for an actual submitted-but-uncertain
split, retaining its record and lock for inspection. Successful handover/reuse
means **pane recognized; process readiness not checked**, never “monitor running.”

Handover avoids the destructive evidence and platform-specific termination checks
that retirement would require. It cannot fix insufficient provenance, an old pending
launch or a monitor moved away from its caller; those correctly remain explicit
refusals. There is no process-readiness detector, worker operation, live repair,
provider/install change or general orphan cleanup in this proposal.
