import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  BUILTIN_REMINDER_CONTENT, REMINDER_TEXT,
} from '../dist/reminders.js';
import {
  REMINDER_CONFIGURATION_DIAGNOSTIC, REMINDER_FILE_ENV, REMINDER_FILE_MAX_BYTES, REMINDER_MAX_CODE_POINTS,
  loadReminderContent, nodeReminderFileSystem, reminderFileSelectorValid,
} from '../dist/reminder-content.js';

// Pinned independently (python hashlib over the pre-change REMINDER_TEXT literal): the unset default is fixed.
const BUILTIN_SHA256 = '9e43de4e65e55169db497e536a8406799947de5507fde3c51f0724b1c7d9aaea';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

/** Wraps the real filesystem seam and counts every touch, so "zero reads" and "one read" are proven, not assumed. */
function countingFiles() {
  const calls = { lstat: [], open: [], stat: 0, read: 0 };
  return {
    calls,
    files: {
      lstat: async file => { calls.lstat.push(file); return nodeReminderFileSystem.lstat(file); },
      open: async (file, flags) => {
        calls.open.push(file);
        const handle = await nodeReminderFileSystem.open(file, flags);
        return {
          stat: async () => { calls.stat++; return handle.stat(); },
          read: async (...args) => { calls.read++; return handle.read(...args); },
          close: () => handle.close(),
        };
      },
    },
  };
}
/** Fake handle for growth/replacement cases a real filesystem cannot make deterministic. */
function fakeFiles({ lstat, open }) {
  return { lstat: async () => lstat, open: async () => open };
}
function fakeStats(overrides = {}) {
  return { isFile: () => true, isSymbolicLink: () => false, size: 0, ino: 1, dev: 1, ...overrides };
}
function fakeHandle(bytes, stats = {}) {
  let offset = 0;
  const handle = {
    /** Number of content reads: proves when the loader did or did not read bytes. */
    contentReads: 0,
    stat: async () => fakeStats({ size: bytes.length, ...stats }),
    read: async (buffer, at, length) => {
      handle.contentReads++;
      const n = Math.min(length, bytes.length - offset);
      Buffer.from(bytes).copy(buffer, at, offset, offset + n);
      offset += n;
      return { bytesRead: n };
    },
    close: async () => {},
  };
  return handle;
}

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'intercom-reminder-content-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    root,
    file: (name, bytes) => { const f = path.join(root, name); return writeFile(f, bytes).then(() => f); },
  };
}

test('built-in content is the existing literal, byte-for-byte, and is frozen', () => {
  assert.equal(BUILTIN_REMINDER_CONTENT.text, REMINDER_TEXT);
  assert.equal(BUILTIN_REMINDER_CONTENT.source, 'builtin');
  assert.equal(BUILTIN_REMINDER_CONTENT.sha256, BUILTIN_SHA256);
  assert.equal(sha(Buffer.from(REMINDER_TEXT, 'utf8')), BUILTIN_SHA256);
  assert.equal(Buffer.byteLength(REMINDER_TEXT), 435);
  assert.ok(Object.isFrozen(BUILTIN_REMINDER_CONTENT));
  assert.equal(REMINDER_FILE_ENV, 'PI_INTERCOM_REMINDER_FILE');
  assert.equal(REMINDER_FILE_MAX_BYTES, 16384);
  assert.equal(REMINDER_MAX_CODE_POINTS, 4000);
  assert.equal(REMINDER_CONFIGURATION_DIAGNOSTIC, 'Intercom reminder configuration invalid; reminders unavailable until corrected and runtime reloaded.');
});

test('an unset selector returns the built-in text with zero filesystem access', async () => {
  const counted = countingFiles();
  const loaded = await loadReminderContent(undefined, { files: counted.files });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.content.text, REMINDER_TEXT);
  assert.equal(loaded.content.source, 'builtin');
  assert.equal(loaded.content.sha256, BUILTIN_SHA256);
  assert.deepEqual(counted.calls, { lstat: [], open: [], stat: 0, read: 0 });
});

test('a valid arbitrary one-line text with no headers or identifiers is accepted byte-identically', async t => {
  const f = await fixture(t);
  const bytes = Buffer.from('Check whether any worker needs a status request. Do not assume.');
  const loaded = await loadReminderContent(await f.file('one-line.txt', bytes));
  assert.deepEqual(loaded, { ok: true, content: { text: bytes.toString('utf8'), source: 'file', sha256: sha(bytes) } });
  assert.equal(Object.isFrozen(loaded.content), true);
});

