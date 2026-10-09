import { type Handoff, type CloseJob } from './handoff.js';
export interface Agent {
    sessionId: string;
    name: string;
    coordinator: boolean;
    description: string;
    port: number;
    /** Legacy browser dashboard field, accepted for migration only; removed at coordinator startup. */
    dashboardPort?: number;
    projectDirectory: string;
    /** Logical Pi role name. Absent when the worker uses the normal Pi launch. */
    role?: string;
    handoff?: Handoff;
    closeJob?: CloseJob;
}
export interface Config {
    version: 1;
    multiplexer: 'herdr' | 'none';
    agents: Agent[];
}
/** Logical role names only. Same alphabet as pi-role, bounded for Intercom storage. Callers cannot pass a path or shell fragment. */
export declare const ROLE_NAME: RegExp;
/** Names apply.sh refuses to install. They are not Pi roles. */
export declare const RESERVED_ROLES: Set<string>;
export declare function logicalRole(value: unknown): value is string;
/** Intercom metadata for the worker extension. It does not load the role. */
export declare const WORKER_ROLE_ENV = "PI_INTERCOM_WORKER_ROLE";
/** Optional executable used instead of `pi-role` on PATH. Not a role-to-directory map. */
export declare const ROLE_LAUNCHER_ENV = "PI_INTERCOM_ROLE_LAUNCHER";
export declare const DEFAULT_ROLE_LAUNCHER = "pi-role";
export declare const DEFAULT_DESCRIPTION = "Coordinate workers, delegate work, and manage shared configuration.";
export declare const key: (name: string) => string;
export declare function fail(message: string): never;
export declare function text(value: unknown, field: string, max?: number): asserts value is string;
export declare function port(value: unknown): asserts value is number;
export declare function relativeDirectory(value: unknown): asserts value is string;
export declare function validateConfig(value: unknown): Config;
export declare const coordinator: (c: Config) => Agent;
export declare function named(c: Config, name: string): Agent;
export declare function requireCoordinator(c: Config, id: string): Agent;
export declare function directory(root: string, requested: string): Promise<string>;
export interface ConfigStoreOptions {
    /** Publication seams for deterministic platform/race tests. */
    platform?: NodeJS.Platform;
    rename?: (from: string, to: string) => Promise<void>;
    delay?: (milliseconds: number) => Promise<void>;
    now?: () => number;
}
export declare class ConfigStore {
    readonly root: string;
    private readonly options;
    readonly file: string;
    private tail;
    constructor(root: string, options?: ConfigStoreOptions);
    read(): Promise<Config>;
    static discover(cwd: string): Promise<ConfigStore | undefined>;
    protected openTemporary(file: string): Promise<import("fs/promises").FileHandle>;
    private temporary;
    initialize(id: string, boundPort: number, assertValid?: () => void): Promise<boolean>;
    private publish;
    update(id: string, mutate: (config: Config) => void | Promise<void>, assertValid?: () => void): Promise<Config>;
    configure(id: string, values: Omit<Agent, 'coordinator'>, assertValid?: () => void): Promise<Config>;
}
