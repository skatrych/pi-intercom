# PR47: canonical fixtures and bounded phase waits

Correction baseline: `48df3a955187b0804fac78495c4263f534640141`.
Historical Windows evidence: [run 40579189605](https://github.com/skatrych/pi-intercom/actions/runs/40579189605),
[job 122453683041](https://github.com/skatrych/pi-intercom/actions/runs/40579189605/job/122453683041),
[independent investigation](https://github.com/skatrych/pi-intercom/pull/47#issuecomment-6459648393).
This is test-fixture correction, not a change to reminder design or production safety gates.

## Evidence and diagnosis limits

- The original Windows job reached its six-hour limit. Its adoption-contract child did not exit;
  earlier tests reported `BOARD_PATH`. The next test waited unconditionally for the
  `prepared-committed` phase, even if adoption returned a refusal before that phase.
- `createFixture()` used raw `mkdtemp(os.tmpdir())` as the positive board/role root. The runner's
  short-name temporary-directory issue is independently recorded in the existing
  [Windows census](windows-failure-census.md) (roles tests: `RUNNER~1` versus `runneradmin`).
  Async canonicalization and strict home/role gates cannot assume this raw path is canonical.
- The wake-up errors dereference **`runtime.reminders`**, not an absent captured runtime.
  They do not establish a Windows `t.mock.method` capture defect. Capture mocks are unchanged;
  fixtures now assert runtime capture and scheduler construction separately and fail promptly.
- On Linux, a directory-symlink TMPDIR reproduces the relevant fixture contract violation:
  before correction the actual adapter fails to construct reminders, and the adoption phase wait
  does not finish within an external 12-second diagnostic bound. Depending on which safety gate
  is reached first, an aliased fixture can return `AUTH` or `BOARD_PATH` before the phase.
  This is portable source-path reproduction, **not** a Windows host simulation or identification
  of the specific handle that kept the original CI child alive. No such handle was observed.

## Correction and executed regressions

- Canonicalize only automatically created fixture homes with `realpath`. Explicit test homes
  and deliberate negative alias inputs remain unchanged. No product path comparison is relaxed.
- Phase waits race arrival against workflow completion/rejection and a five-second deadline.
  The two adoption-contract barrier tests have 30-second test bounds and always release/drain
  their pending operations in `finally`, before fixture disposal.
- `tests/fixture-portability.test.mjs` runs adoption-contract, reminders, reminder-content-runtime,
  wakeup-extension and wakeup-native-dispatcher in an isolated child under an aliased temporary
  root. Unix uses a directory symlink; Windows uses a privilege-free junction. The child has a
  90-second outer bound and must finish with zero failures/cancellations. Skip accounting
  requires exact names/reasons and matching totals: none on Linux; on Windows, only the
  existing symlink-privilege, Linux-device and POSIX-FIFO cases in reminder-content-runtime.
  An added/missing/replaced skip or changed reason fails, even with the same total.
- A second child deliberately supplies a noncanonical cwd to the real workflow. It must report
  the missed phase with `BOARD_PATH`, fail that intentional test, **and exit naturally** with
  code 1 and no cancellations, signal or timeout. The production gate is still enforcing refusal.
- A fake-clock case checks the unresolved-phase deadline, plus rejection and successful arrival.
  Child runners clear inherited `NODE_TEST_CONTEXT` so Node executes normal CLI reporting/exit.
  No test uses `--test-force-exit`; killing open resources is not clean teardown evidence.
- Sensitivity: removing home canonicalization fails the aliased-root regression. Removing the
  early-completion branch fails the refused-child diagnostic regression (it reaches the bounded
  missing-phase error instead). Both mutations fail assertions with ordinary process exit, not
  an external timeout; restore them before final validation. Skip-accounting fixtures cover
  Linux/Windows output, LF/CRLF, missing/extra/replaced skips, changed/missing reasons,
  inconsistent totals and nonzero failures/cancellations. Replacing exact skip comparison
  with count-only acceptance fails the same-count substitution case.

## Validation and remaining limits

Linux x86_64, Node 24.21.0: full `npm test` **647 PASS / 0 FAIL / 0 CANCELLED / 0 SKIP**;
`npm run typecheck` passes; `npm run check:package` passes (packaged smoke **1 PASS**).
Commands use finite external bounds and the suite's process-environment scrubber.
Build output remains unchanged; this correction adds no production code or dependency.

No local Windows host was available. Final Windows CI at `f638dc8`,
[run 40626255429](https://github.com/skatrych/pi-intercom/actions/runs/40626255429), naturally
exited code 1 in ~356 seconds: **626 PASS / 10 FAIL / 0 CANCELLED / 10 SKIP**. All 15
adoption-contract, five adapter and 11 native-dispatcher cases passed. One introduced wrapper
failure incorrectly required zero skips despite existing Windows platform skips; this follow-up
corrects only that accounting. The other nine failures are existing adoption/UX/roles surfaces,
not repaired here; earlier prerequisite failures had masked several current error signatures.
See the [read-only classification](https://github.com/skatrych/pi-intercom/pull/47#issuecomment-6459998039).
Windows remains a failed CI gate, not green. New-head results must be inspected separately;
Linux success and fabricated Windows TAP accounting do not establish actual Windows PASS.
Do not infer general Windows/#18 acceptance or original CI-handle identity. No CI cancellation/rerun, production install/board, credential or provider operation
is part of this correction. Real-host AC5 and source/installed/loaded/cutover gates remain open.
