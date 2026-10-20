import { SelectList, getKeybindings, matchesKey, Key, wrapTextWithAnsi } from 'pi-intercom-tui';
import { AdoptionDecisionCaptureFailure, AdoptionHostUiUnavailable } from './adoption.js';
export const DECLINE = 'No';
export const ACCEPT = 'Yes';
export const CHOICES = [DECLINE, ACCEPT];
export const DIALOG_TITLE = 'Intercom coordinator adoption';
const CONTROL_DISPLAY = { '\r': '␍', '\n': '␊', '\t': '⇥' };
const CONTROL = /[\x00-\x1f\x7f-\x9f]/;
/** Display transform only: paths/identities cannot execute terminal instructions. */
export function escapeControlCharacters(value) {
    return [...value].map(character => CONTROL_DISPLAY[character]
        ?? (CONTROL.test(character) ? `<0x${character.codePointAt(0).toString(16).padStart(2, '0')}>` : character)).join('');
}
export function selectionPrompt(kind, prompt) {
    return `${DIALOG_TITLE} · ${escapeControlCharacters(kind)}\n\n${prompt.split('\n').map(escapeControlCharacters).join('\n')}`;
}
/**
 * Supported visible workaround for the native selector's unbounded title. ui.custom overlays are a
 * public host API; SelectList is the same selection control class used by the native selector. The
 * question has a bounded, explicitly paged viewport, not an input field or inferred terminal scrollback.
 * Choices remain visible while every question line is retrievable with PgUp/PgDn (Home/End too).
 * There is only one answer callback, no read/continue acknowledgment and no text-answer channel.
 */