test('every accepted byte is preserved: spaces, tabs, interior newlines and the final LF', async t => {
  const f = await fixture(t);
  const body = '  leading space\tand tab\nsecond line  \n\nlast line with trailing space ';
  const withLf = Buffer.from(body + '\n'), withoutLf = Buffer.from(body);
  const a = await loadReminderContent(await f.file('with-lf.txt', withLf));
  const b = await loadReminderContent(await f.file('without-lf.txt', withoutLf));
  assert.equal(a.content.text, withLf.toString('utf8'));
  assert.equal(b.content.text, withoutLf.toString('utf8'));
  assert.ok(a.content.text.endsWith('\n') && !b.content.text.endsWith('\n'));
  assert.equal(a.content.sha256, sha(withLf));
  assert.equal(b.content.sha256, sha(withoutLf));
  assert.notEqual(a.content.sha256, b.content.sha256, 'the final LF is part of the content identity');
});

test('multibyte, combining and supplementary Unicode is accepted exactly and counted by code point', async t => {
  const f = await fixture(t);
  const text = 'Café — 日本語 🙂 e\u0301 𝒜\n';
  const bytes = Buffer.from(text, 'utf8');
  const loaded = await loadReminderContent(await f.file('unicode.txt', bytes));
  assert.equal(loaded.ok, true);
  assert.equal(loaded.content.text, text);
  assert.equal(loaded.content.sha256, sha(bytes));
});

test('code point boundaries: 4000 is accepted, 4001 is rejected, even when UTF-16 length is larger', async t => {
  const f = await fixture(t);
  const ascii4000 = Buffer.from('a'.repeat(4000));
  assert.equal((await loadReminderContent(await f.file('ascii-4000.txt', ascii4000))).ok, true);
  const ascii4001 = Buffer.from('a'.repeat(4001));
  assert.deepEqual(await loadReminderContent(await f.file('ascii-4001.txt', ascii4001)), { ok: false, failure: 'content' });
  // 4000 supplementary code points = 8000 UTF-16 units and 16000 bytes: accepted (under the byte cap).
  const emoji4000 = Buffer.from('🙂'.repeat(4000));
  const accepted = await loadReminderContent(await f.file('emoji-4000.txt', emoji4000));
  assert.equal(accepted.ok, true);
  assert.equal(accepted.content.text.length, 8000);
  assert.equal(Array.from(accepted.content.text).length, 4000);
  assert.deepEqual(await loadReminderContent(await f.file('emoji-4001.txt', Buffer.from('🙂'.repeat(4001)))), { ok: false, failure: 'content' });
  // Mixed widths are counted per code point, not per byte.
  const mixed = Buffer.from('€'.repeat(3999) + '🙂');
  assert.equal((await loadReminderContent(await f.file('mixed.txt', mixed))).ok, true);
});

test('the byte cap is inclusive at 16384 and any larger file is rejected before reading', async t => {
  const f = await fixture(t);
  // A 16384-byte file of ASCII has too many code points; the cap is enforced even when content would be legal.
  const at = await f.file('at-cap.txt', Buffer.alloc(16384, 0x61));
  assert.deepEqual(await loadReminderContent(at), { ok: false, failure: 'content' });
  const counted = countingFiles();
  const over = await f.file('over-cap.txt', Buffer.alloc(16385, 0x61));
  assert.deepEqual(await loadReminderContent(over, { files: counted.files }), { ok: false, failure: 'size' });
  assert.equal(counted.calls.open.length, 0, 'an oversize regular file is refused from its lstat size, never opened');
});

test('selector rules: empty, relative, whitespace-padded, control and non-absolute values never touch the filesystem', async () => {
  const counted = countingFiles();
  for (const selector of ['', ' ', '\t', 'reminder.txt', './reminder.txt', '../reminder.txt', '~/reminder.txt', '$HOME/reminder.txt',
    '${HOME}/x', 'file:///tmp/reminder.txt', ' /tmp/reminder.txt', '\t/tmp/reminder.txt', '/tmp/reminder.txt\n', '\n/tmp/x',
    '/tmp/x\rtail', '/tmp/x\0tail']) {
    assert.deepEqual(await loadReminderContent(selector, { files: counted.files }), { ok: false, failure: 'selector' }, JSON.stringify(selector));
  }
  assert.deepEqual(counted.calls, { lstat: [], open: [], stat: 0, read: 0 });
});

test('a drive-letter selector is platform-scoped: valid absolute on win32, invalid and untouched on linux', async () => {
  // Explicit platform seams make both halves deterministic on any host, including a Windows CI runner.
  const counted = countingFiles();
  assert.deepEqual(await loadReminderContent('C:\\reminder.txt', { files: counted.files, platform: 'linux' }), { ok: false, failure: 'selector' });
  assert.deepEqual(counted.calls, { lstat: [], open: [], stat: 0, read: 0 }, 'a linux drive-letter selector never touches the filesystem');
  const win = await loadReminderContent('C:\\reminder.txt', { files: counted.files, platform: 'win32' });
  assert.notEqual(win.failure, 'selector', 'on win32 the drive-letter path is a valid absolute selector and reaches the filesystem');
  assert.equal(win.failure, 'read', 'the missing fixture file is then reported as a read failure');
  assert.equal(counted.calls.lstat.length, 1);
});

