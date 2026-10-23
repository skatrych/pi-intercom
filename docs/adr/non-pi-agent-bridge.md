# ADR: Non-pi agents join a board through a wire-level bridge

Status: **proposed**. The number will be assigned when an issue exists.

## Decision

Non-pi coding agents participate as ordinary workers through a separate bridge process that
implements the V1 wire protocol. The bridge lives in `packages/intercom-bridge` and has per-CLI adapters. The Pi extension
does not learn about other agent runtimes, and the wire contract does not change for them.

## Context

The extension's transport and config modules have no Pi host dependency. Workers are identified only
by session ID, port and config entry, so any process that honors the receiver rules is a valid worker.

## Alternatives

- **Extend the Pi extension (PR into the runtime):** couples Cursor/agy process management to Pi
  lifecycle code (adoption, handoff, reminders) and to Pi's release cycle.
- **One lib per CLI:** duplicates wire, lifecycle and tests. The CLIs differ only in argv and output parsing.
- **Generic bridge with adapters (selected):** one lifecycle, a small adapter seam, and the package can be split out later.

## Consequences

The bridge keeps a copy of the wire contract, guarded by a conformance test against the extension
validator. A future wire change must update both. Bridge workers are relaunched by the bridge CLI,
not by `intercom_resume_worker`.
