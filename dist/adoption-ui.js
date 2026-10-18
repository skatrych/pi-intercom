import { AdoptionHostUiUnavailable, AdoptionInputCaptureFailure } from './adoption.js';
/**
 * Loaded lazily and cached. `src/index.ts` is the entry the host loads directly from source, and a static
 * bare specifier here would put `pi-intercom-tui` on that load path: an adoption dialog could then make the
 * whole extension unusable. Loading it only when a question is actually asked keeps a missing rendering
 * dependency a named `HOST` refusal for that one question, which is what an operator needs to see anyway.
 */
let primitives;
function tuiPrimitives() {
    primitives ??= import('pi-intercom-tui').then(module => module, error => {
        primitives = undefined;
        throw new AdoptionHostUiUnavailable(`the terminal rendering surface could not be loaded, so the adoption question cannot be displayed visibly: ${String(error)}`);
    });
    return primitives;
}
/**
 * The adoption interaction adapter (issue #9, ADR 0009-B).
 *
 * Every adoption question is rendered as durable visible text beside its own answer controls inside one
 * Pi-owned custom screen, built only from public `pi-intercom-tui` primitives and the captured
 * `ctx.ui.custom()`. The stock `Input`/`ui.input` mapping is deliberately not used: the installed host
 * renders an `input` placeholder nowhere, and the stock paste handler deletes CR/LF and expands tabs,
 * which would silently turn an inexact paste into a matching answer.
 *
 * This module presents. It never selects a target, validates an answer, or creates consent: the domain
 * workflow in `adoption.ts` owns all of that, and answers are forwarded to it unchanged.
 */
