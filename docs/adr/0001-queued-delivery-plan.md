# Plan 0001 — paused investigation handover

**Incomplete / withdrawn implementation proposal.** Human placed original issue #2 On Hold on 2026-10-13. This file records unfinished work; it authorizes none. Mandatory Verifier review of this record and ADR remains outstanding.

## Completed and retained

See [investigation checkpoint](0001-queued-delivery-owner.md), [fixture protocol](../fixtures/2-queued-delivery/README.md) and [exact completed observations](../fixtures/2-queued-delivery/evidence.json).

The original stall was not reproduced in completed Pi1.2.0/fork/upstream controlled busy/idle/settlement-edge cases or one healthy authenticated busy arrival. The separate auth-transition host rejection/false-settlement and delayed input-order findings are not the original issue's confirmed cause and are not authorized repair targets. Earlier candidate host repair/FIFO plan is withdrawn by human routing; no finished implementation plan exists.

At pause, no additional experiment, historical/production metadata inspection, source implementation, package installation, tracker publication or architecture expansion is authorized. Coordinator handles authorized Intercom issue updates. Fork #2 stays open On Hold; human release is required before resumption.

## Unfinished gates (not a work assignment)

- Original failing current regression and owning layer; historical Pi version/raw correlated receipts/submissions/transcript/boundary data; historical duplication provenance.
- Explicit supported-host contract/matrix and any justified minimal repair; before/after verification of all seven ACs.
- Host main execution (source comparison only so far), independent review, code review, full repository/package checks, submission-ready patch or upstream PR.
- Separate host auth finding, if later assigned: validate proposed scope and native-provider reachability independently; no natural service-auth frequency measured. Do not substitute it for original #2.
- Maintainer `lgtm` gate before Pi PR, contributor approval unverified; issue publication must follow upstream human-authored short template requirements. No new upstream issues are assigned here.

Seven ACs remain binding. Saving these documents is not design approval, implementation completion, upstream contribution or permission to resume.

## Exact retained write surface

Architect authored only:

- `docs/adr/0001-queued-delivery-owner.md`
- `docs/adr/0001-queued-delivery-plan.md`
- `docs/fixtures/2-queued-delivery/README.md`
- `docs/fixtures/2-queued-delivery/host-session.mjs`
- `docs/fixtures/2-queued-delivery/live-session.mjs`
- `docs/fixtures/2-queued-delivery/evidence.json`

No production `src`, `tests`, package/lockfile or `dist` change. No approved future production write inventory; any resumption needs fresh Coordinator routing, owner handover and Verifier write-surface review.

## Runtime handover

Coordinator owns/removes `/tmp/pi-intercom-2.OnAFFC` after evidence safe and fixture processes settled. It contains provided fork/upstream executable copies, setup logs, read-only host source copy and `runs/{sdk,live}` config/log outputs. SDK session managers were in-memory; provided session directories unused. Auth was accessed through Pi service, never copied/read/logged. No additional clone/worktree/production board mutation.

Available initial fixture setup failure/timeout logs are retained as non-evidence, not host stalls. Exact completed public observations are saved in `evidence.json`; syntax checks passed, direct-host assertion failed as expected. Full suites/package checks were not performed by Architect. No cleanup/self-exit or further experiment while paused.