test('selector rules are native-platform fixtures: Windows absolute forms and POSIX-only roots', () => {
  for (const selector of ['C:\\Intercom\\reminder.txt', 'c:/Intercom/reminder.txt', '\\\\server\\share\\reminder.txt']) {
    assert.equal(reminderFileSelectorValid(selector, 'win32'), true, selector);
    assert.equal(reminderFileSelectorValid(selector, 'linux'), false, selector);
  }
  for (const selector of ['C:reminder.txt', '\\reminder.txt', '/reminder.txt', '', 'C:\\x\nD']) {
    assert.equal(reminderFileSelectorValid(selector, 'win32'), false, JSON.stringify(selector));
  }
  for (const selector of ['/var/lib/intercom/reminder.txt', '/with spaces/reminder text.txt']) {
    assert.equal(reminderFileSelectorValid(selector, 'linux'), true, selector);
    assert.equal(reminderFileSelectorValid(selector, 'win32'), false, selector);
  }
  assert.equal(reminderFileSelectorValid('/tmp/a\\b.txt', 'linux'), true, 'a POSIX backslash is a literal name byte');
});

test('absolute paths with spaces are literal and load from exactly that name', async t => {
  const f = await fixture(t);
  const dir = path.join(f.root, 'dir with spaces');
  await mkdir(dir);
  const file = path.join(dir, 'reminder text.txt');
  await writeFile(file, 'spaced path works\n');
  assert.equal((await loadReminderContent(file)).content.text, 'spaced path works\n');
  // A trailing space is a different file name, not a trimmed alias.
  assert.deepEqual(await loadReminderContent(file + ' '), { ok: false, failure: 'read' });
});

test('missing, unreadable-to-stat, directory, leaf symlink and special files are refused before reading', async t => {
  const f = await fixture(t);
  const real = await f.file('real.txt', 'real text');
  const link = path.join(f.root, 'link.txt');
  await symlink(real, link);
  const dir = path.join(f.root, 'a-directory');
  await mkdir(dir);
  const counted = countingFiles();
  assert.deepEqual(await loadReminderContent(path.join(f.root, 'missing.txt'), { files: counted.files }), { ok: false, failure: 'read' });
  assert.deepEqual(await loadReminderContent(dir, { files: counted.files }), { ok: false, failure: 'read' });
  assert.deepEqual(await loadReminderContent(link, { files: counted.files }), { ok: false, failure: 'read' }, 'leaf symlink refused even to a valid target');
  assert.equal(counted.calls.open.length, 0, 'no open for missing, directory or symlink selections');
  assert.equal(counted.calls.read, 0);
  if (process.platform === 'linux') {
    // A character device is refused from its lstat type, so it is never read (and never blocks).
    assert.deepEqual(await loadReminderContent('/dev/null', { files: counted.files }), { ok: false, failure: 'read' });
    assert.equal(counted.calls.open.length, 0);
  }
});

test('a FIFO is refused without blocking a read', { timeout: 10000 }, async t => {
  if (process.platform === 'win32') return t.skip('FIFOs are POSIX-only');
  const f = await fixture(t);
  const fifo = path.join(f.root, 'pipe');
  const made = spawnSync('mkfifo', [fifo]);
  if (made.status !== 0) return t.skip('mkfifo unavailable');
  const counted = countingFiles();
  assert.deepEqual(await loadReminderContent(fifo, { files: counted.files }), { ok: false, failure: 'read' });
  assert.equal(counted.calls.open.length, 0, 'no open of a FIFO selection');
  assert.equal(counted.calls.read, 0);
});

test('a leaf symlink is refused before any open even when the target is a valid regular file', async t => {
  if (process.platform === 'win32') return t.skip('symlink creation is privilege-dependent on Windows');
  const f = await fixture(t);
  const target = await f.file('valid-target.txt', 'valid');
  const link = path.join(f.root, 'selected.txt');
  await symlink(target, link);
  const counted = countingFiles();
  assert.equal((await loadReminderContent(target, { files: counted.files })).ok, true);
  counted.calls.open.length = 0;
  assert.deepEqual(await loadReminderContent(link, { files: counted.files }), { ok: false, failure: 'read' });
  assert.equal(counted.calls.open.length, 0);
});

