// Real adapter + native SelectList + bounded overlay viewport. Not real-host evidence; see ADR 0012.
import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleWidth } from 'pi-intercom-tui';
import { AdoptionSelector, askAdoptionDecision, adoptionInteraction, selectionPrompt, escapeControlCharacters } from '../dist/adoption-ui.js';
import { AdoptionDecisionCaptureFailure, AdoptionHostUiUnavailable } from '../dist/adoption.js';
const ANSI = /\x1b\[[0-9;]*m/g;
const prompt = [
  `Board root: ${'/very/deep/projects/home/'.repeat(8)}`,
  'Current: 01a15161-da4d-73e7-ba68-c0a394830b98 port 43901',
  'Previous: 01a15157-833e-7557-aee5-3858d48dc87e port 41233',
  `Config SHA256: ${'9ae0c1'.padEnd(64, '0')}`,
  'Disconnected is not evidence of termination.',
  ...Array.from({ length: 30 }, (_, i) => `required effect ${i}: untouched workers and close-job fences.`),
].join('\n');
function dialog(columns = 80, rows = 24) {
  const size = { columns, rows };
  let component, resolved = false;
  const surface = { custom: (factory, options) => new Promise(resolve => {
    assert.equal(options.overlay, true);
    component = factory({ terminal: size, requestRender() {} }, { fg: (_name, value) => value }, {}, result => { resolved = true; resolve(result); });
  }) };
  return { surface, size, get component() { return component; }, get resolved() { return resolved; },
    paint: () => component.render(size.columns - 2).map(line => line.replace(ANSI, '')),
    key: data => component.handleInput(data) };
}
function open(columns = 80, rows = 24) {
  const d = dialog(columns, rows);
  const answer = askAdoptionDecision(d.surface, { kind: 'adoptTransition', prompt });
  d.paint();
  return { d, answer };
}
const marked = d => d.paint().find(line => line.trim().startsWith('→'))?.trim();

test('native selection control defaults No; navigation is not consent; explicit activation is', async () => {
  const first = open();
  assert.equal(marked(first.d), '→ No');
  first.d.key('\r'); assert.equal(await first.answer, false);
  const second = open();
  second.d.key('\x1b[B'); assert.equal(marked(second.d), '→ Yes');
  assert.equal(second.d.resolved, false);
  second.d.key('\x1b[A'); assert.equal(marked(second.d), '→ No');
  second.d.key('\x1b[B'); second.d.key('\r'); assert.equal(await second.answer, true);
  const third = open(); third.d.key('\x1b'); assert.equal(await third.answer, false);
});

for (const [columns, rows] of [[100, 30], [60, 18], [40, 12]]) test(`full scrollable context at actual ${columns}x${rows}`, async () => {
  const { d, answer } = open(columns, rows);
  const all = [];
  let previous = '';
  for (let pages = 0; pages < 300; pages++) {
    const painted = d.paint();
    assert.ok(painted.length <= rows - 2, `bounded height: ${painted.length}`);
    assert.ok(painted.every(line => visibleWidth(line) <= columns - 2), 'every row fits overlay');
    assert.ok(painted.some(line => line.trim() === 'Yes'));
    assert.equal(marked(d), '→ No');
    const range = painted.find(line => line.startsWith('Context '));
    if (range === previous) break;
    previous = range;
    all.push(...painted.slice(0, painted.indexOf(range)));
    d.key('\x1b[6~');
  }
  const joined = all.join('').replace(/\s/g, '');
  for (const line of selectionPrompt('adoptTransition', prompt).split('\n')) {
    assert.ok(joined.includes(line.replace(/\s/g, '')), `retrievable: ${line}`);
  }
  d.key('\x1b[H'); assert.match(d.paint().join('\n'), /Intercom coordinator/);
  d.key('\x1b[F'); assert.match(d.paint().join('\n'), /required effect 29/);
  d.key('\x1b'); assert.equal(await answer, false);
});

test('typing, multi-key batches and bracketed paste (including split markers) never activate', async () => {
  const { d, answer } = open();
  for (const input of ['yes', 'y', 'No', ' ', '\x1b[B\r', 'Yes\r', '\x1b[200~\x1b[B\r\x1b[201~', '\x1b[20', '0~', '\x1b[B', '\r', '\x1b[201~']) d.key(input);
  assert.equal(d.resolved, false);
  assert.equal(marked(d), '→ No');
  d.key('\x1b'); assert.equal(await answer, false);
});

test('malformed paste is CONFIRMATION; unfinished paste never grants consent and can be cancelled', async () => {
  for (const payload of ['\x1b[201~', '\x1b[200~\x1b[200~']) {
    const { d, answer } = open(); d.key(payload);
    await assert.rejects(answer, AdoptionDecisionCaptureFailure);
  }
  const { d, answer } = open(); d.key('\x1b[200~'); d.key('Yes\r');
  assert.equal(d.resolved, false); d.key('\x1b'); assert.equal(await answer, false);
});

test('resize repaginates without omission or answer; unusable dimensions fail HOST before acceptance', async () => {
  const { d, answer } = open(); d.key('\x1b[F');
  d.size.columns = 40; d.size.rows = 12;
  assert.ok(d.paint().length <= 10);
  assert.equal(d.resolved, false);
  d.size.rows = 8; d.key('\x1b[B'); d.key('\r');
  await assert.rejects(answer, AdoptionHostUiUnavailable);
});

test('absent/throwing custom surface fails HOST, never falls back to text or native truncated title', async () => {
  for (const surface of [undefined, {}, { select: async () => 'Yes' }, { input: () => assert.fail('input') }, { custom: async () => { throw new Error('broken'); } }]) {
    await assert.rejects(() => askAdoptionDecision(surface, { kind: 'k', prompt: 'p' }), AdoptionHostUiUnavailable);
  }
});

test('malformed runtime capture is CONFIRMATION, distinct from No/undefined and yes', async () => {
  for (const value of ['yes', 'Yes ', '', 'Yes\0No', null, true, 1, {}, [], Symbol('bad')]) {
    await assert.rejects(() => askAdoptionDecision({ custom: async () => value }, { kind: 'k', prompt: 'p' }), AdoptionDecisionCaptureFailure);
  }
  for (const [value, expected] of [['Yes', true], ['No', false], [undefined, false]]) {
    assert.equal(await askAdoptionDecision({ custom: async () => value }, { kind: 'k', prompt: 'p' }), expected);
  }
});

test('no answer before a painted viewport and no text field', () => {
  let answered = false;
  const d = new AdoptionSelector('question', () => ({ columns: 80, rows: 24 }), () => {}, () => { answered = true; });
  d.handleInput('\x1b[B'); d.handleInput('\r'); assert.equal(answered, false);
  const painted = d.render(78).join('\n');
  assert.ok(!/^\s*>\s/m.test(painted));
  assert.match(painted, /→ No/);
});

test('question is durable full text, controls rendered as data, and adapter has no input', () => {
  assert.equal(selectionPrompt('k', 'one\ntwo'), 'Intercom coordinator adoption · k\n\none\ntwo');
  assert.equal(escapeControlCharacters('a\x1bb\tc\rd'), 'a<0x1b>b⇥c␍d');
  assert.ok(selectionPrompt('k', 'x'.repeat(100_000)).endsWith('x'.repeat(100_000)));
  assert.deepEqual(Object.keys(adoptionInteraction(undefined)), ['confirm']);
});
