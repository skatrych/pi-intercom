# ADR 0009-B: Durable instructions inside the captured Pi interaction

## Decision statement

Show every adoption question as readable text beside its answer controls, and preserve the exact answer the human enters.

## Short summary

Use one Pi-owned screen with complete, scrollable instructions and an empty answer field or yes/no controls. Verify the real display and paste handling; an answer arriving does not prove the instructions were visible or the answer was preserved.

## Details

- Status: Proposed; host rendering proof is a delivery gate
- Date: 2026-10-18
- Scope: [skatrych/pi-intercom #9](https://github.com/skatrych/pi-intercom/issues/9), refined issue body
- Inspected base: `main@1d5bb074fa3fe306f394c1a292cbed95ff438f3b`
- Related: [authorization](0009-first-declaration-authorization.md), [implementation plan](0009-adoption-ux-implementation-plan.md)

### Context and source evidence

`src/index.ts:adoptionContext` maps domain `prompt` to `captured.ui.input('Intercom coordinator adoption', prompt)`. The second host argument is a placeholder, not the question. The adapter drops domain `kind`/`placeholder`. `confirm(title, message)` already receives the question as a message, but the long-preview rendering path needs coverage too.

Inspection of installed public Pi **1.2.0** adds a concrete explanation: `ExtensionInputComponent` accepts `_placeholder` but does not render it at all. Its title uses a wrapping `Text`. `showExtensionConfirm` combines title and message into a selector title. This is source evidence, **not a completed visual smoke test**. The repository develops against 0.84.4 and has a separate explicit 1.2.0 public-host proof; do not infer identical rendering or all-version compatibility from types or the wildcard peer dependency.

`tests/adoption-host.test.mjs` currently proves packed factory loading, public declarations, session persistence/listing and event-bus behavior, not interactive dialog rendering. The mock fixture comment that records “visible text” overstates what a domain mock can prove.

### Decision

#### One captured-UI renderer, shared by every adoption question

Replace the adoption adapter's positional placeholder mapping with a small adoption-only visible-dialog adapter built on **`captured.ui.custom()`**. Render the complete domain prompt as ordinary text in the same Pi-owned interaction as its blank input or yes/no controls. Keep the domain `CommandContext.ui.input/confirm` contract and stable question `kind`; the adapter does not choose targets, validate authority, or create consent on its own.

Use this mechanism for **every** adoption-flow input/confirm: `boardInitialize`, new `firstCoordinatorDeclaration`, `adoptionDecision`, `authorityRecord`, `endedWording`, `adoptTransition`, and `finalizeTransition`. There is no placeholder-only compatibility path. This is the supported visible workaround for the observed host placeholder defect; it is not another adoption writer.

Prefer a small `src/adoption-ui.ts` module to keep layout/input mechanics out of `src/index.ts` and out of domain security logic. Use public Pi custom-UI APIs and the existing `pi-intercom-tui` dependency alias, not host-private component imports, a new terminal renderer, or a dependency/version upgrade hidden in this issue.

#### Rendering and input contract

- A persistent prompt body is distinct from the answer field. It remains available before and while typing, editing, scrolling, and resizing. “Durable” means visible/revisitable throughout that interaction, not a new persisted authorization artifact or automatic model message.
- Wrap complete text to actual terminal columns with the public TUI text/wrapping primitives, preserving newlines. Never ellipsize IDs, expected wording, hashes, paths, roster information or effects. Use plain text, not interpolated Markdown/ANSI that can hide or restyle instructions from config-derived names. Render unsafe terminal controls visibly rather than executing them; never change the underlying compared answer/target.
- Use a bounded prompt viewport with explicit keyboard paging/scroll indicators when the body exceeds available height, and a pinned blank input or yes/no controls. The full body must be reachable in either direction while the answer remains editable. Reserve distinct navigation keys (for example PageUp/PageDown) rather than stealing text-input cursor/edit keys. Reflow on width/height change and invalidate caches on theme/size/content changes.
- A fresh answer field begins empty for **each** question. No programmatic prefill, saved answer, placeholder-as-answer, or completion inserts expected wording. Forward submitted answer contents unchanged; only the backend validates them. Preserve focus forwarding/cursor behavior and paste support. The stock `pi-intercom-tui` 0.84.4 `Input` is **not** an acceptable unchecked answer store: its `handlePaste` removes CR/LF and expands tabs. In particular, pasting the exact sentence plus a trailing newline must not silently become an exact answer.
- Implement raw-preserving bracketed-paste capture in the actual adapter/input component before any stock paste normalization. Remove only the transport delimiters `ESC[200~` and `ESC[201~`; retain the payload's CR, LF, tabs, spaces and case in the answer buffer. A raw-preserving replacement/wrapper is required; do not pass an unchecked payload through stock `Input.handlePaste`. Render control characters as visible escapes in the display only, without changing the stored/submitted answer. Delimiter removal decodes transport framing, not answer text, so it cannot turn an inexact payload into `ENDED_WORDING(target)`.
- Paste payload characters are data, never submit/cancel/navigation keys. Wait for a complete bracketed paste and a separate explicit submit; buffer delimiters/payload split across input chunks. An unterminated, nested, unexpected-end or otherwise malformed paste must fail closed with a visible named input-step failure and no submitted normalized candidate. Clear the paste/answer state on cancellation or interaction disposal. Preserve the backend's exact comparison: completed paste payloads containing trailing CR/LF, embedded line breaks or tabs reach it unchanged and fail `CONFIRMATION` (with the expected sentence for ended wording). Authority-reference trimming remains the existing, explicit **domain** rule, not a generic UI normalization.
- Confirm controls expose explicit Yes/No with No as the safe initial selection; Enter only confirms the currently selected option after user input. Dismissal maps to `false`; input dismissal maps to `undefined`. No timeout or silence grants consent. This changes presentation, not the number or meaning of domain authorization decisions.
- Use the `done` callback to settle each custom interaction once. Dispose interaction-local state on completion, cancellation, shutdown/reload/session replacement. No retained selection or answer may authorize a later invocation. Existing generation/session and snapshot rechecks still govern answers returned during a race.
- If required public UI support is missing, construction fails, or the available viewport cannot display even the controls and a usable body viewport, fail closed with named `HOST`/unavailable feedback through captured Pi UI; do not open an unlabelled input. A resize/reinvocation is an explicit human step, not an automatic retry. Do not claim rendering success based on an answer arriving.

No terminal readline/stdin/stdout fallback, shell prompt, second renderer/writer, frontend-supplied dialog, model-callable tool, `sendUserMessage`, or model-turn trigger is added. The existing role-local command remains the only human entry point and the backend remains the sole adoption writer.

#### Target and failure text remain domain-owned

The body for `endedWording` includes an explicit “Coordinator whose termination you are confirming” label, the backend-validated full target and the complete `ENDED_WORDING(target)` sentence. It also identifies current session, configured board coordinator, and a differing committed claim coordinator as distinct context, without suggesting the latter is necessarily the target. Prepared renewal labels its validated previous coordinator explicitly.

Malformed/incomplete paste capture reports a typed capture failure to the domain input step rather than fabricating an answer or parsing the target from prompt text. The domain maps it to named `CONFIRMATION`, using its validated target for the expected sentence; dismissal remains `CANCELLED`. Until framing completes, buffered paste cannot be submitted as a candidate. Failure results name `authorising record` or `ended-wording confirmation`; mismatches/empty wording include the full expected sentence and disconnected/unknown warning. Keep those result lines complete, including maximum supported session-ID lengths: do not route them through the generic 240-character `reason()` truncation. Arbitrary authority text is never echoed in diagnostics or rendering-test evidence.

### Proof strategy and host defect handling

1. **Domain fixtures** assert complete question contents, kind, target and unchanged result codes/effects. They prove construction, not rendering. Correct the fixture comment accordingly.
2. **Adapter/component tests** execute the real adapter, drive the actual TUI component with keystrokes/paste, and inspect rendered cells at normal and narrow widths before and after typing. Page across the entire body and reconstruct/check all required instruction text, including the full long ID and multiline transition preview. Assert line widths, resize behavior, cancellation and fresh blank input on re-entry. Drive bracketed-paste bytes through the **actual adapter/input**, not only domain string fixtures: exact payload succeeds only after explicit submit; exact sentence plus LF, CR or CRLF, embedded CR/LF, tabs, surrounding spaces and wrong-case/ID payloads remain inexact and fail without effects. Test complete/split markers, chunked payloads, unterminated/nested/unexpected-end framing, and cancel/reinvoke clearing buffered paste. Assert both the unnormalized answer reaching the backend and the named failure; no newline/control within paste may auto-submit. An assertion about `ui.input` arguments alone is insufficient.
3. **Public-host tests** extend the existing packed-source 1.2.0 check and public typecheck to the new adapter. Add a disposable offline rendering harness/PTY where feasible, using real Pi UI plumbing, persisted fixture sessions, temporary board repositories and loopback probes. No installed role edit, live projects-home adoption, model, worker launch or external service is needed. Test 0.84.4 compatibility separately; distinguish its component/API evidence from intended-host visual evidence.
4. **Mandatory manual substitute for unproven pixels:** if automation cannot inspect actual host frames/focus, record a human-observed smoke result in `references/coordinator-adoption.md` (or linked review evidence). Include exact host version/package path, Node/OS, build commit, terminal mode, dimensions, scenario, what remained visible while typing, paging/resize outcome, pass/fail and limitations. “An answer arrived” or “factory loaded” is not a pass. Use temporary boards and cancel before any effect for visibility-only checks.

Manual scenarios: first-board and self-board previews; authority question; ended wording with a 256-character target different from current/claim IDs; multiline exact-transition and recovery previews; 40x12 and 80x24 terminal sizes, resize in both directions, regular/fullscreen where supported, typing/paste and cancel/reinvoke. Check that the full sentence and all preview content are still reachable, not only a prefix at the bottom of the screen.

If a host defect still hides content, document the failing host/version/scenario and retain fail-closed status. Provide and smoke-test a Pi-owned visible workaround (the chosen bounded/paged custom screen, or a correction to its paging/layout) before accepting that host. Do not silently revert to the broken input mapping or advertise visibility on an unproved host. Host support not available in CI is an explicit pending manual acceptance item, not a green rendering test.

### Alternatives and consequences

- Move the whole prompt into `input` title: the smallest immediate fix and useful source evidence, but alone does not establish viewport-height handling for long/multiline previews. Rejected as the complete mechanism.
- `notify` or a status line: transient/truncated; rejected for required instructions.
- An above-editor widget plus standard input: persistent but can be displaced/clipped with a large dialog and lacks a single bounded prompt-navigation contract. Rejected as the default.
- A custom transcript message: adds persistence/model-context and lifecycle concerns without solving focused input viewport behavior; unnecessary here.
- A Pi-owned custom body/input screen adds limited UI code and tests, but centralizes visibility for all kinds without changing authority sources or the writer. Actual host rendering still requires evidence; this ADR does not claim it has already been proved.

### Implementation references inspected

Public Pi 1.2.0 `docs/extensions.md`, `docs/tui.md`, `docs/themes.md`, exported `ExtensionUIContext`, examples `questionnaire.ts`, `widget-placement.ts`, `overlay-qa-tests.ts`, and interactive `extension-input.js`, `extension-selector.js`, `showExtensionInput`/`showExtensionConfirm`. Also inspected `pi-intercom-tui` 0.84.4 `Input.handleInput`/`handlePaste`: bracketed-paste buffering is followed by CR/LF deletion and tab expansion. Implement against exported APIs; these private implementation files are diagnostic evidence only, not override/import contracts.
