> **Superseded by [ADR 0025](0025-git-independent-adoption.md):** adoption, initialization, boot and coordinator effects make no Git calls and read no Git markers as authority; the legacy claim file is ignored. This file is retained as historical provenance.

# ADR 0009-C: Ignore only unrelated untracked dirt for first declarations

## Decision statement

Allow unrelated untracked files only when declaring the first coordinator; keep all other Git safety checks.

## Short summary

Scratch content outside the protected board paths must not block either first-declaration case. Keep adoption and recovery strict, inspect protected paths even when ignored, and describe staged, tracked and untracked blockers accurately.

## Details

- Status: Proposed; implementation pending review
- Date: 2026-10-18
- Scope: [skatrych/pi-intercom #9](https://github.com/skatrych/pi-intercom/issues/9), refined issue body
- Inspected base: `main@1d5bb074fa3fe306f394c1a292cbed95ff438f3b`
- Related: [authorization](0009-first-declaration-authorization.md), [implementation plan](0009-adoption-ux-implementation-plan.md)

### Context

`assertGitSafe` rejects every staged path and then every dirty path except the claim; `dirtyPaths` already records whether a status entry is untracked. The refusal nevertheless calls **all** unrelated paths modified tracked files. `reconcile` has its own strict precheck with a generic unrelated-dirt message. Changing only `assertGitSafe` globally would unintentionally relax ordinary adoption, prepared renewal and finalization, since `writeCommit`/`commitClaim` share it.

The refined issue chooses less friction only for first-board creation and first-coordinator declaration, not a board-surface-only cleanliness rule for all transitions. The index must remain globally empty before each workflow-owned commit, even when an unrelated staged path would not be included by `commit --only`.

### Decision

#### Explicit private operation policy; strict by default

Introduce a private policy distinguishing `strict` from `first-declaration`. Only the verified state (a) bootstrap and claim-history-free state (b) declaration may select `first-declaration`. Derive it from the backend's validated path, never from caller options, merely from a claim's self-described kind, or from a shared mutable workflow flag.

Thread that policy explicitly through `assertGitSafe`, `writeCommit` and `commitClaim`, including before-write, immediately-before-commit and after-hook verification. Missing policy means strict. Existing adoption, prepared-before renewal and prepared-after finalization retain strict policy and their current recognized generated-claim recovery exception. Write-free active promotion retry is not a new first-declaration relaxation and keeps its existing checks.

| Git/layout condition | First declaration (a)/(b) | Existing adoption / recovery |
|---|---|---|
| Unrelated untracked backup, scratch directory, nested scratch clone | Nonblocking, preserve bytes | Existing strict refusal |
| Unrelated tracked modification, deletion, rename/type change | Refuse | Refuse |
| Any pre-existing staged path, including claim | Refuse | Refuse |
| Unresolved merge/rebase/cherry-pick/etc. | Refuse | Refuse |
| Foreign/uncommitted claim or claim history | Not eligible; preserve evidence/refuse | Existing evidence/reconciliation rules |
| Untracked protected-surface content | Refuse unless specifically recognized safe workflow/runtime content | Existing strict/evidence rules, no new relaxation |
| Ignored protected-surface path obstruction/unsafe evidence | Refuse through filesystem/board/evidence guards | Existing guards remain mandatory |

Do not require scratch directories to be ignored, moved, cleaned or committed. Do not recurse into unrelated scratch clones or regard their boards as ancestors of the actual cwd. Existing cwd-to-projects-home board discovery/count and canonical repository-root requirements remain unchanged.

#### Protected surface and recognition

Paths are relative to the canonical projects-home Git root:

- Exactly `coordinator-claim.md`, and descendants if a foreign directory obstructs that file.
- Exactly `.pi-intercom`, every descendant in the board/config namespace, and ancestors whose symlink/type/layout prevents safe access to these locations (including canonical root/cwd ancestry already checked by `pathSnapshot`/`assertPaths`).
- Use segment-aware comparisons: `.pi-intercom-backup/` and `coordinator-claim.md.bak` are unrelated; `.pi-intercom/config.json` and `coordinator-claim.md/foreign` are protected. Normalize Git's path representation, not filesystem aliases, before classification; unknown/ambiguous status/path data fails closed.

An untracked or ignored path inside that namespace is **not** thereby safe. Preserve board count, strict config validation and exact-byte snapshots, newest reachable claim evidence, path/symlink/type guards and under-lock rechecks independently of Git status. Inspect protected filesystem paths even when ignored: Git status does not report ignored obstructions or ignored foreign files.

Recognized exceptions must be explicit, not “all of `.pi-intercom/` is runtime-owned”:

1. The exact generated claim bytes being written/committed, or the existing recognized committed prepared/derived-active evidence in its supported recovery path. Before a first declaration there can be no foreign worktree claim or historical claim hidden by that exception.
2. Existing state (b)'s strictly validated, snapshot-bound `config.json`, or this invocation's newly initialized config in state (a). A pre-existing empty/invalid/foreign config cannot become a no-board bootstrap just because it is ignored.
3. The **current transaction's own** config lock/owner token and its own temporary files; a foreign/uncertain lock still stops. Never delete or whitelist an arbitrary file because it resembles a lock/temp name.
4. Expected, non-obstructing runtime board files already allowed by the board layout: logs under `logs/` with the existing `LOG_FILE_PATTERN`; report files under `reports/` with the producer's hashed filename shape; monitor metadata with the producer's filename shape. Validate regular-file/directory layout without links, preserve their bytes and treat these as non-authorizing operational data. They do not provide claim authority or readiness. Do not add deep content validation, cleanup or ownership inference for historical logs/reports as an incidental adoption requirement.

Implement a bounded, no-symlink-follow protected-namespace inspection for the first-declaration policy, using the existing producer layouts. Unexpected files/subdirectories, symlinks, wrong types and stale/foreign temp/lock artifacts are not newly allowlisted. Reuse existing refusal semantics where applicable; unknown protected content is a named blocked-path refusal. A scan error or incomplete/bounded-out inspection must halt, never approve unseen content. Normal expected runtime append activity is not an exact-byte snapshot of the log tree and must not spuriously invalidate claim decisions; keep exact snapshots for authority/config evidence and layout safety.

This inspection is limited to the protected namespace; it is not a repository-wide traversal or a new adoption/recovery cleanup policy. Existing adoption's historical-data preservation fixtures (including ignored unrelated historical files) remain unchanged; the new first-declaration exception does not grant a broad new protected-content allowance there.

#### Accurate diagnostics in every path

Classify and name blockers as separate facts:

- `staged index content`: all pre-existing staged paths, including staged claim;
- `tracked worktree changes`: tracked modifications/deletions/renames/type changes;
- `untracked content`: untracked paths blocked by the selected policy;
- `protected board surface` / `unsafe path`: explain the protected/layout reason where applicable;
- unresolved operation: name its existing marker separately.

A mixed staged-and-worktree path can have both classifications; do not hide the staged condition or call an untracked entry tracked. Preserve strict `GIT` and recovery `RECOVERY_REQUIRED` result codes while improving their evidence text. Both `assertGitSafe` and `reconcile` must name the blocked paths and state that the workflow will not commit, clean or reset those paths. Messages after effects must also say which generated evidence/config may already remain; never promise globally zero writes after a commit/publication failure.

Use NUL-delimited porcelain/index path queries and parse index/worktree status separately so spaces, quoting, newlines, renames and non-ASCII paths are not misclassified or split into invented filenames. Include source/destination paths for tracked renames/copies. Escape path controls for safe display without changing the underlying path identity. A failed/truncated Git query is uncertainty, never a clean repository; preserve the existing failure-closed behavior and test output-completeness handling when modifying the status reader. Do not change unrelated Git/evidence queries merely for refactoring.

### Required unchanged isolation

Globally empty pre-existing index; unresolved-operation rejection; unrelated tracked-dirt rejection; canonical Git-root/home requirement; board count and safe paths; exact config bytes and newest claim history; shared-lock acquisition/ownership checks; immediately-before-effect/commit rechecks; claim-only `commit --only` and resulting parent/path/byte verification; no hook bypass, staging sweep, cleanup, reset, ignore-file edit, implicit rollback, or automatic retry.

The claim remains the sole changed path in generated commits. A workflow-owned intent-to-add for a new claim is not permission to accept a pre-staged human claim; retain the existing empty-index gates and failed-hook semantics.

### Alternatives and consequences

- Fix only the word “tracked”: necessary but insufficient; retains unrelated scratch friction.
- Globally ignore untracked paths inside the shared helper: rejected; broadens adoption/recovery contrary to the refinement.
- Allow all unstaged tracked changes outside the board surface: deferred to a separate isolation decision.
- Trust `.gitignore` as a safety boundary or skip every protected path by prefix: rejected; ignored unsafe claim/config/layout is still unsafe.
- Explicit policy threading plus protected-path classification requires more tests, but keeps the exception reviewable and prevents its leakage into recovery. Existing-adoption/recovery strictness conservatively isolates a multi-commit replacement/reconciliation workflow from unrelated pending work, even though each commit is path-scoped.

### Verification

Implementation-plan AC7/8/9 cover both first-declaration paths, unchanged scratch bytes/ignore/index state, claim-only commits, negative controls for ordinary adoption/recovery, ignored protected cases, staged/tracked/mixed diagnostics and last-moment races. This ADR changes no implementation or live board.
