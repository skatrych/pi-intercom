import { createHash } from 'node:crypto';
import { constants as fsConstants, type Stats } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { BUILTIN_REMINDER_CONTENT } from './reminders.js';

/**
 * Generic optional reminder text selector. Absent: the built-in text, with no file access. Present: exactly
 * one absolute native-platform path to a small UTF-8 file, read once per Intercom runtime start.
 * The loader is content-agnostic: it knows no workflow, question, identifier or version.
 */
export const REMINDER_FILE_ENV = 'PI_INTERCOM_REMINDER_FILE';
export const REMINDER_FILE_MAX_BYTES = 16384;
export const REMINDER_MAX_CODE_POINTS = 4000;
/** The only text emitted for an invalid selection. It never carries the path, raw value, contents or a raw error. */
export const REMINDER_CONFIGURATION_DIAGNOSTIC = 'Intercom reminder configuration invalid; reminders unavailable until corrected and runtime reloaded.';

/** Immutable runtime snapshot. sha256 is the lowercase hex digest of the exact UTF-8 bytes of text. */
export interface ReminderContent {
  readonly text: string;
  readonly source: 'builtin' | 'file';
  readonly sha256: string;
}
/** Per-delivery metadata passed across the host boundary. Kinds, hashes and an attempt identifier only. */
export interface ReminderSubmission {
  readonly attemptId: string;
  readonly source: ReminderContent['source'];
  readonly sha256: string;
}
/** Fixed failure kinds. They are never logged with a path, value or content, and never reach the model. */
export type ReminderContentFailure = 'selector' | 'read' | 'size' | 'encoding' | 'content';
export type ReminderContentResult =
  | { readonly ok: true; readonly content: ReminderContent }
  | { readonly ok: false; readonly failure: ReminderContentFailure };

/** Filesystem seam. Production uses node:fs; tests wrap it to prove exactly how often a file is touched. */
export interface ReminderFileHandle {
  stat(): Promise<Stats>;
  read(buffer: Buffer, offset: number, length: number, position: number | null): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}
export interface ReminderFileSystem {
  lstat(file: string): Promise<Stats>;
  open(file: string, flags: number): Promise<ReminderFileHandle>;
}
export const nodeReminderFileSystem: ReminderFileSystem = {
  lstat: file => lstat(file),
  open: async (file, flags) => open(file, flags),
};
export interface ReminderContentOptions {
  files?: ReminderFileSystem;
  /** Test seam for selector rules. Production uses the host platform. */
  platform?: NodeJS.Platform;
}

/** Production environment read. Callers take it once per runtime start. */
export function readReminderFileEnv(): string | undefined { return process.env[REMINDER_FILE_ENV]; }

/**
 * Exactly one absolute path for the native platform. No trimming, `~`/variable expansion, globbing, URL
 * interpretation or CWD resolution. Spaces are literal. Empty, NUL, CR and LF are rejected.
 */
export function reminderFileSelectorValid(selector: string, platform: NodeJS.Platform = process.platform): boolean {
  if (selector.length === 0 || /[\0\r\n]/.test(selector)) return false;
  if (platform === 'win32') return /^[A-Za-z]:[\\/]/.test(selector) || /^\\\\[^\\/]+\\[^\\/]+/.test(selector);
  return path.posix.isAbsolute(selector);
}

// Non-following open where the platform has it. Non-blocking so a FIFO swapped in after lstat cannot wedge.
const READ_FLAGS = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0);

/**
 * Reads a trusted local regular file with a fixed byte cap. Symlinks and non-regular files are rejected
 * before any open or read. A growing, shrinking or replaced file fails instead of yielding a partial value.
 */
async function readBoundedRegularFile(file: string, files: ReminderFileSystem): Promise<Buffer | ReminderContentFailure> {
  const before = await files.lstat(file);
  if (before.isSymbolicLink() || !before.isFile()) return 'read';
  if (before.size > REMINDER_FILE_MAX_BYTES) return 'size';
  const handle = await files.open(file, READ_FLAGS);
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) return 'read';
    if (before.ino !== 0 && (opened.ino !== before.ino || opened.dev !== before.dev)) return 'read';
    if (opened.size > REMINDER_FILE_MAX_BYTES) return 'size';
    // One byte beyond the cap detects growth without an unbounded read.
    const buffer = Buffer.allocUnsafe(REMINDER_FILE_MAX_BYTES + 1);
    let total = 0;
    while (total <= REMINDER_FILE_MAX_BYTES) {
      const { bytesRead } = await handle.read(buffer, total, REMINDER_FILE_MAX_BYTES + 1 - total, null);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > REMINDER_FILE_MAX_BYTES) return 'size';
    if (total !== opened.size) return 'read';
    return buffer.subarray(0, total);
  } finally {
    await handle.close().catch(() => {});
  }
}

/**
 * Lossless text checks only. Fatal UTF-8 decoding rejects malformed and surrogate-encoded input; the BOM is
 * kept visible to the check (ignoreBOM) so it can be rejected rather than silently stripped.
 */
function decodeReminderText(bytes: Buffer): { ok: true; text: string } | { ok: false; failure: ReminderContentFailure } {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return { ok: false, failure: 'encoding' }; }
  let codePoints = 0;
  for (const character of text) {
    codePoints++;
    const code = character.codePointAt(0) ?? 0;
    // BOM, NUL, CR and every other C0 control except TAB and LF, plus DEL.
    if (code === 0xfeff || code === 0x7f || (code < 0x20 && code !== 0x09 && code !== 0x0a)) return { ok: false, failure: 'content' };
  }
  if (codePoints < 1 || codePoints > REMINDER_MAX_CODE_POINTS) return { ok: false, failure: 'content' };
  if (!/\S/u.test(text)) return { ok: false, failure: 'content' }; // whitespace-only
  return { ok: true, text };
}

/**
 * Resolves the selector into an immutable snapshot. Never throws, logs or retries. An absent selector
 * returns the built-in content without touching the filesystem.
 */
export async function loadReminderContent(selector: string | undefined, options: ReminderContentOptions = {}): Promise<ReminderContentResult> {
  if (selector === undefined) return { ok: true, content: BUILTIN_REMINDER_CONTENT };
  if (!reminderFileSelectorValid(selector, options.platform)) return { ok: false, failure: 'selector' };
  try {
    const bytes = await readBoundedRegularFile(selector, options.files ?? nodeReminderFileSystem);
    if (!Buffer.isBuffer(bytes)) return { ok: false, failure: bytes };
    const decoded = decodeReminderText(bytes);
    if (!decoded.ok) return decoded;
    const content: ReminderContent = Object.freeze({
      text: decoded.text,
      source: 'file',
      // Hash the exact bytes: valid UTF-8 round-trips losslessly, so these equal the text's UTF-8 encoding.
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    return { ok: true, content };
  } catch {
    return { ok: false, failure: 'read' };
  }
}
