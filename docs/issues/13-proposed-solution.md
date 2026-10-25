# Issue 13 — Proposed Solution

## Executive Summary

Recognize the existing display-only monitor after coordinator replacement; do not
retire, restart or inject another command into it. Store ownership and launch
uncertainty once per canonical board root, not per coordinator session. The current
config coordinator pair (`sessionId`, actually bound `port`), loaded local responsibility
and exact saved pane association authorize owner transfer. No adoption history is needed.

This follows [PR28's selected design at `8e46bdbc`](https://github.com/skatrych/pi-intercom/tree/8e46bdbcdb1ddfdc7511f63c2fa61bb2542312a5/docs).
Planning can proceed now; implementation follows PR28 integration and the normal review/
human approval gates. **B2 broad-AC1 coverage remains blocking pending Captain's placement/
association decision.** This round corrects F2's immutable legacy-marker identity and proposes
complete placement coverage; it neither narrows AC1 nor authorizes caller rebinding.

## Details

### Resolution and safety

[ADR 0013](../adr/0013-root-scoped-monitor-ownership.md) records the lasting persistence
decision; the [Implementation Plan](13-implementation-plan.md) supplies the state table,
migration, bounded lookup and tests. On the next ordinary monitor check after local
responsibility loading, require the current config pair for the pinned root and verify
saved caller, monitor, workspace and tab. Revalidate permission across awaits and before
publication/each pane effect. Adoption/promotion themselves remain pane-effect-free.

A root-scoped record and exclusive monitor lock retain pending launches across reloads
and successor sessions. Completed v1 records can migrate after the same association
checks; legacy locks, partial states, conflicting candidates and uncertain outcomes
still refuse. Labels discover candidates, never confer ownership. Reuse transfers only
the owner; it preserves the pane, association and completed launch stage. There are no
claims, Git reads, authority epochs, succession ledger or termination attestations.

### Pane/tab coverage — not an implicit AC change

Source at `main@23bc10fa959f179811cc43415921a2a144d40e10`:
`src/monitor-launcher.ts:ensureMonitorPane` uses session-keyed records, a workspace
list and same-tab checks. `src/index.ts:ensureCoordinatorMonitor` supplies readiness
and registered-worker prerequisites. In this table, workspace means a **Herdr UI container**,
not a canonical filesystem project/board root or Git worktree. All rows assume the same
verified canonical board root; a different root is always outside this proposal.
The baseline behaviors and authorized alignment are:

| Successor location | Baseline with predecessor's generic-label monitor | Authorized alignment (not full AC1) |
|---|---|---|
| Same caller pane/tab/workspace | Cannot load predecessor record; generic label refuses | Verified root-local completed record transfers owner; one unchanged monitor |
| Different pane, same tab | Generic label refuses; same-session saved caller mismatch also refuses | Root record detects caller mismatch; explicit inspection refusal, no duplicate |
| Different tab, same workspace | Predecessor generic label is outside current-tab collision check; a new session can reach split | Root record is consulted regardless of current tab; mismatch refuses, no duplicate |
| Different workspace | Filtered list can miss predecessor; a new session can reach split | Root record plus exact lookup detects association mismatch; refuses, no duplicate |

With a predecessor session-bearing label rather than a generic label, a *new* session's
marker filter also misses that foreign marker; the plan discovers all marker variants.
A reused same-session record can also reach replacement when its pane is outside the
workspace-filtered list. Exact lookup distinguishes moved from absent in either case.

The reported fixture keeps its caller association; broad AC1 does not. Refusals in the
other rows leave a real coverage gap, as [independent B2](https://github.com/skatrych/pi-intercom/pull/31#issuecomment-6402577463)
confirms. The **unaccepted recommendation** in plan §4 covers all four rows by retaining
one monitor in its **original tab and Herdr workspace**, updating only owner/managing-caller
metadata after exact checks. A remote successor does not get another local display or an
automatic focus/tab switch. The monitor already reads the explicit board `--root`, so
changing the coordinator's UI location does not require changing the monitor command.

Keep original monitor/location provenance separate from the mutable managing caller;
retain v1 as the source of its immutable legacy-marker session, including after B/C owner
transfers. Plan §4 defines the proposed schema, original/prior/current caller identity
checks, v1 missing-tab limits, adapter evidence and tests. Proposed AC2 would verify both
associations, not require monitor and manager to share a tab/workspace: unexpected movement
of recorded panes still refuses; only an expressly authorized new manager changes.

This does **not** amend AC2 or select display placement. Captain's decision is pending:
original-location remote reuse is the smallest recommendation; a requirement to place a
display beside every successor would need another safely controlled placement contract.
Until selection, B2 blocks a complete implementation baseline. No AC1 scope amendment,
metadata reassociation, pane movement/close/restart or cleanup is authorized.

### Diagnostics and limits

Name known unowned candidate IDs and say “no pane mutation attempted” on pre-split
refusal. Reserve “split submitted; pane identity unknown” for a genuinely uncertain
submitted split. Success means “pane recognized; process readiness not checked,” not
“monitor running.” Preserve empty-roster/non-Herdr behavior and worker/target/root
safeguards. No worker rebinding, process-readiness detector, monitor UI redesign,
installation, live repair or orphan cleanup is included.
