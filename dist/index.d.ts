import { type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { CommandContext, Result } from './adoption.js';
export declare function resumeSessionDirectory(cwd: string, envSessionDir?: string | undefined, agentDir?: string): string | undefined;
/**
 * Reminder-only Orchestrator wake-up submission: one supported custom-message call with the full
 * reminder text in model-facing content, generic source/hash/attempt metadata, and triggerTurn. No
 * second submission, steering fallback or nextTurn follow-up exists, and an API return is not proof of
 * admission or model consumption; only the correlation scan can retire the attempt fence.
 */
export declare function wakeupSubmission(pi: Pick<ExtensionAPI, 'sendMessage'>, content: string, submission: {
    attemptId: string;
    source: 'builtin' | 'file';
    sha256: string;
}): void;
/**
 * Supported `pi.events` discovery channel for the role-local frontend. Versioned in the channel name.
 * The payload carries no identity, port, role, path, or confirmation: the offered closure is process-local
 * and is never serialized, so this bridge is neither an authorization token nor a security boundary.
 */
export declare const ADOPTION_CHANNEL = "intercom:coordinator-adoption:v1";
export declare const ADOPTION_PROTOCOL = 1;
export interface AdoptionOffer {
    protocol: number;
    run(context: CommandContext, verb: string, args?: string[]): Promise<Result>;
}
export interface AdoptionDiscovery {
    offers: AdoptionOffer[];
}
/** Narrow, non-throwing view of a foreign payload: only a known shape can receive an offer. */
export declare function adoptionDiscovery(value: unknown): AdoptionDiscovery | undefined;
export default function intercomExtension(pi: ExtensionAPI): void;
