# ADR 0034: Non-pi agents join a board through a wire-level bridge

Status: **proposed; implemented in PR #33, not merged**. Independent review and human design approval/merge
remain required. Issue: [#34](https://github.com/skatrych/pi-intercom/issues/34). See the [Proposed Solution](../issues/34-proposed-solution.md)
and [Implementation Plan](../issues/34-implementation-plan.md).

## Decision

Non-pi coding agents take part as ordinary workers through a separate bridge process that implements
the V1 wire protocol. The bridge lives in `packages/intercom-bridge` and has per-CLI adapters (`cursor`, `agy`).
The Pi extension does not learn about other agent runtimes, and the wire contract does not change for them.

## Context

The extension's transport and config modules have no Pi host dependency. Workers are identified only
by session ID, port and config entry, so any process that honors the receiver rules is a valid worker.
The extension itself starts only in an interactive, trusted Pi session, so it cannot be reused as a
headless worker host for other CLIs.

## Alternatives and rationale

- **Extend the Pi extension/runtime:** couples Cursor/agy process management to Pi lifecycle code
  (adoption, handoff, reminders) and to Pi's release cycle. Rejected.
- **One lib per CLI:** duplicates wire, lifecycle and tests, when the CLIs differ only in argv and output
  parsing. Rejected.
- **Generic bridge with adapters (selected):** one lifecycle and a small adapter seam. The package can
  be split out later without touching the extension.

## Consequences

The bridge keeps a copy of the wire contract, guarded by a conformance test against the extension
validator. A future wire change must update both. Bridge workers are relaunched with the bridge CLI,
not with `intercom_resume_worker`. Launching non-pi workers from coordinator tools would need a config field
and a separate decision.
