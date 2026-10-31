import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_ROLE_LAUNCHER, ROLE_LAUNCHER_ENV, WORKER_ROLE_ENV, fail, logicalRole } from './config.js';
export const run = async (file, args) => {
    const { stdout } = await promisify(execFile)(file, args, { windowsHide: true, timeout: 40000, maxBuffer: 1024 * 1024 });
    return stdout;
};
export const psQuote = (value) => `'${value.replaceAll("'", "''")}'`;
export const shQuote = (value) => `'${value.replaceAll("'", "'\"'\"'")}'`;
export const encoded = (script) => Buffer.from(script, 'utf16le').toString('base64');
function roleLauncher(env) {
    const configured = env[ROLE_LAUNCHER_ENV];
    const launcher = configured === undefined || configured === '' ? DEFAULT_ROLE_LAUNCHER : configured;
    if (launcher !== launcher.trim() || /[\u0000-\u001f\u007f]/.test(launcher))
        fail(`invalid ${ROLE_LAUNCHER_ENV}`);
    return launcher;
}
/**
 * Ask the launcher if this role can start, then require the role's own pi-intercom copy at
 * `<printed role dir>/extensions/pi-intercom`. A role launch loads that copy and gets no `-e`,
 * so a role without one is refused instead of silently falling back to the coordinator's copy.
 */