/** Bracketed-paste transport framing. Removing these delimiters decodes transport, never answer text. */
export const PASTE_START = '\x1b[200~';
/** A lone Escape is a complete key event, never the beginning of a paste frame. */
const ESCAPE = '\x1b';
export const PASTE_END = '\x1b[201~';
const TITLE = 'Intercom coordinator adoption';
/** Below this, instructions and answer controls cannot both be shown, so the dialog is not opened. */
export const MINIMUM_WIDTH = 20;
export const MINIMUM_HEIGHT = 7;
/** Fixed rows around the prompt viewport: title, rule, answer/controls row, key-hint row. */
const CHROME_ROWS = 4;
/** Prompt text is data: control characters are displayed, never executed by the terminal. */
const CONTROL_DISPLAY = { '\r': '␍', '\n': '␊', '\t': '⇥' };
/** Escape-sequence boundaries for splitting an arbitrary input chunk into single key events. */
const KEY_SEQUENCE = /^\x1b(?:\[[0-9;?=!]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[PX^_][^\x1b\x07]*(?:\x07|\x1b\\))|^[\s\S]/;
const CONTROL = /[\x00-\x1f\x7f-\x9f]/;
/** Render control characters visibly. Display only: the compared answer never changes. */
export function escapeControlCharacters(value) {
    let result = '';
    for (const character of value) {
        const visible = CONTROL_DISPLAY[character];
        if (visible !== undefined)
            result += visible;
        else if (CONTROL.test(character))
            result += `<0x${(character.codePointAt(0) ?? 0).toString(16).padStart(2, '0')}>`;
        else
            result += character;
    }
    return result;
}
/**
 * The raw-preserving answer buffer plus a bounded, paged prompt viewport.
 *
 * `handleInput` is the whole input path: a complete paste frame stores its payload unchanged, markers
 * split across chunks are reassembled, and incomplete, nested, or unexpected-end framing fails closed
 * instead of producing a candidate answer. Payload characters are data: they can never submit, cancel,
 * or move anything.
 */
export class AdoptionDialog {
    tui;
    theme;
    kind;
    prompt;
    mode;
    settle;
    draw;
    pasteTimeoutMs;
    answer = '';
    cursor = 0;
    selection = false;
    pasting = false;
    paste = '';
    pending = '';
    /** True while a held-over chunk still has to complete the opening paste delimiter. */
    awaitingStart = false;
    scroll = 0;
    settled = false;
    timer;
    body = [];
    /** Set by Pi's TUI when this screen gains or loses focus; drives the visible cursor marker. */
    focused = false;
    constructor(tui, theme, kind, prompt, mode, settle, draw, pasteTimeoutMs = 500) {
        this.tui = tui;
        this.theme = theme;
        this.kind = kind;
        this.prompt = prompt;
        this.mode = mode;
        this.settle = settle;
        this.draw = draw;
        this.pasteTimeoutMs = pasteTimeoutMs;
    }
    invalidate() { this.body = []; }
    // ---- input ---------------------------------------------------------------------------
    handleInput(data) {
        if (this.settled)
            return;
        if (this.pasting) {
            this.continuePaste(data);
            return;
        }
        if (data.startsWith(PASTE_START) && data.indexOf(PASTE_END, PASTE_START.length) !== -1) {
            // One complete frame, which is how Pi's own input framer delivers a paste. The payload between the
            // two transport delimiters is stored unchanged; the two delimiters are the only bytes removed.
            const end = data.indexOf(PASTE_END, PASTE_START.length);
            const payload = data.slice(PASTE_START.length, end);
            // Framing is decoded, never guessed at. A payload holding another opening delimiter is ambiguous
            // transport, and it fails closed here exactly as it does when the same frame arrives in chunks.
            if (payload.indexOf(PASTE_START) !== -1) {
                this.fail('a second paste start arrived before the first paste ended');
                return;
            }
            this.insert(payload);
            const rest = data.slice(end + PASTE_END.length);
            if (rest !== '')
                this.dispatch(rest);
            else
                this.tui.requestRender();
            return;
        }
        if (data.indexOf(PASTE_END) !== -1 && !data.startsWith(PASTE_START)) {
            this.fail('a paste end marker arrived with no paste in progress');
            return;
        }
        const stray = data.indexOf(PASTE_START);
        if (stray === -1) {
            // Only a genuine prefix of the opening delimiter may be held. A complete key sequence — an Escape
            // above all — is never held waiting for a paste that may never arrive, or dismissal would stop working.
            const held = data === ESCAPE ? 0 : partialMarker(data, PASTE_START);
            this.dispatch(data.slice(0, data.length - held));
            this.pending = data.slice(data.length - held);
            if (this.pending !== '') {
                this.awaitingStart = true;
                this.beginPaste();
            }
            return;
        }
        if (stray > 0)
            this.dispatch(data.slice(0, stray));
        this.paste = data.slice(stray + PASTE_START.length);
        this.awaitingStart = false;
        this.beginPaste();
    }
    /** A frame opened across chunks: a later chunk closes it, contains another start marker, or is payload. */
    continuePaste(data) {
        let buffer = this.pending + data;
        this.pending = '';
        if (this.awaitingStart) {
            // The opening delimiter was split across chunks. Reassembled, it is still transport framing, so it
            // is removed here; the bytes after it are the payload. A chunk that turns out not to open a frame
            // after all was ordinary keystrokes, and is dispatched as such.
            if (buffer.startsWith(PASTE_START)) {
                buffer = buffer.slice(PASTE_START.length);
                this.awaitingStart = false;
            }
            else if (partialMarker(buffer, PASTE_START) === buffer.length) {
                this.pending = buffer;
                this.beginPaste();
                return;
            }
            else {
                // The held bytes turned out to be ordinary keystrokes after all: leave paste mode, or every later
                // keystroke — including the Enter that answers the question — would be swallowed as payload.
                this.awaitingStart = false;
                this.pasting = false;
                clearTimeout(this.timer);
                this.dispatch(buffer);
                return;
            }
        }
        const end = buffer.indexOf(PASTE_END);
        if (end !== -1) {
            const payload = buffer.slice(0, end);
            if (payload.indexOf(PASTE_START) !== -1) {
                this.fail('a second paste start arrived before the first paste ended');
                return;
            }
            this.paste += payload;
            this.insert(this.paste);
            this.paste = '';
            this.pasting = false;
            clearTimeout(this.timer);
            const rest = buffer.slice(end + PASTE_END.length);
            if (rest !== '')
                this.dispatch(rest);
            else
                this.tui.requestRender();
            return;
        }
        if (buffer.indexOf(PASTE_START) !== -1) {
            this.fail('a second paste start arrived before the first paste ended');
            return;
        }
        const held = partialMarker(buffer, PASTE_END);
        this.paste += buffer.slice(0, buffer.length - held);
        this.pending = buffer.slice(buffer.length - held);
        this.beginPaste();
    }
    /**
     * An unfinished frame is never a candidate answer. Pi's framer completes frames itself, so this timer
     * only fires for a host that streams paste bytes; when it fires, the partial payload is discarded and
     * the step fails visibly instead of waiting forever or submitting an incomplete answer.
     */
    beginPaste() {
        this.pasting = true;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.fail('a bracketed paste never completed'), this.pasteTimeoutMs);
        this.timer.unref?.();
        this.tui.requestRender();
    }
    /** A chunk outside paste framing is one or more complete key events. */
    dispatch(data) {
        let rest = data;
        while (rest.length > 0 && !this.settled) {
            const match = KEY_SEQUENCE.exec(rest);
            if (match === null)
                break;
            rest = rest.slice(match[0].length);
            this.key(match[0]);
        }
        this.tui.requestRender();
    }
    key(token) {
        if (this.draw.matchesKey(token, this.draw.Key.escape)) {
            // Dismissal: no answer, and every buffered byte is discarded rather than kept for later.
            clearTimeout(this.timer);
            this.answer = '';
            this.cursor = 0;
            this.pasting = false;
            this.paste = '';
            this.pending = '';
            this.settleOnce({ cancelled: true });
            return;
        }
        if (this.draw.matchesKey(token, this.draw.Key.pageUp) || this.draw.matchesKey(token, this.draw.Key.pageDown)) {
            this.scroll += (this.draw.matchesKey(token, this.draw.Key.pageUp) ? -1 : 1) * Math.max(1, this.viewport());
            return;
        }
        if (this.draw.matchesKey(token, this.draw.Key.left) || this.draw.matchesKey(token, this.draw.Key.right)) {
            const right = this.draw.matchesKey(token, this.draw.Key.right);
            if (this.mode === 'confirm')
                this.selection = right;
            else
                this.cursor = right ? Math.min(this.characters().length, this.cursor + 1) : Math.max(0, this.cursor - 1);
            return;
        }
        if (this.draw.matchesKey(token, this.draw.Key.enter)) {
            // A paste payload is never a submit: a payload newline stays payload, and only an Enter after the
            // closing delimiter reaches this branch.
            if (this.mode === 'confirm')
                this.settleOnce({ value: (this.selection ? true : false) });
            else
                this.settleOnce({ value: this.answer });
            return;
        }
        if (this.mode === 'confirm') {
            if (token === 'y' || token === 'Y')
                this.selection = true;
            else if (token === 'n' || token === 'N')
                this.selection = false;
            return;
        }
        if (this.draw.matchesKey(token, this.draw.Key.backspace) || token === '\x7f' || token === '\b') {
            const kept = this.characters();
            const start = Math.max(0, this.cursor - 1);
            this.answer = kept.slice(0, start).concat(kept.slice(this.cursor)).join('');
            this.cursor = start;
            return;
        }
        if (this.draw.matchesKey(token, this.draw.Key.delete)) {
            const kept = this.characters();
            this.answer = kept.slice(0, this.cursor).concat(kept.slice(this.cursor + 1)).join('');
            return;
        }
        if (this.draw.matchesKey(token, this.draw.Key.home))
            this.cursor = 0;
        else if (this.draw.matchesKey(token, this.draw.Key.end))
            this.cursor = this.characters().length;
        else if (!CONTROL.test(token))
            this.insert(token);
    }
    characters() { return [...this.answer]; }
    insert(text) {
        if (text === '')
            return;
        const inserted = [...text];
        const kept = this.characters();
        this.answer = kept.slice(0, this.cursor).concat(inserted, kept.slice(this.cursor)).join('');
        this.cursor += inserted.length;
    }
    fail(detail) {
        clearTimeout(this.timer);
        this.pasting = false;
        this.paste = '';
        this.pending = '';
        this.answer = '';
        this.cursor = 0;
        this.invalidate();
        this.tui.requestRender();
        this.settleOnce({ captureFailure: detail });
    }
    settleOnce(settlement) {
        if (this.settled)
            return;
        this.settled = true;
        clearTimeout(this.timer);
        this.settle(settlement);
    }
    /** Pi disposes the component when the interaction ends: nothing is retained for a later invocation. */
    dispose() {
        this.settled = true;
        clearTimeout(this.timer);
        this.answer = '';
        this.paste = '';
        this.pending = '';
        this.selection = false;
    }
    // ---- rendering ------------------------------------------------------------------------
    viewport() { return Math.max(1, this.tui.terminal.rows - CHROME_ROWS); }
    render(width) {
        const height = this.tui.terminal.rows;
        if (width < MINIMUM_WIDTH || height < MINIMUM_HEIGHT) {
            // Resizing into an unusable viewport is not a licence for an invisible answer: close and say so.
            queueMicrotask(() => this.settleOnce({ hostFailure: tinyViewport(width, height) }));
            return [];
        }
        if (this.body.length === 0) {
            // Newlines are structure: split first, escape each line's remaining control characters, then wrap.
            this.body = this.prompt.split('\n').flatMap(paragraph => this.draw.wrapTextWithAnsi(escapeControlCharacters(paragraph), Math.max(1, width)))
                .map(line => this.draw.sliceByColumn(line, 0, Math.max(1, width)));
        }
        const viewport = Math.max(1, height - CHROME_ROWS);
        const indicator = this.body.length > viewport;
        const room = Math.max(1, viewport - (indicator ? 1 : 0));
        const last = Math.max(0, this.body.length - room);
        this.scroll = Math.max(0, Math.min(last, this.scroll));
        const lines = [
            this.paint(`${TITLE} · ${this.kind}`, 'accent', width),
            this.paint('─'.repeat(Math.max(0, width)), 'borderMuted', width),
            ...this.body.slice(this.scroll, this.scroll + room),
        ];
        if (indicator) {
            const shown = Math.min(this.body.length, this.scroll + room);
            lines.push(this.paint(`instructions ${this.scroll + 1}-${shown} of ${this.body.length} · ${this.scroll === 0 ? 'PageDown for the rest' : this.scroll >= last ? 'PageUp for the start' : 'PageUp/PageDown to scroll'}`, 'muted', width));
        }
        lines.push(this.mode === 'confirm' ? this.confirmation(width) : this.answerLine(width));
        const hint = this.mode === 'confirm'
            ? 'y/n or left/right selects (No is the default) · Enter confirms the selected answer · Esc declines'
            : this.pasting
                ? 'pasting: transport markers are removed, every payload byte is kept exactly'
                : 'Enter submits exactly what the field shows · Esc cancels · PageUp/PageDown scrolls the instructions';
        lines.push(this.paint(hint, 'muted', width));
        return lines.slice(0, height);
    }
    answerLine(width) {
        const label = '> ';
        const room = Math.max(1, width - this.draw.visibleWidth(label));
        const kept = this.characters();
        // Escape first, then window by terminal columns, so a ␍/⇥ cell can never split into a partial escape.
        const before = escapeControlCharacters(kept.slice(0, this.cursor).join(''));
        const at = escapeControlCharacters(kept.slice(this.cursor, this.cursor + 1).join('')) || ' ';
        const shown = Math.max(0, room - this.draw.visibleWidth(at));
        const visible = shown === 0 ? '' : this.draw.sliceByColumn(before, Math.max(0, this.draw.visibleWidth(before) - shown), shown);
        const marker = this.focused ? this.draw.CURSOR_MARKER : '';
        return this.draw.sliceByColumn(`${label}${visible}${marker}${at}`, 0, Math.max(1, width));
    }
    confirmation(width) {
        const option = (label, selected) => `${selected ? '›' : ' '} ${label}${selected ? ' ·' : ''}`;
        return this.draw.sliceByColumn(`${option('Yes', this.selection)}    ${option('No', !this.selection)}`, 0, Math.max(1, width));
    }
    paint(text, color, width) {
        // Structural text only. Instructions, ids, hashes and paths stay unstyled, so a config-derived name
        // can never restyle or hide a required instruction.
        return this.draw.sliceByColumn(this.theme.fg(color, text), 0, Math.max(1, width));
    }
}
function tinyViewport(width, height) {
    return `the terminal is ${width}x${height}, smaller than the ${MINIMUM_WIDTH}x${MINIMUM_HEIGHT} needed to show a full adoption instruction and its answer controls together`;
}
/** The length of the longest suffix of `value` that is a proper prefix of `marker` (a split delimiter). */
export function partialMarker(value, marker) {
    for (let length = Math.min(value.length, marker.length - 1); length > 0; length--) {
        if (value.endsWith(marker.slice(0, length)))
            return length;
    }
    return 0;
}
/**
 * Route the domain's `ui.input`/`ui.confirm` contract through the visible dialog. Every answer still
 * reaches the domain unchanged; a missing or failing host surface is a named `HOST` failure instead of
 * an invisible question. There is no placeholder-only fallback path.
 */
