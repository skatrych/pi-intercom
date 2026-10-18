// Issue #9 prompt-visibility regressions (ADR 0009-B): what an operator sees, and what a paste can and
// cannot become. The mock UI in the adoption fixtures records prompt strings, which proves the workflow
// constructed a question but proves nothing about a terminal. These cases drive the real dialog component
// with real byte sequences and read real rendered lines, so "visible" and "byte-exact" are demonstrated
// rather than asserted. No Pi host, board, or terminal emulator is involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AdoptionDialog, PASTE_START, PASTE_END, MINIMUM_WIDTH, MINIMUM_HEIGHT, escapeControlCharacters, adoptionInteraction } from '../dist/adoption-ui.js';

const theme = { fg: (_color, text) => text };

/** A host TUI carrying only the two members the dialog is allowed to require. */
function hostTui({ columns = 90, rows = 24 } = {}) {
  const renders = { count: 0 };
  return { tui: { terminal: { columns, rows }, requestRender: () => { renders.count++; } }, renders };
}

/** Drive the component the way Pi does: feed bytes, then read the lines it would paint. */
async function dialog(options = {}) {
  const { tui, renders } = hostTui(options);
  const settlements = [];
  const component = new AdoptionDialog(tui, theme, options.kind ?? 'authorityRecord', options.prompt ?? 'prompt',
    options.mode ?? 'input', settlement => settlements.push(settlement), await import('pi-intercom-tui'), options.pasteTimeoutMs ?? 40);
  const feed = data => { component.handleInput(data); component.invalidate(); return rendered(); };
  const rendered = () => component.render(options.width ?? 80).map(line => stripAnsi(line));
  const settled = () => {
    assert.equal(settlements.length, 1, 'one interaction, one settlement');
    return settlements[0];
  };
  return { component, feed, rendered, settlements, settled, renders };
}