export class AdoptionSelector {
    question;
    dimensions;
    repaint;
    done;
    choices;
    offset = 0;
    lines = [];
    pageSize = 1;
    painted = false;
    finished = false;
    pasting = false;
    pastePrefix = '';
    constructor(question, dimensions, repaint, done, color = (_name, value) => value) {
        this.question = question;
        this.dimensions = dimensions;
        this.repaint = repaint;
        this.done = done;
        this.choices = new SelectList(CHOICES.map(value => ({ value, label: value })), 2, {
            selectedPrefix: value => color('accent', value), selectedText: value => color('accent', value),
            description: value => color('muted', value), scrollInfo: value => color('muted', value), noMatch: value => value,
        });
        this.choices.onSelect = item => this.finish(item.value);
        this.choices.onCancel = () => this.finish(undefined);
    }
    finish(answer) {
        if (!this.finished) {
            this.finished = true;
            this.done(answer);
        }
    }
    available(width) {
        const { columns, rows } = this.dimensions();
        if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 12 || columns < 40 || width < 36) {
            this.finish(new AdoptionHostUiUnavailable('the visible selection surface needs at least 40 columns and 12 rows; enlarge the terminal and invoke again'));
            return false;
        }
        return true;
    }
    invalidate() { this.choices.invalidate(); }
    render(width) {
        if (!this.available(width))
            return [];
        const kb = getKeybindings();
        const hints = wrapTextWithAnsi(`PgUp/PgDn: context; Home/End: first/last. ${kb.getKeys('tui.select.up').join('/')}/${kb.getKeys('tui.select.down').join('/')}: choose; ${kb.getKeys('tui.select.confirm').join('/')}: activate; ${kb.getKeys('tui.select.cancel').join('/')}: decline.`, width);
        if (hints.length + 4 > this.dimensions().rows - 2) {
            this.finish(new AdoptionHostUiUnavailable('the visible selection controls and key hints do not fit this viewport; enlarge the terminal and invoke again'));
            return [];
        }
        // Overlay occupies at most rows-2; reserve an additional line for the range and both choices.
        this.pageSize = Math.max(1, this.dimensions().rows - 2 - hints.length - 3);
        this.lines = this.question.split('\n').flatMap(line => wrapTextWithAnsi(line, width));
        this.offset = Math.max(0, Math.min(this.offset, this.lines.length - this.pageSize));
        this.painted = true;
        return [
            ...this.lines.slice(this.offset, this.offset + this.pageSize),
            ...Array(Math.max(0, this.pageSize - (this.lines.length - this.offset))).fill(''),
            `Context ${this.offset + 1}-${Math.min(this.offset + this.pageSize, this.lines.length)}/${this.lines.length} (PgUp/PgDn)`,
            ...this.choices.render(width), ...hints,
        ];
    }
    handleInput(data) {
        if (!this.available(this.dimensions().columns) || !this.painted || this.finished)
            return;
        // Discard bracketed paste, including split markers. No pasted key sequence activates a choice.
        const start = '\x1b[200~', end = '\x1b[201~';
        if ((this.pasting || this.pastePrefix) && getKeybindings().matches(data, 'tui.select.cancel')) {
            this.finish(undefined);
            return;
        }
        const input = this.pastePrefix + data;
        this.pastePrefix = '';
        if ((this.pasting && input.includes(start)) || input.indexOf(start) !== input.lastIndexOf(start)
            || (input.includes(end) && !this.pasting && !input.includes(start))) {
            this.finish(new AdoptionDecisionCaptureFailure('the selection dialog received malformed paste framing; no decision was captured'));
            return;
        }
        if (input.includes(start) || this.pasting) {
            this.pasting = !input.includes(end);
            return;
        }
        if (input.length > 1 && (start.startsWith(input) || end.startsWith(input))) {
            this.pastePrefix = input;
            return;
        }
        if (input.includes(end))
            return;
        if (matchesKey(input, Key.pageUp))
            this.offset = Math.max(0, this.offset - this.pageSize);
        else if (matchesKey(input, Key.pageDown))
            this.offset = Math.min(Math.max(0, this.lines.length - this.pageSize), this.offset + this.pageSize);
        else if (matchesKey(input, Key.home))
            this.offset = 0;
        else if (matchesKey(input, Key.end))
            this.offset = Math.max(0, this.lines.length - this.pageSize);
        else {
            const kb = getKeybindings();
            if (['tui.select.up', 'tui.select.down', 'tui.select.confirm', 'tui.select.cancel'].some(action => kb.matches(input, action))) {
                this.choices.handleInput(input);
            }
        }
        this.repaint();
    }
}
/** One fresh local capture. A malformed result is neither consent nor decline. */
export async function askAdoptionDecision(surface, options) {
    if (typeof surface?.custom !== 'function') {
        throw new AdoptionHostUiUnavailable(`this Pi UI provides no supported visible selection surface for the "${options.kind}" decision`);
    }
    let answer;
    try {
        answer = await surface.custom((tui, theme, _kb, done) => new AdoptionSelector(selectionPrompt(options.kind, options.prompt), () => tui.terminal, () => tui.requestRender(), done, (name, value) => theme.fg(name, value)), { overlay: true, overlayOptions: { width: '100%', maxHeight: '100%', margin: 1 } });
    }
    catch (error) {
        if (error instanceof AdoptionHostUiUnavailable || error instanceof AdoptionDecisionCaptureFailure)
            throw error;
        throw new AdoptionHostUiUnavailable(`the visible selection surface could not open for "${options.kind}"`);
    }
    if (answer instanceof AdoptionHostUiUnavailable || answer instanceof AdoptionDecisionCaptureFailure)
        throw answer;
    if (answer === undefined)
        return false;
    if (answer !== ACCEPT && answer !== DECLINE) {
        const printable = typeof answer === 'string' ? answer.replace(/[\x00-\x1f\x7f-\x9f]/g, '?').slice(0, 64) : `<${typeof answer}>`;
        throw new AdoptionDecisionCaptureFailure(`the selection dialog returned "${printable}", which is neither "Yes" nor "No"`);
    }
    return answer === ACCEPT;
}
export function adoptionInteraction(ui) {
    return { confirm: options => askAdoptionDecision(ui, options) };
}
//# sourceMappingURL=adoption-ui.js.map