export function adoptionInteraction(ui) {
    const open = async (kind, prompt, mode) => {
        if (typeof ui?.custom !== 'function') {
            throw new AdoptionHostUiUnavailable(`this Pi UI provides no custom interaction surface, so the ${kind} question cannot be displayed`);
        }
        // Resolved before the screen opens: Pi's custom-screen factory is synchronous and cannot await.
        const draw = await tuiPrimitives();
        const settlement = await ui.custom((tui, theme, _keybindings, done) => {
            if (tui.terminal.columns < MINIMUM_WIDTH || tui.terminal.rows < MINIMUM_HEIGHT) {
                throw new AdoptionHostUiUnavailable(tinyViewport(tui.terminal.columns, tui.terminal.rows));
            }
            return new AdoptionDialog(tui, theme, kind, prompt, mode, result => done(result), draw);
        });
        const outcome = settlement;
        if (typeof outcome !== 'object' || outcome === null)
            return undefined;
        if (outcome.hostFailure !== undefined)
            throw new AdoptionHostUiUnavailable(outcome.hostFailure);
        if (outcome.captureFailure !== undefined)
            throw new AdoptionInputCaptureFailure(outcome.captureFailure);
        if (outcome.cancelled === true)
            return undefined;
        return outcome.value;
    };
    return {
        input: async (options) => await open(options.kind, options.prompt, 'input'),
        confirm: async (options) => await open(options.kind, options.prompt, 'confirm') === true,
    };
}
//# sourceMappingURL=adoption-ui.js.map