const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const stripAnsi = line => line.replace(ansi, '');
const joined = lines => lines.join('\n');
const waitFor = async predicate => {
  for (let attempt = 0; attempt < 200 && !predicate(); attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  return predicate();
};

// ---- visible text, not placeholder text -----------------------------------------------------------

test('the question is painted as durable content beside its answer control', async t => {
  const prompt = 'Type the authorising record.\nAn empty answer cannot produce a claim.';
  const d = await dialog({ prompt });
  const lines = d.feed('r');
  assert.ok(joined(lines).includes('Type the authorising record.'), `question must be visible: ${joined(lines)}`);
  assert.ok(joined(lines).includes('An empty answer cannot produce a claim.'), 'every paragraph is visible');
  assert.ok(joined(lines).includes('r'), 'the answer is visible next to the question');
  assert.ok(!lines.some(line => line.trim() === ''), 'the screen is filled with content, not blank placeholder space');
  assert.equal(d.renders.count > 0, true, 'every keystroke asks Pi to repaint');
});

test('a long question scrolls instead of being clipped away, and the scroll keys are named', async t => {
  const prompt = Array.from({ length: 40 }, (_, index) => `line ${index}`).join('\n');
  const d = await dialog({ prompt, rows: 8 });
  const first = joined(d.feed(''));
  assert.ok(first.includes('line 0'), 'the beginning is visible');
  assert.ok(!first.includes('line 39'), 'a question longer than the screen cannot all be visible at once');
  assert.match(first, /PageUp|PageDown/, 'the dialog says how to see the rest');
  for (let index = 0; index < 20; index++) d.feed('\x1b[6~');
  const bottom = joined(d.rendered());
  assert.ok(bottom.includes('line 39'), `scrolling reaches the end: ${bottom.slice(-120)}`);
});

test('terminal too small closes with a named host failure rather than asking an invisible question', async t => {
  for (const size of [{ columns: MINIMUM_WIDTH - 1, rows: 40, width: MINIMUM_WIDTH - 1 }, { columns: 120, rows: MINIMUM_HEIGHT - 1 }]) {
    const d = await dialog(size);
    d.rendered();
    d.rendered();
    // Pi repaints on a timer, so the render call is what notices; the settlement is a microtask after it.
    assert.equal(await waitFor(() => d.settlements.length === 1), true, 'a too-small screen settles on its own');
    assert.match(d.settled().hostFailure, /smaller than the 20x7 needed/, JSON.stringify(size));
    assert.equal(d.settled().value, undefined, 'no answer is ever produced');
  }
});

// ---- paste is transport-decoded, never content-normalised -----------------------------------------

test('a paste keeps the exact bytes, including the CRLF that makes it not match', async t => {
  const payload = 'I confirm coordinator session-1 ended\r\n';
  const d = await dialog();
  d.feed(`${PASTE_START}${payload}${PASTE_END}`);
  d.feed('\r');
  assert.equal(d.settled().value, payload, 'CRLF survives a paste');
});

test('paste payload newlines never submit, and a later Enter submits the whole value', async t => {
  const d = await dialog();
  d.feed(`${PASTE_START}first\nsecond${PASTE_END}`);
  assert.equal(d.settlements.length, 0, 'a newline inside a paste frame is payload, not Enter');
  d.feed('\r');
  assert.equal(d.settled().value, 'first\nsecond');
});

test('tabs and a trailing space survive a paste unchanged', async t => {
  const d = await dialog();
  d.feed(`${PASTE_START}a\tb ${PASTE_END}`);
  d.feed('\r');
  assert.equal(d.settled().value, 'a\tb ');
});

test('a paste frame split across chunks is reassembled byte-exactly', async t => {
  const d = await dialog();
  d.feed(`${PASTE_START}exact`);
  d.feed(' sentence');
  d.feed(PASTE_END);
  d.feed('\r');
  assert.equal(d.settled().value, 'exact sentence');
});

test('an opening delimiter split across chunks is transport, never answer text', async t => {
  const d = await dialog();
  d.feed(PASTE_START.slice(0, 3));
  d.feed(`${PASTE_START.slice(3)}one${PASTE_END.slice(0, 2)}`);
  d.feed(`${PASTE_END.slice(2)}two${PASTE_END}`);
  d.feed('\r');
  assert.equal(d.settled().value, 'onetwo', 'both split delimiters are removed and no byte of the payload is lost');
});

test('a held start prefix that never completes cannot capture the rest of the interaction', async t => {
  const d = await dialog();
  d.feed('\x1b[2');
  d.feed('x');
  d.feed('\r');
  // `ESC [ 2 x` is one complete CSI sequence, so nothing of it is answer text; what matters is that the
  // dialog left paste mode and this Enter really did end the interaction.
  assert.equal(d.settled().value, '', 'a control sequence is not answer text');
  d.feed('later');
  d.feed('\r');
  assert.equal(d.settlements.length, 1, 'the interaction ended at the first Enter, not after a stuck paste');
});

test('an unterminated paste fails visibly and never becomes a candidate answer', async t => {
  const d = await dialog({ pasteTimeoutMs: 20 });
  d.feed(`${PASTE_START}half an answer`);
  assert.equal(await waitFor(() => d.settlements.length === 1), true, 'an unfinished frame cannot wait forever');
  assert.match(d.settled().captureFailure, /never completed/);
  assert.equal(d.settled().value, undefined, 'a partial paste is not an answer');
  d.feed('\r');
  assert.equal(d.settlements.length, 1, 'nothing is settled twice');
});

test('a nested paste start fails closed instead of guessing a payload', async t => {
  const d = await dialog({ pasteTimeoutMs: 20 });
  d.feed(`${PASTE_START}a${PASTE_START}b${PASTE_END}`);
  assert.equal(await waitFor(() => d.settlements.length === 1), true, 'a nested frame cannot stay open');
  assert.match(d.settled().captureFailure, /second paste start/);
});

test('an unexpected paste end fails closed', async t => {
  const d = await dialog();
  d.feed(PASTE_END);
  assert.match(d.settled().captureFailure, /no paste in progress/);
});

test('an empty paste frame is a real empty answer, which the domain still refuses', async t => {
  const d = await dialog();
  d.feed(`${PASTE_START}${PASTE_END}`);
  d.feed('\r');
  assert.equal(d.settled().value, '', 'an empty paste is reported honestly as empty');
});

test('dismissal discards every buffered byte instead of keeping them for later', async t => {
  const d = await dialog();
  d.feed('typed');
  d.feed('\x1b');
  assert.equal(await waitFor(() => d.settlements.length === 1), true, 'Escape ends the interaction');
  assert.equal(d.settled().cancelled, true);
  d.feed('more');
  d.feed('\r');
  assert.equal(d.settlements.length, 1, 'a dismissed dialog is finished');
  assert.equal(d.settled().value, undefined, 'the discarded text never resurfaces as an answer');
});

test('control characters are displayed as symbols while the compared answer stays byte-exact', async t => {
  const d = await dialog();
  d.feed(`${PASTE_START}a\tb${PASTE_END}`);
  const lines = joined(d.rendered());
  assert.ok(lines.includes(escapeControlCharacters('a\tb')), `the tab is shown as a symbol: ${JSON.stringify(lines)}`);
  assert.ok(!lines.includes('\tb'), 'a raw tab is not painted as layout');
  d.feed('\r');
  assert.equal(d.settled().value, 'a\tb', 'display never changes the answer');
});

// ---- confirmations --------------------------------------------------------------------------------

test('yes/no answers are distinct from dismissal, and either may be submitted', async t => {
  const yes = await dialog({ mode: 'confirm' });
  yes.feed('y');
  yes.feed('\r');
  assert.equal(yes.settled().value, true);
  const no = await dialog({ mode: 'confirm' });
  no.feed('n');
  no.feed('\r');
  assert.equal(no.settled().value, false);
  const dismissed = await dialog({ mode: 'confirm' });
  dismissed.feed('\x1b');
  assert.equal(await waitFor(() => dismissed.settlements.length === 1), true, 'Escape ends the interaction');
  assert.equal(dismissed.settled().cancelled, true);
  assert.equal(dismissed.settled().value, undefined, 'dismissal is not a No');
});

test('the selected answer is shown as selected', async t => {
  const d = await dialog({ mode: 'confirm' });
  assert.match(joined(d.feed('y')), /Yes/);
  assert.match(joined(d.rendered()), /No/);
});

test('a long ended-wording sentence stays complete on a narrow terminal', async t => {
  const sessionId = 'c'.repeat(120);
  const prompt = `Type exactly:\nENDED ${'I confirm coordinator ' + sessionId + ' ended'}`;
  const d = await dialog({ prompt, width: 24, columns: 24, rows: 12 });
  // A long id cannot fit a narrow line: wrapping must carry every character to a following line, and the
  // scroll indicator must admit there is more. Scrolling to the end has to show the tail, not an ellipsis.
  const first = joined(d.feed(''));
  assert.match(first, /instructions \d+-\d+ of \d+/, 'the operator is told the question continues');
  for (let index = 0; index < 20; index++) d.feed('\x1b[6~');
  const tail = joined(d.rendered());
  // Rejoin the wrapped lines: the characters were never dropped, only moved to the next line.
  const body = tail.split('\n').filter(line => /^\S/.test(line) && !line.startsWith('>')).join('');
  assert.ok(body.includes(sessionId), `every character of the long id is reachable by scrolling: ${body}`);
  assert.ok(body.includes('ended'), 'and so is the end of the sentence');
});

test('a pasted exact sentence reaches the domain byte-identically, which is the whole gate', async t => {
  const expected = `I confirm coordinator ${'a'.repeat(64)} ended`;
  const d = await dialog();
  d.feed(`${PASTE_START}${expected}${PASTE_END}`);
  d.feed('\r');
  const { ENDED_WORDING } = await import('../dist/adoption.js');
  assert.equal(d.settled().value, expected, 'no normalization happened in the dialog');
  assert.equal(d.settled().value, ENDED_WORDING('a'.repeat(64)), 'and the value is exactly what the domain compares against');
});

test('the same paste with one added space is refused by the domain comparison, unchanged', async t => {
  const { ENDED_WORDING } = await import('../dist/adoption.js');
  const d = await dialog();
  d.feed(`${PASTE_START}${ENDED_WORDING('session-1')} ${PASTE_END}`);
  d.feed('\r');
  assert.equal(d.settled().value.endsWith(' '), true, 'the trailing space survived, as it must');
  assert.notEqual(d.settled().value, ENDED_WORDING('session-1'), 'so the exact comparison still fails');
});

// ---- routing contract ------------------------------------------------------------------------------

test('a host with no custom surface is a named refusal, never a placeholder question', async t => {
  const routed = adoptionInteraction({});
  await assert.rejects(() => routed.input({ kind: 'authorityRecord', prompt: 'Type the authorising record.' }),
    /no custom interaction surface/);
  await assert.rejects(() => routed.confirm({ kind: 'boardInitialize', prompt: 'Initialize the first board?' }),
    /no custom interaction surface/);
});