test('growth and replacement during the read are rejected, never partially accepted', async () => {
  // The selector must be absolute for the platform under test, so the fake lstat/open race is what is measured.
  const selected = process.platform === 'win32' ? 'C:\\fixture\\reminder.txt' : '/fixture/reminder.txt';
  // Regular at lstat, then the open handle reports a different inode: a replacement race.
  const replacedHandle = fakeHandle(Buffer.from('new text'), { ino: 8 });
  const replaced = await loadReminderContent(selected, { files: fakeFiles({
    lstat: fakeStats({ ino: 7 }), open: replacedHandle }) });
  assert.deepEqual(replaced, { ok: false, failure: 'read' });
  assert.equal(replacedHandle.contentReads, 0, 'a replaced inode is refused before any content read');
  // The handle grows past its reported size: more bytes than were stat'd are refused.
  const grown = await loadReminderContent(selected, { files: fakeFiles({
    lstat: fakeStats({ size: 4 }), open: fakeHandle(Buffer.alloc(40, 0x61), { size: 4 }) }) });
  assert.deepEqual(grown, { ok: false, failure: 'read' });
  // Reading past the byte cap is refused even if the stat claimed a small size.
  const oversize = await loadReminderContent(selected, { files: fakeFiles({
    lstat: fakeStats({ size: 1 }), open: fakeHandle(Buffer.alloc(REMINDER_FILE_MAX_BYTES + 5, 0x61), { size: 1 }) }) });
  assert.deepEqual(oversize, { ok: false, failure: 'size' });
  // A handle that is no longer a regular file (a device or FIFO swapped in) is refused without a read.
  const swappedHandle = fakeHandle(Buffer.from('x'), { isFile: () => false });
  const swapped = await loadReminderContent(selected, { files: fakeFiles({
    lstat: fakeStats(), open: swappedHandle }) });
  assert.deepEqual(swapped, { ok: false, failure: 'read' });
  assert.equal(swappedHandle.contentReads, 0, 'a non-regular handle is never read');
});

test('invalid UTF-8 is rejected by fatal decoding, never repaired', async t => {
  const f = await fixture(t);
  for (const [name, bytes] of [
    ['truncated-sequence', [0x43, 0xc3, 0x28]],
    ['lone-continuation', [0x80]],
    ['invalid-start', [0xff, 0x61]],
    ['overlong', [0xc0, 0xaf]],
    ['surrogate', [0xed, 0xa0, 0x80]],
    ['above-unicode', [0xf4, 0x90, 0x80, 0x80]],
  ]) {
    assert.deepEqual(await loadReminderContent(await f.file(`${name}.txt`, Buffer.from(bytes))), { ok: false, failure: 'encoding' }, name);
  }
});

test('BOM, CR, NUL, other C0 controls and DEL are rejected; TAB and LF are accepted', async t => {
  const f = await fixture(t);
  const rejects = {
    bom: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('text')]),
    'bom-mid': Buffer.from('text\uFEFFmore'),
    crlf: Buffer.from('line one\r\nline two'),
    'lone-cr': Buffer.from('line\rtwo'),
    nul: Buffer.from('a\0b'),
    'soh': Buffer.from('a\x01b'),
    'vertical-tab': Buffer.from('a\x0bb'),
    'form-feed': Buffer.from('a\x0cb'),
    escape: Buffer.from('a\x1bb'),
    del: Buffer.from('a\x7fb'),
  };
  for (const [name, bytes] of Object.entries(rejects)) {
    assert.deepEqual(await loadReminderContent(await f.file(`${name}.txt`, bytes)), { ok: false, failure: 'content' }, name);
  }
  const accepted = Buffer.from('tab\tand\nnewline\n');
  assert.equal((await loadReminderContent(await f.file('tab-lf.txt', accepted))).content.text, accepted.toString());
});

test('whitespace-only and empty files are rejected', async t => {
  const f = await fixture(t);
  for (const [name, text] of [['empty', ''], ['spaces', '   '], ['tabs-lines', '\t\n  \n'], ['nbsp', '\u00a0'], ['newline', '\n']]) {
    assert.deepEqual(await loadReminderContent(await f.file(`${name}.txt`, text)), { ok: false, failure: 'content' }, name);
  }
});

test('reads never trim or normalize: the accepted value is the exact decoded input', async t => {
  const f = await fixture(t);
  const nfc = 'Cafe\u0301 review\n', nfd = 'Caf\u00e9 review\n';
  const a = await loadReminderContent(await f.file('nfd.txt', Buffer.from(nfd)));
  const b = await loadReminderContent(await f.file('nfc.txt', Buffer.from(nfc)));
  assert.equal(a.content.text, nfd);
  assert.equal(b.content.text, nfc);
  assert.notEqual(a.content.sha256, b.content.sha256, 'no Unicode normalization before hashing');
});

test('a selected file is never a generic fallback: failures return no content and no built-in text', async t => {
  const f = await fixture(t);
  const failed = await loadReminderContent(path.join(f.root, 'absent.txt'));
  assert.equal(failed.ok, false);
  assert.equal('content' in failed, false);
  assert.equal(failed.failure, 'read');
});
