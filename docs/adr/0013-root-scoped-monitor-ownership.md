# ADR 0013 — Root-scoped monitor ownership survives coordinator succession

Status: Proposed. Authority: [PR28 / ADR0025 at `8e46bdbc`](https://github.com/skatrych/pi-intercom/blob/8e46bdbcdb1ddfdc7511f63c2fa61bb2542312a5/docs/adr/0025-git-independent-adoption.md).

## Decision Statement

Keep monitor ownership and its mutation lock at the canonical board root, independent
of coordinator session ID. A current config coordinator pair with loaded local
responsibility may take over the display-only monitor after exact saved pane association
checks. Transfer ownership metadata, not panes or processes. No succession history is read.

## Short Summary

A board outlives its coordinator. Its recognized monitor and unresolved launch uncertainty
must survive that change. Config supplies current authority; the root-local record and
Herdr identity checks establish which monitor belongs to that board.

## Details

### Context, alternatives and rationale

Session-keyed state loses ownership and uncertainty at succession. Generic labels and
warning suppression cannot establish ownership. Retirement adds destructive operations
without improving a display-only handover. One root record and exclusive monitor lock
retain association and uncertainty across sessions, with atomic ownership publication.
This durable monitor fence is distinct from the config writer's crash-released lock.

### Consequences

Migrate completed legacy ownership conservatively; unresolved locks, partial launches,
unsafe paths, moved/conflicting panes and insufficient identity data remain inspection
cases. Revalidate current config permission and association across awaits and at effects;
reuse never injects a command or proves process readiness. No claim/Git/proof integration
or new authority subsystem is required. Adoption/promotion remain pane-effect-free.

The default association contract keeps the saved caller/monitor/workspace/tab unchanged.
Caller relocation is a separate unaccepted contract change described in the issue plan,
not permission to move/close panes or silently reduce acceptance coverage. The filesystem
protocol assumes cooperating upgraded local writers, not malicious same-user protection.
Old writers must not run concurrently; no orphan cleanup, automatic fence removal or
atomic Herdr compare-and-act guarantee is introduced.
