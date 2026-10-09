import type { LaunchRequest } from './runtime.js';
export type Run = (file: string, args: string[]) => Promise<string>;
export declare const run: Run;
export declare const psQuote: (value: string) => string;
export declare const shQuote: (value: string) => string;
export declare const encoded: (script: string) => string;
export interface LauncherOptions {
    extension: string;
    platform?: string;
    env?: NodeJS.ProcessEnv;
    run?: Run;
    sessionExists(cwd: string, id: string): Promise<boolean>;
}
export declare function launchers(options: LauncherOptions): {
    launch: (request: LaunchRequest) => Promise<unknown>;
    syncName: (name: string) => Promise<void>;
};
