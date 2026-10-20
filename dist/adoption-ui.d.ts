import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import { AdoptionDecisionCaptureFailure, AdoptionHostUiUnavailable } from './adoption.js';
export declare const DECLINE = "No";
export declare const ACCEPT = "Yes";
export declare const CHOICES: readonly ["No", "Yes"];
export declare const DIALOG_TITLE = "Intercom coordinator adoption";
/** Display transform only: paths/identities cannot execute terminal instructions. */
export declare function escapeControlCharacters(value: string): string;
export declare function selectionPrompt(kind: string, prompt: string): string;
export type AdoptionSelectionSurface = Pick<ExtensionUIContext, 'custom'>;
type Capture = string | undefined | AdoptionHostUiUnavailable | AdoptionDecisionCaptureFailure;
type Dimensions = {
    columns: number;
    rows: number;
};
/**
 * Supported visible workaround for the native selector's unbounded title. ui.custom overlays are a
 * public host API; SelectList is the same selection control class used by the native selector. The
 * question has a bounded, explicitly paged viewport, not an input field or inferred terminal scrollback.
 * Choices remain visible while every question line is retrievable with PgUp/PgDn (Home/End too).
 * There is only one answer callback, no read/continue acknowledgment and no text-answer channel.
 */
export declare class AdoptionSelector {
    readonly question: string;
    private readonly dimensions;
    private readonly repaint;
    private readonly done;
    private readonly choices;
    private offset;
    private lines;
    private pageSize;
    private painted;
    private finished;
    private pasting;
    private pastePrefix;
    constructor(question: string, dimensions: () => Dimensions, repaint: () => void, done: (answer: Capture) => void, color?: (name: 'accent' | 'muted', value: string) => string);
    private finish;
    private available;
    invalidate(): void;
    render(width: number): string[];
    handleInput(data: string): void;
}
/** One fresh local capture. A malformed result is neither consent nor decline. */
export declare function askAdoptionDecision(surface: AdoptionSelectionSurface | undefined, options: {
    kind: string;
    prompt: string;
}): Promise<boolean>;
export declare function adoptionInteraction(ui: AdoptionSelectionSurface | undefined): {
    confirm(options: {
        kind: string;
        prompt: string;
    }): Promise<boolean>;
};
export {};
