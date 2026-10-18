import type { CURSOR_MARKER, Key, matchesKey, sliceByColumn, visibleWidth, wrapTextWithAnsi } from 'pi-intercom-tui';
import type { ExtensionUIContext, Theme } from '@earendil-works/pi-coding-agent';
/**
 * The host surface this dialog actually uses, declared structurally instead of importing one pinned
 * `TUI`/`Component` type. The host and this package can resolve different `pi-tui` versions, and a dialog
 * that asked for anything beyond a size, a repaint request, and Pi's own focus flag would fail to compile
 * — or worse, assume methods the host never promised — over a difference that has nothing to do with
 * adoption. Fewer requirements mean any host TUI that can render text can host this question.
 */
export interface AdoptionDialogTui {
    readonly terminal: {
        readonly columns: number;
        readonly rows: number;
    };
    requestRender(): void;
}
/** The render contract of a custom screen, again structural: Pi calls these two members and nothing else. */
export interface AdoptionDialogComponent {
    render(width: number): string[];
    invalidate(): void;
}
type TuiPrimitives = {
    CURSOR_MARKER: typeof CURSOR_MARKER;
    Key: typeof Key;
    matchesKey: typeof matchesKey;
    sliceByColumn: typeof sliceByColumn;
    visibleWidth: typeof visibleWidth;
    wrapTextWithAnsi: typeof wrapTextWithAnsi;
};
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
export declare const PASTE_START = "\u001B[200~";
export declare const PASTE_END = "\u001B[201~";
/** Below this, instructions and answer controls cannot both be shown, so the dialog is not opened. */
export declare const MINIMUM_WIDTH = 20;
export declare const MINIMUM_HEIGHT = 7;
/** Render control characters visibly. Display only: the compared answer never changes. */
export declare function escapeControlCharacters(value: string): string;
/** One settle, always. `value` is the raw answer; `cancelled` a dismissal; `captureFailure` malformed framing. */
export interface DialogSettlement<T> {
    value?: T;
    cancelled?: boolean;
    captureFailure?: string;
    hostFailure?: string;
}
/**
 * The raw-preserving answer buffer plus a bounded, paged prompt viewport.
 *
 * `handleInput` is the whole input path: a complete paste frame stores its payload unchanged, markers
 * split across chunks are reassembled, and incomplete, nested, or unexpected-end framing fails closed
 * instead of producing a candidate answer. Payload characters are data: they can never submit, cancel,
 * or move anything.
 */
export declare class AdoptionDialog<T extends string | boolean> implements AdoptionDialogComponent {
    private readonly tui;
    private readonly theme;
    private readonly kind;
    private readonly prompt;
    private readonly mode;
    private readonly settle;
    private readonly draw;
    private readonly pasteTimeoutMs;
    private answer;
    private cursor;
    private selection;
    private pasting;
    private paste;
    private pending;
    /** True while a held-over chunk still has to complete the opening paste delimiter. */
    private awaitingStart;
    private scroll;
    private settled;
    private timer;
    private body;
    /** Set by Pi's TUI when this screen gains or loses focus; drives the visible cursor marker. */
    focused: boolean;
    constructor(tui: AdoptionDialogTui, theme: Theme, kind: string, prompt: string, mode: 'input' | 'confirm', settle: (settlement: DialogSettlement<T>) => void, draw: TuiPrimitives, pasteTimeoutMs?: number);
    invalidate(): void;
    handleInput(data: string): void;
    /** A frame opened across chunks: a later chunk closes it, contains another start marker, or is payload. */
    private continuePaste;
    /**
     * An unfinished frame is never a candidate answer. Pi's framer completes frames itself, so this timer
     * only fires for a host that streams paste bytes; when it fires, the partial payload is discarded and
     * the step fails visibly instead of waiting forever or submitting an incomplete answer.
     */
    private beginPaste;
    /** A chunk outside paste framing is one or more complete key events. */
    private dispatch;
    private key;
    private characters;
    private insert;
    private fail;
    private settleOnce;
    /** Pi disposes the component when the interaction ends: nothing is retained for a later invocation. */
    dispose(): void;
    private viewport;
    render(width: number): string[];
    private answerLine;
    private confirmation;
    private paint;
}
/** The length of the longest suffix of `value` that is a proper prefix of `marker` (a split delimiter). */
export declare function partialMarker(value: string, marker: string): number;
/**
 * Route the domain's `ui.input`/`ui.confirm` contract through the visible dialog. Every answer still
 * reaches the domain unchanged; a missing or failing host surface is a named `HOST` failure instead of
 * an invisible question. There is no placeholder-only fallback path.
 */
export declare function adoptionInteraction(ui: ExtensionUIContext | undefined): {
    input(options: {
        kind: string;
        prompt: string;
    }): Promise<string | undefined>;
    confirm(options: {
        kind: string;
        prompt: string;
    }): Promise<boolean>;
};
export {};