async function preflightRole(exec, launcher, role) {
    let found = '';
    try {
        found = (await exec('sh', ['-c', 'command -v "$1"', 'pi-intercom-role', launcher])).trim();
    }
    catch (error) {
        fail(`role launcher not found: ${launcher}. No worker was launched. (${String(error)})`);
    }
    if (!found)
        fail(`role launcher not found: ${launcher}. No worker was launched.`);
    let roleDir = '';
    try {
        roleDir = (await exec(launcher, ['--print', role])).trim();
    }
    catch (error) {
        fail(`role ${role} is not available from ${launcher} --print. No worker was launched. (${String(error)})`);
    }
    const copy = roleDir && path.posix.isAbsolute(roleDir) ? path.posix.join(roleDir, 'extensions', 'pi-intercom') : '';
    const present = copy ? await stat(copy).then(s => s.isDirectory(), () => false) : false;
    if (!present)
        fail(`role ${role} has no pi-intercom copy at ${copy || `<${launcher} --print ${role}>/extensions/pi-intercom`}; role workers load their own copy and are not given -e. No worker was launched.`);
}
/** Role-less invocation stays `exec pi`. A role wraps that same argument list with `pi-role` and does not set PI_CODING_AGENT_DIR. */
function linuxPiInvocation(request, args, env) {
    const piArgs = args.map(shQuote).join(' ');
    if (!request.role)
        return `exec pi ${piArgs}`;
    return `${WORKER_ROLE_ENV}=${shQuote(request.role)} exec ${shQuote(roleLauncher(env))} ${shQuote(request.role)} ${piArgs}`;
}
export function launchers(options) {
    const exec = options.run ?? run, env = options.env ?? process.env;
    async function launch(request) {
        const platform = options.platform ?? process.platform;
        if (platform !== 'win32' && platform !== 'linux')
            fail('launchers support Windows and Linux only');
        const paths = platform === 'win32' ? path.win32 : path.posix;
        if (typeof request.workspaceRoot !== 'string' || !request.workspaceRoot.trim() || request.workspaceRoot.includes('\0') || !paths.isAbsolute(request.workspaceRoot))
            fail('worker launch requires an explicit absolute workspace root');
        // Lexical containment only: this defends direct launcher calls without filesystem access or cwd
        // rewrites, and being lexical it cannot see symlinks. It is not the symlink defense. The authoritative
        // admission is filesystem-bound: `directory()` and `ConfigStore.workspace()` realpath both the root and
        // the target before anything is read or written, and ConfigStore re-pins that canonical root on every
        // later access. A link swapped in after this check is that boundary's refusal, not this one's.
        const samePath = (value) => platform === 'win32' ? paths.resolve(value).toLowerCase() : paths.resolve(value);
        if (typeof request.cwd !== 'string' || !paths.isAbsolute(request.cwd))
            fail('worker launch requires an absolute working directory');
        const relative = paths.relative(samePath(request.workspaceRoot), samePath(request.cwd));
        if (relative === '..' || relative.startsWith(`..${paths.sep}`) || paths.isAbsolute(relative))
            fail('worker workspace root must be its working directory or one of its ancestors; unrelated workspace access is not allowed');
        if (request.role !== undefined) {
            if (!logicalRole(request.role))
                fail('invalid role');
            if (platform === 'win32')
                fail('Role-aware worker launch is not supported on Windows. No worker was launched.');
        }
        if (platform === 'linux' && request.multiplexer === 'none')
            fail('Linux worker launching requires Herdr; none is Windows-only. No terminal fallback');
        if (request.sessionId && !await options.sessionExists(request.cwd, request.sessionId))
            fail('saved Pi session not found in project directory; never-used sessions may not be persisted. Config unchanged; no replacement launched');
        // Explicit per-child CLI scope cannot widen cwd or leak from a parent shell environment.
        // A role worker loads its own pi-intercom copy (checked in preflightRole); adding -e would load it twice.
        const args = [...(request.role ? [] : ['-e', options.extension]), '--intercom-root', request.workspaceRoot, ...(request.sessionId ? ['--session', request.sessionId] : [])];
        if (request.multiplexer === 'herdr') {
            if (env.HERDR_ENV !== '1' || !env.HERDR_WORKSPACE_ID)
                fail('Herdr launcher requires this Pi to run inside a Herdr-managed workspace; no fallback');
            if (request.role)
                await preflightRole(exec, roleLauncher(env), request.role);
            let created;
            try {
                created = JSON.parse(await exec('herdr', ['tab', 'create', '--workspace', env.HERDR_WORKSPACE_ID, '--cwd', request.cwd, '--label', 'Intercom (anonymous)', '--no-focus']));
            }
            catch (e) {
                fail(`Herdr tab launch failed: ${String(e)}; no fallback or cleanup`);
            }
            const pane = created.result?.root_pane?.pane_id, tab = created.result?.tab?.tab_id;
            if (!pane || !tab)
                fail('Herdr creation response missing returned pane/tab IDs; no guessed targeting or cleanup');
            // Herdr's Windows agent-start wrapper uses Start-Process on `pi`, which
            // can resolve to a PowerShell shim and fail with invalid Win32 application.
            // Run an explicit PowerShell command in the returned shell pane instead.
            // This acknowledges command submission only, not Pi readiness/registration.
            const script = `$ErrorActionPreference='Stop'; Set-Location -LiteralPath ${psQuote(request.cwd)}; & (Get-Command pi.ps1 -ErrorAction Stop).Source ${args.map(psQuote).join(' ')}; if ($LASTEXITCODE -ne 0) { Write-Error ('Pi exited with code ' + $LASTEXITCODE) }`;
            const command = platform === 'win32'
                ? `powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded(script)}`
                : `sh -c ${shQuote(`cd ${shQuote(request.cwd)} && ${linuxPiInvocation(request, args, env)}`)}`;
            try {
                await exec('herdr', ['pane', 'run', pane, command]);
            }
            catch (e) {
                fail(`Herdr Pi command submission failed in tab ${tab}, pane ${pane}: ${String(e)}. Tab/process may remain; no automatic cleanup/retry/replacement`);
            }
            return { commandSubmitted: true, tab, pane, piReadiness: 'not observed; inspect pane for startup failures', registrationAwaited: false };
        }
        if (request.multiplexer !== 'none')
            fail('unsupported multiplexer');
        // Use encoded PowerShell rather than constructing cmd.exe command strings.
        // The outer process reports only successful visible terminal creation, not Pi readiness.
        const child = `$ErrorActionPreference='Stop'; Get-ChildItem Env: | Where-Object { $_.Name -like 'HERDR_*' -or $_.Name -like 'PI_SESSION_*' } | ForEach-Object { Remove-Item ('Env:' + $_.Name) }; Set-Location -LiteralPath ${psQuote(request.cwd)}; & (Get-Command pi.cmd -ErrorAction Stop).Source ${args.map(psQuote).join(' ')}; if ($LASTEXITCODE -ne 0) { Write-Error ('Pi exited with code ' + $LASTEXITCODE) }`;
        const outer = `$ErrorActionPreference='Stop'; $null=Get-Command pi.cmd -ErrorAction Stop; $p=Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -WorkingDirectory ${psQuote(request.cwd)} -ArgumentList @('-NoProfile','-NoExit','-EncodedCommand',${psQuote(encoded(child))}) -WindowStyle Normal -PassThru; $p.Id`;
        const result = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded(outer)]);
        const pid = Number(result.trim());
        if (!Number.isInteger(pid) || pid <= 0)
            fail('visible terminal launch returned no process ID; outcome unknown');
        return { terminalLaunched: true, pid, piReadiness: 'not observed; inspect visible terminal for startup failures', registrationAwaited: false };
    }
    async function syncName(name) {
        if (env.HERDR_ENV !== '1')
            return;
        // Resolve inherited pane context, including panes moved since launch.
        if (!env.HERDR_PANE_ID)
            fail('Herdr tab name sync requires caller pane identity');
        const data = JSON.parse(await exec('herdr', ['pane', 'current', '--current']));
        const tab = data.result?.pane?.tab_id;
        if (typeof tab !== 'string')
            fail('Herdr current-pane response missing tab_id; tab name not synchronized');
        await exec('herdr', ['tab', 'rename', tab, name]);
    }
    return { launch, syncName };
}
//# sourceMappingURL=launcher.js.map