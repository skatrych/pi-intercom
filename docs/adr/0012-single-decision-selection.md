# ADR 0012: One contextual yes/no on a visible selection surface

## Status and authority

Implementation candidate, pending independent review/acceptance. Requirements: issue #12 and approved
[refinement 6256579005](https://github.com/skatrych/pi-intercom/issues/12#issuecomment-6256579005).
Repair base: `main@87768090abe1152346d1a4dfacee392a5c41896b`. Salvaged only committed candidate
`268f1d987e30c4d925f47bacab22f5e5d18759e6`, then corrected the independent
[gap brief 6289438653](https://github.com/skatrych/pi-intercom/issues/12#issuecomment-6289438653).
This is not a claim of delivery approval.

Related: [visibility](0009-adoption-prompt-visibility.md),
[declaration authorization](0009-first-declaration-authorization.md),
[Git policy](0009-first-declaration-git-safety.md).

## Decision

- Each admissible human-touching invocation asks exactly one combined yes/no: `boardInitialize`,
  `firstCoordinatorDeclaration`, `adoptTransition`, `renewAdoptionDecision`, or `finalizeTransition`.
  Already-active, write-free promotion and early security refusals gain no redundant question.
- Remove the preliminary continue question, typed authority reference and typed ended sentence. No text
  input capability is required. Invocation, model text, silence and previous answers are not consent.
- Show full canonical root/current verified pair, backend-selected target/source and differing historical
  identities, relevant transition/hash, branch effects, untouched roster and fenced close jobs. Adoption's
  yes attests that the selected prior coordinator ended AND authorizes the exact replacement. A down or
  unknown endpoint never proves termination. Finalization shows evidence completion without replacement.
- Generate bounded, explicitly implementation-generated adoption evidence from the captured yes, binding
  root hash, transition, config hash and both pairs. Preserve canonical `ENDED_WORDING(previous.sessionId)`
  as the stored attestation, timestamps, schema and historical records. Declarations assert no termination.
  Prepared-before renewal refreshes existing authority; prepared-after finalization preserves anchored
  authority and exact derived-byte semantics, generating no new termination attestation.
- Recheck the original snapshot/identity/epoch under the transaction lock. Changed previews refuse; there
  is no silent re-preview, reused answer, second question, cleanup, rollback or retry.

## Supported visible selection workaround

The native selector accepts a wrapped title but supplies no bounded question paging. Returning every
line from its component renderer did **not** establish that an oversized title was accessible in the
real host. The earlier candidate's inferred terminal-scrollback workaround is withdrawn.

Use public `ctx.ui.custom()` with a bounded overlay and the native `SelectList` control from the existing
`pi-intercom-tui` dependency. This is the refinement's supported visible selection workaround, not the
old custom text-answer screen. `No` is first and selected; up/down move, activation answers, Esc/dismiss
(and the configured cancel binding) decline. No input/caret/placeholder, text parsing or extra read/continue
acknowledgment exists. The entire wrapped question is held for this interaction, with pinned choices,
a line-range indicator, PgUp/PgDn paging and Home/End. Paging is not another decision.

Resize reflows the question. Insufficient dimensions (minimum terminal 40 columns/12 rows with default
bindings), missing custom UI or construction failure produce named `HOST`, never text fallback or silent
truncation. Malformed runtime answers, including nonstrings, and malformed paste framing produce named
`CONFIRMATION`. Bracketed paste is discarded, not interpreted as selection/activation; incomplete paste
cannot grant consent and can be cancelled. Control characters in context are rendered as labelled data.

## Preserved gates

Role/mode/trust, idle/concurrency, persistent local session/port, backend target binding, collisions,
old-endpoint precheck and under-lock re-probe, canonical discovery/path safety, claim history/deletion/
schema/ancestry/committed evidence, foreign intent, snapshot/hash/epoch rechecks, strict adoption/recovery
Git policy, #9's narrow first-declaration untracked exception, global staged-content refusal, claim-only
commits/post-commit proof, partial-failure classification, promotion/readiness and explicit recovery remain.
Main's strict root isolation, `--intercom-root` plumbing and admission epoch regressions are retained.

## Evidence and limits

- Domain/contract/bridge/fixture tests count the exact decision list, use mocks with no `input` member,
  check backend-selected identities, generated/historical evidence, declines, stale answers and retained
  refusals. Renewal and both clean/derived finalization cover HOST/CONFIRMATION without new effects.
- Adapter tests drive the actual native `SelectList`, bounded paging and real widths/heights, reconstruct
  all context, and test resize, safe default, activation, cancellation, typing/paste and malformed capture.
- `test:adoption-dialog` captures all seven branch previews from disposable domain fixtures with No and
  checks the bounded component viewport at 100x30, 60x18 and 40x12. It is not real-host evidence by itself.
- Its opt-in `--real` mode launches a disposable **actual Pi** host in a PTY, with only a synthetic
  selection extension, isolated HOME/agent directory, no sessions/tools/MCP/extensions/roles/auth/model
  operations. A pyte terminal emulator reads the host's rendered cells and reconstructs all context
  through actual paging while both choices remain visible. The fixture never invokes adoption in Pi.
- Real-host results, exact source revision, commands, dimensions and limitations are recorded in
  [coordinator adoption](../../references/coordinator-adoption.md#host-rendering). No live adoption,
  worker termination, installed-role edit or production-board mutation was performed. Automated terminal
  cells prove more than a mock/render return, but are not human aesthetic approval or all-host support.

## Rejected alternatives

Typed yes/no or ended wording; preliminary plus final approval; native Yes-first confirm; trusting a
mocked answer or unbounded renderer as visible-context proof; inferred terminal scrollback; changing
identity/history/Git gates to make UX tests pass; carrying answers into later invocations.
