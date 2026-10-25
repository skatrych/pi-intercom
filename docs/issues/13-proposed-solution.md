# Issue 13 — Proposed Solution

## Executive Summary

Recognize the existing display-only monitor after coordinator replacement; do not
retire, restart or inject another command into it. Store ownership and launch
uncertainty once per canonical board root, not per coordinator session. The current
config coordinator pair (`sessionId`, actually bound `port`), loaded local responsibility
and exact saved pane association authorize owner transfer. No adoption history is needed.

This follows [PR28's selected design at `8e46bdbc`](https://github.com/skatrych/pi-intercom/tree/8e46bdbcdb1ddfdc7511f63c2fa61bb2542312a5/docs).
Planning can proceed now; implementation follows PR28 integration and the normal review/
human approval gates. **Cross-pane/tab AC1 coverage still needs the explicit scope decision
below.** This proposal neither narrows the issue nor authorizes caller rebinding.

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
and registered-worker prerequisites. The baseline behaviors and proposed changes are:

| Successor location | Baseline with predecessor's generic-label monitor | Proposed behavior |
|---|---|---|
| Same caller pane/tab/workspace | Cannot load predecessor record; generic label refuses | Verified root-local completed record transfers owner; one unchanged monitor |
| Different pane, same tab | Generic label refuses; same-session saved caller mismatch also refuses | Root record detects caller mismatch; explicit inspection refusal, no duplicate |
| Different tab, same workspace | Predecessor generic label is outside current-tab collision check; a new session can reach split | Root record is consulted regardless of current tab; mismatch refuses, no duplicate |
| Different workspace | Filtered list can miss predecessor; a new session can reach split | Root record plus exact lookup detects association mismatch; refuses, no duplicate |

With a predecessor session-bearing label rather than a generic label, a *new* session's
marker filter also misses that foreign marker; the plan discovers all marker variants.
A reused same-session record can also reach replacement when its pane is outside the
workspace-filtered list. Exact lookup distinguishes moved from absent in either case.

The reported incident kept the same caller association, so the first row resolves it.
The issue's AC1 is broader: retaining safe refusals in other rows is **not evidence that
all AC1 passes**. Two precise options require Coordinator/human routing before an
implementation-ready baseline:

1. Explicitly amend AC1 to same-caller-pane succession with unchanged monitor/workspace/
   tab association, retain cross-pane/tab refusals, and track relocation separately.
2. Keep broad AC1 and authorize a separate guarded caller-relocation design, including
   how to verify old/new caller identities and whether a different-tab successor reuses
   a remote display or relocates it. That changes the association contract; inventory
   alone cannot prove an old caller's runtime ended or grant pane cleanup authority.

Existing AC1 does not limit succession to one pane: the present proposal has a real
coverage gap. Recommend option 2's smallest extension: update ownership/caller metadata,
reuse the same display in the same or original remote tab, and verify old/current caller
and monitor identities as specified in plan §4. Neither option is selected here; the issue
body is unchanged. No monitor movement or retire-and-recreate fallback is authorized.

### Diagnostics and limits

Name known unowned candidate IDs and say “no pane mutation attempted” on pre-split
refusal. Reserve “split submitted; pane identity unknown” for a genuinely uncertain
submitted split. Success means “pane recognized; process readiness not checked,” not
“monitor running.” Preserve empty-roster/non-Herdr behavior and worker/target/root
safeguards. No worker rebinding, process-readiness detector, monitor UI redesign,
installation, live repair or orphan cleanup is included.
