# ADR 0025: Coordinator authority is the board config entry

Status: **proposed; not implemented**. Captain's P1/P2/P3 ruling selects this revised design;
independent review and human design approval/merge still precede implementation.

## Decision Statement

Use the board config coordinator entry's `sessionId` and `port` as the whole coordinator
authority. Adoption atomically replaces those two values after one native No-first yes/no.
Serialize **all** config writers with a crash-released OS file lock through the exact-pinned
`fs-native-extensions` provider, while retaining the process queue and atomic publication.
Parse/change/validate/serialize the complete config; preserve every other parsed value, not
formatting. Reject duplicate keys without retaining the byte-span patching subsystem.

A matching pair loads responsibility without another question or write. At the safe projects-home
root, first-board runtime startup uses atomic no-replace creation without adoption or confirmation.
No child/private initialization, unsafe-root access or repair of invalid existing config is allowed.
A boot-only exception permits a configured coordinator's native session to publish its verified
bound fallback port under the same lock before responsibility loading or any other coordinator
effect. No general session-id-only permission or command-time port repair is introduced.

## Short Summary

Remove claim/evidence authority rather than replace Git with another store. Git state and legacy
`coordinator-claim.md` have no influence on initialization, adoption, status, boot, responsibility
loading or subsequent permissions. No registration, ledger, migration of config data, version bump,
authority epoch or stored consent is introduced. Legacy claims remain untouched by default.

Except for that narrow boot publication, coordinator effects require the current exact config pair,
with loaded responsibility where needed. Recheck at final-effect boundaries and config publication/
retry; a cached coordinator flag is not permission. Retain lifecycle, root, board-isolation, path,
caller/target/job and ordinary worker safeguards.

## Details

### Context and rationale

[Issue #25](https://github.com/skatrych/pi-intercom/issues/25) requires one native confirmation
and zero Git-tree influence. The [minimal-design ruling](https://github.com/skatrych/pi-intercom/issues/25#issuecomment-6325707173)
rejects special registration and traceability. The [P1/P2/P3 ruling](https://github.com/skatrych/pi-intercom/issues/25#issuecomment-6402229840)
selects crash-released serialization, JSON reserialization and narrow boot port recovery.

Committed Git claims reject unrelated repository state; the withdrawn ledger adds unnecessary
proof/storage machinery. Config authority reuses one existing data store. Compare-then-rename
is **not CAS** and loses updates between cooperating processes, so it cannot replace serialization.
The selected provider supplies Linux open-file-description locks, macOS whole-file locks and
Windows `LockFileEx`, with a stable regular `config.lock` file never unlinked by normal writers.
Kernel release, not file absence, determines availability. Unsupported bindings/filesystems refuse
writes; no mkdir, PID/age stealing or optimistic fallback is allowed. All board processes must be
upgraded together; a legacy lock directory requires separate offline upgrade maintenance.

### Consequences

The bound endpoint must verify its native identity. Configured session/port collisions and a
matching live old coordinator refuse; drift invalidates a displayed answer. Boot recovery also
rechecks the old endpoint, config, collisions, lifecycle and paths under the lock before publication.
Disconnected/unknown is not proof of termination. Adoption's yes authorizes replacement only;
automatic boot recovery explicitly accepts duplicate-same-session/unknown-old-endpoint risk.
No other effects are enabled until the published exact pair and responsibility load are verified.

Formatting may normalize, but workers, jobs, array order and tolerated unknown parsed values
must survive; ambiguous duplicates or values that cannot roundtrip safely refuse. Raw preview
bytes still detect stale confirmation. Board-isolation diagnostics name offending paths and allow
only human removal of confirmed empty unintended strays, never automatic data cleanup.

The permanent guard file is not an abandoned ownership record. Locks release on orderly close
or process death (last reference on Linux; Windows cleanup can be delayed). Noninheritance and
real-platform/package tests are required. This is cooperating-local-process serialization on
supported local filesystems, not distributed fencing, hostile-same-user protection, recall of
submitted OS work, coherent-rollback detection or a new power-loss guarantee. Publication
uncertainty and successful publication with failed local load remain distinct from success.

Issue-specific provider evidence, branches, integration, failure/test inventory and delivery gates
belong in the [Proposed Solution](../issues/25-proposed-solution.md) and
[Implementation Plan](../issues/25-implementation-plan.md).
