// Offline D9 comparison of real exported runtimes. No installed board/auth/model/panes.
// Full: node tests/adoption-differential.mjs --baseline <archive> --original <archive> --output <jsonl>
// Each task is an independent process; variants are seeded/interleaved pairs inside that process.
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, appendFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const execute = promisify(cp.execFile), here = fileURLToPath(new URL('../', import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, item, i, all) => item.startsWith('--') ? [...pairs, [item.slice(2), all[i + 1]]] : pairs, []));
const samples = Number(args.samples ?? 100), runs = Number(args.runs ?? 5), warmup = Number(args.warmup ?? 5);
const quantile = (xs, q) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))] ?? 0;
const profiles = [{ workers: 2, history: 0, claims: 0 }, { workers: 16, history: 32, claims: 8 }, { workers: 64, history: 1024, claims: 32 }];
const modes = ['ordinary-nonrepo', 'ordinary-repo', 'declared', 'adopted'];
const operations = ['list', 'report', 'clear', 'status', 'registration', 'worker_status', 'worker_status_probe', 'worker_transmit', 'coordinator_send', 'message', 'sequential_load', 'overlap'];
const git = async (home, argv) => (await execute('git', argv, { cwd: home })).stdout;
async function history(home, count) {
  if (!count) return;
  const parent = (await git(home, ['rev-parse', 'HEAD'])).trim();
  let input = '';
  for (let n = 0; n < count; n++) input += `commit refs/heads/fixture-history\ncommitter Fixture <fixture@example.invalid> ${1700000000 + n} +0000\ndata 9\nunrelated\n${n ? '' : `from ${parent}\n`}\n`;
  await new Promise((resolve, reject) => {
    const child = cp.spawn('git', ['fast-import', '--quiet'], { cwd: home, stdio: ['pipe', 'ignore', 'pipe'] }); let error = '';
    child.stderr.on('data', data => { error += data; }); child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(Error(error))); child.stdin.end(input);
  });
  const tip = (await git(home, ['rev-parse', 'refs/heads/fixture-history'])).trim();
  await git(home, ['update-ref', 'HEAD', tip]); // empty commits: no index/worktree changes
}
async function childRun(task) {
  const { createFixture, commandContext, mockUi, configText, IDS } = await import('./fixtures/adoption-fixture.mjs');
  const labels = ['baseline-A', 'baseline-B', 'original', 'candidate'];
  const roots = [args.baseline, args.baseline, args.original, args.candidate ?? here].map(value => path.resolve(value));
  const fixtures = [];
  let seed = task.run * 101 + task.profile.workers;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  try {
    for (let v = 0; v < labels.length; v++) {
      const f = await createFixture(); fixtures.push(f); f.runtimes = [];
      const root = roots[v], { Intercom } = await import(pathToFileURL(path.join(root, 'dist/runtime.js')));
      const transport = await import(pathToFileURL(path.join(root, 'dist/transport.js')));
      const vacant = await transport.listen(0, async () => {}, () => ({ version: 1, sessionId: IDS.gone }));
      const oldPort = vacant.port; await vacant.close();
      const config = JSON.parse(configText('full', { coordinator: oldPort, workerOne: 10001, workerTwo: 10002 }));
      delete config.agents[2].closeJob;
      while (config.agents.length < task.profile.workers + 1) { const i = config.agents.length; config.agents.push({ ...config.agents[1], sessionId: `worker-${i}`, name: `Worker${i}`, port: 10000 + i }); }
      await f.board.write(JSON.stringify(config));
      const historical = await f.seeded(), historicalBefore = await historical.snapshot(); // identical seeded public evidence
      if (task.mode !== 'ordinary-nonrepo') await history(f.home, task.profile.history);
      else await rm(path.join(f.home, '.git'), { recursive: true, force: true });
      const optIn = v >= 2 && ['declared', 'adopted'].includes(task.mode), adopting = optIn && task.mode === 'adopted';
      const id = adopting ? IDS.fresh : IDS.gone, file = await f.session.persist(id);
      const messages = [], ui = mockUi({ boardInitialize: 'confirm', adoptionDecision: 'confirm', adoptTransition: 'confirm', authorityRecord: 'offline differential authorization', endedWording: `I confirm coordinator ${IDS.gone} ended`, finalizeTransition: 'confirm' });
      const context = commandContext(f, { sessionId: id, sessionFile: file, ui: ui.ui });
      const host = { cwd: f.home, sessionId: () => id, roleDirectory: path.join(f.home, 'roles', optIn ? 'orchestrator' : 'developer'), rolesDirectory: path.join(f.home, 'roles'), workerRole: '', busy: () => false, deliver: text => messages.push(text), notify() {}, setName: async () => {} };
      let reminderCallback;
      const options = { reminderClock: { schedule: callback => { reminderCallback = callback; return () => {}; } }, closeProvider: { getIdentity: async () => assert.fail('no pane'), inspect: async () => assert.fail('no pane'), close: async () => assert.fail('no pane') }, launch: async () => assert.fail('benchmark cannot launch'), listen: (_port, ...rest) => transport.listen(optIn && !adopting && _port === oldPort ? oldPort : 0, ...rest), ...(task.observer === 'noop' ? { observe: () => ({ record() {}, close() {}, maintain() {} }) } : {}), ...(optIn ? { adoption: { projectsHome: f.home, rolesDirectory: path.join(f.home, 'roles'), listSessions: async () => [{ id, path: file }] } } : {}) };
      const runtime = new Intercom(host, options); f.runtimes.push(runtime); await runtime.start();
      let adoptionMs, adoptionEndToEndMs, interruptedMs, recoveryMs, recoveryEndToEndMs;
      if (optIn) {
        if (args.recovery) {
          assert.equal(task.mode, 'adopted', '--recovery measures an interrupted adoption, not declaration');
          await writeFile(path.join(f.home, '.git/hooks/pre-commit'), '#!/bin/sh\nif grep -q \'"phase": "active"\' coordinator-claim.md; then exit 1; fi\n', { mode: 0o755 });
        }
        const start = performance.now(); let result = await runtime.adoptCoordinator(context, 'adopt'); adoptionMs = performance.now() - start;
        await runtime.observer?.pending; adoptionEndToEndMs = performance.now() - start;
        if (args.recovery) {
          assert.equal(result.code, 'GIT', result.lines.join('\n')); interruptedMs = adoptionMs; adoptionMs = undefined;
          await f.hooks.allow(); const recover = performance.now(); result = await runtime.adoptCoordinator(context, 'adopt'); recoveryMs = performance.now() - recover;
          await runtime.observer?.pending; recoveryEndToEndMs = performance.now() - recover;
          assert.equal(result.code, 'RECOVERED', result.lines.join('\n'));
        }
        assert.equal(result.ok, true, result.lines.join('\n'));
        const active = await f.claim.read();
        for (let n = 0; n < task.profile.claims; n++) { await f.claim.write(`fixture historical malformed record ${n}\n`); await f.claim.commit(); await f.claim.write(active); await f.claim.commit(); }
      }
      const worker = new Intercom({ ...host, sessionId: () => IDS.workerOne, roleDirectory: path.join(f.home, 'roles/developer') }, { ...options, adoption: undefined });
      f.runtimes.push(worker); await worker.start();
      await Promise.all(f.runtimes.map(r => r.observer?.pending));
      const envelope = (kind, payload, from = IDS.workerOne) => ({ version: 1, from, to: id, kind, payload });
      const work = {
        list: () => runtime.tool('list', {}),
        report: () => runtime.receive(envelope('report', { status: 'ready_for_review', summary: 'differential public report' })),
        clear: () => runtime.receive(envelope('report', { status: 'clear', summary: '' })),
        status: () => runtime.receive(envelope('status', { port: worker.endpoint.port, busy: false })),
        registration: () => runtime.receive(envelope('registration', { port: 11000, projectDirectory: 'app', role: 'developer' }, 'unconfigured-fixture')),
        worker_status: () => runtime.tool('worker_status', { name: 'Builder' }),
        worker_status_probe: () => runtime.tool('worker_status', { name: 'Builder', probe: true }),
        worker_transmit: () => worker.tool('report_work', { status: 'blocked', summary: 'real loopback transport report' }),
        coordinator_send: () => runtime.tool('send', { to: 'Builder', message: 'offline differential message' }),
        message: () => runtime.receive(envelope('message', { message: 'offline worker message' })),
        sequential_load: async () => { await work.report(); await runtime.receive(envelope('status', { port: config.agents[2].port, busy: false }, IDS.workerTwo)); },
        overlap: () => Promise.all([work.report(), work.status(), runtime.receive(envelope('report', { status: 'blocked', summary: 'overlapping second worker report' }, IDS.workerTwo)), runtime.receive(envelope('status', { port: config.agents[2].port, busy: false }, IDS.workerTwo))]),
      };
      // Functional-only lifecycle/reminder controls; hot-path timing remains separate.
      work.reminder_trace = async () => {
        const before = messages.length; runtime.reminders.arm(); reminderCallback();
        while (runtime.reminders.checking) await new Promise(resolve => setImmediate(resolve));
        runtime.reminders.stop(); return { deliveries: messages.length - before };
      };
      work.handoff_trace = async () => {
        runtime.handoff.background = () => {}; // synthetic workflow, no process/pane/transport lifecycle
        const job = (await runtime.tool('close_worker', { to: 'Builder' })).job, pending = runtime.handoff.jobs.get(IDS.workerOne);
        await runtime.handoff.transition(pending, 'awaiting_handoff'); pending.instanceId = 'fixture-instance';
        await runtime.handoff.receive('handoff_report', IDS.workerOne, { jobId: job.jobId, instanceId: pending.instanceId, summary: 'functional public handoff' });
        const state = pending.job.state; await runtime.handoff.finish(pending, 'failed', 'close_failed');
        return { state, retainedJobs: runtime.handoff.jobs.size, summary: (await runtime.store.read()).agents[1].handoff.summary };
      };
      fixtures[v] = Object.assign(f, { label: labels[v], runtime, worker, work, messages, adoptionMs, adoptionEndToEndMs, interruptedMs, recoveryMs, recoveryEndToEndMs, historical, historicalBefore });
    }
    // Supported ordinary functional trace through each real runtime, including real HTTP sends.
    // --cold-only omits this warm trace; the normal full run asserts the complete common trace.
    let functionalTraceSha256;
    if (!args['cold-only']) {
    // Compare actual results/messages/raw config/seeded bytes, not success labels.
    const normalize = (value, home) => JSON.stringify(value, (key, item) => {
      if (['observationAgeSeconds', 'ageSeconds'].includes(key)) return item === null ? null : '<age>';
      if (key === 'port' && typeof item === 'number') return '<port>';
      return typeof item !== 'string' ? item : item.replaceAll(home, '<root>')
        .replaceAll(IDS.gone, '<coordinator>').replaceAll(IDS.fresh, '<coordinator>')
        .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, '<time>')
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
        .replace(/("port"\s*:\s*)\d+/g, '$1<port>');
    });
    const traces = [];
    for (const f of fixtures) {
      const trace = [];
      for (const operation of [...operations.filter(name => name !== 'overlap'), 'reminder_trace', 'handoff_trace']) {
        const result = await f.work[operation]();
        if (operation === 'list') assert.equal(result.agents.length, task.profile.workers + 1);
        if (operation.startsWith('worker_status')) assert.equal(result.workers.length, 1);
        trace.push([operation, result === undefined ? 'void' : result]);
      }
      const { readWorkerReports } = await import(pathToFileURL(path.join(args.candidate ?? here, 'dist/reports.js')));
      const report = (await readWorkerReports(f.home, [IDS.workerOne]))[0];
      const after = await f.historical.snapshot(), preserved = {};
      for (const group of ['logs', 'reports', 'oldSessions']) preserved[group] = Object.fromEntries(Object.keys(f.historicalBefore[group]).map(name => [name, after[group][name]]));
      preserved.keep = after.keep;
      assert.deepEqual(preserved, f.historicalBefore, 'existing historical bytes untouched on common ordinary paths');
      trace.push(['report', report], ['registration-role', [...f.runtime.registeredRoles]], ['messages', f.messages], ['raw-config', await f.board.read()], ['historical', preserved]);
      traces.push(normalize(trace, f.home));
    }
    for (const trace of traces.slice(1)) assert.equal(trace, traces[0], 'only root/session/UUID/port/time normalization is permitted');
    functionalTraceSha256 = createHash('sha256').update(traces[0]).digest('hex');
    }
    if (args.damage) {
      assert.equal(task.mode, 'adopted', '--damage is an adoption-only negative, never a baseline equivalence claim');
      for (const f of fixtures.slice(2)) {
        f.beforeDamage = { config: await f.board.read(), messages: f.messages.length, reports: (await f.historical.snapshot()).reports };
        if (args.damage === 'missing') await rm(f.claimPath());
        else { const raw = await f.claim.read(); await f.claim.write('fixture newer malformed evidence\n'); await f.claim.commit(); await f.claim.write(raw); }
      }
    }
    let metric, attributionSpan, spanStart, spanPending = false;
    for (const f of fixtures) for (const runtime of f.runtimes) for (const [target, name] of [[runtime, 'assertActionReady'], [runtime.store, 'publicationGuard']]) {
      if (typeof target?.[name] !== 'function') continue;
      const original = target[name];
      target[name] = function(...argv) { const at = performance.now(); try { return original.apply(this, argv); } finally { if (metric) metric.maxGuardSpan = Math.max(metric.maxGuardSpan ?? 0, performance.now() - at); } };
    }
    const spawnSync = cp.spawnSync, spawn = cp.spawn;
    cp.spawnSync = function (...argv) {
      const at = performance.now(); const result = spawnSync.apply(this, argv);
      if (metric && argv[0] === 'git') {
        metric.syncCount++; metric.syncMs += performance.now() - at;
        if (metric.attribution) metric.attribution[attributionSpan ?? 'other']++;
        if (!spanPending) { spanStart = at; spanPending = true; queueMicrotask(() => { spanPending = false; }); }
        metric.maxSyncSpan = Math.max(metric.maxSyncSpan, performance.now() - spanStart);
      }
      return result;
    };
    cp.spawn = function (...argv) {
      const at = performance.now(), captured = metric, child = spawn.apply(this, argv);
      if (captured && argv[0] === 'git') { captured.asyncCount++; child.once('close', () => { captured.asyncMs += performance.now() - at; }); }
      return child;
    };
    syncBuiltinESMExports();
    const rows = fixtures.map(f => ({ label: f.label, adoptionMs: f.adoptionMs, adoptionEndToEndMs: f.adoptionEndToEndMs, interruptedMs: f.interruptedMs, recoveryMs: f.recoveryMs, recoveryEndToEndMs: f.recoveryEndToEndMs, operations: {} }));
    if (args['handoff-counts']) for (let v = 0; v < fixtures.length; v++) {
      const f = fixtures[v], h = f.runtime.handoff, originalUpdate = h.ctx.update; h.background = () => {};
      const label = (span, run) => { const prior = attributionSpan; attributionSpan = span; try { return run(); } finally { attributionSpan = prior; } };
      h.ctx.update = (mutate, guard) => originalUpdate(config => label('mutation', () => mutate(config)), guard ? () => label('caller', guard) : undefined);
      try {
        rows[v].handoffDiagnostics = [];
        for (const operation of ['request', 'transition', 'report']) {
          let pending;
          if (operation !== 'request') { await f.runtime.tool('close_worker', { to: 'Builder' }); pending = h.jobs.get(IDS.workerOne); }
          if (operation === 'report') { await h.transition(pending, 'awaiting_handoff'); pending.instanceId = 'fixture-instance'; }
          const m = { syncCount: 0, syncMs: 0, asyncCount: 0, asyncMs: 0, maxSyncSpan: 0, attribution: { caller: 0, mutation: 0, other: 0 } }; metric = m; const at = performance.now();
          if (operation === 'request') await f.runtime.tool('close_worker', { to: 'Builder' });
          if (operation === 'transition') await h.transition(pending, 'awaiting_handoff');
          if (operation === 'report') await h.receive('handoff_report', IDS.workerOne, { jobId: pending.job.jobId, instanceId: pending.instanceId, summary: 'functional public handoff' });
          metric = undefined; rows[v].handoffDiagnostics.push({ operation, ...m, callMs: performance.now() - at });
          await h.finish(h.jobs.get(IDS.workerOne), 'failed', 'close_failed');
        }
      } finally { metric = undefined; h.ctx.update = originalUpdate; }
    }
    for (const operation of operations.filter(name => !args.operations || args.operations.split(',').includes(name))) {
      for (let n = -warmup - 1; n < samples; n++) {
        const order = [0, 1, 2, 3].map(v => [random(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);
        for (const v of order) {
          const f = fixtures[v], row = rows[v].operations[operation] ??= { cold: null, samples: [], heartbeats: [], betweenCallCommits: [] };
          if (args.churn && task.mode !== 'ordinary-nonrepo' && n >= 0 && n % 10 === 0) {
            const at = performance.now(); await git(f.home, ['commit', '--allow-empty', '-qm', 'fixture unrelated between calls']);
            row.betweenCallCommits.push([n, performance.now() - at]);
          }
          const m = { syncCount: 0, syncMs: 0, asyncCount: 0, asyncMs: 0, maxSyncSpan: 0 }; metric = m;
          let last = performance.now(), delays = [], refused = null;
          const beat = setInterval(() => { const now = performance.now(); delays.push(Math.max(0, now - last - 1)); last = now; }, 1);
          const start = performance.now();
          try { await f.work[operation](); } catch (error) { refused = String(error); }
          const callMs = performance.now() - start;
          await Promise.all(f.runtimes.map(r => r.observer?.pending));
          const endToEndMs = performance.now() - start;
          await new Promise(resolve => setTimeout(resolve, 2)); clearInterval(beat); metric = undefined;
          const value = [callMs, endToEndMs, m.syncCount, m.syncMs, m.asyncCount, m.asyncMs, m.maxSyncSpan, quantile(delays, .95), Math.max(0, ...delays), refused, m.maxGuardSpan ?? 0];
          if (n === -warmup - 1) row.cold = value;
          if (n >= 0) { row.samples.push(value); row.heartbeats.push(...delays); }
          if (refused && !(args.damage && v >= 2)) throw Error(`${f.label}/${operation}: ${refused}`);
          if (!refused && args.damage && v >= 2) throw Error(`${f.label}/${operation} unexpectedly admitted damaged evidence`);
        }
      }
    }
    cp.spawn = spawn; cp.spawnSync = spawnSync; syncBuiltinESMExports();
    if (args.damage) for (const f of fixtures.slice(2)) {
      assert.equal(await f.board.read(), f.beforeDamage.config); assert.equal(f.messages.length, f.beforeDamage.messages);
      assert.deepEqual((await f.historical.snapshot()).reports, f.beforeDamage.reports, 'refusal never saves/clears report');
    }
    const alternatives = {};
    if (args.alternatives) {
      const f = fixtures[3];
      const measure = async operation => { const values = []; for (let n = -warmup; n < samples; n++) { const at = performance.now(); await operation(); if (n >= 0) values.push(performance.now() - at); } return values; };
      if (task.mode === 'adopted') {
        const originalGuard = f.runtime.assertActionReady.bind(f.runtime), activeBytes = await f.claim.read();
        await f.claim.write('fixture intervening malformed commit\n'); await f.claim.commit();
        await f.claim.write(activeBytes); await f.claim.commit();
        const anchor = (await f.claim.log())[0]; // valid newest restoration; latest log need not read old intent
        alternatives.fullActualListMs = await measure(f.work.list);
        f.runtime.assertActionReady = epoch => f.runtime.assertActionEpoch(epoch);
        alternatives.UNSAFE_epochOnlyActualListMs = await measure(f.work.list);
        f.runtime.assertActionReady = epoch => {
          f.runtime.assertActionEpoch(epoch);
          const result = cp.spawnSync('git', ['log', '--format=%H', '-n', '1', '--', 'coordinator-claim.md'], { cwd: f.home, encoding: 'utf8' });
          assert.equal(result.status, 0); assert.equal(result.stdout.trim(), anchor);
        };
        alternatives.UNSAFE_latestOnlyActualListMs = await measure(f.work.list);
        const record = JSON.parse((await f.claim.read()).split('```json\n')[1].split('\n```')[0]);
        await rm(path.join(f.home, '.git/objects', record.intentCommit.slice(0, 2), record.intentCommit.slice(2)));
        await f.work.list(); alternatives.UNSAFE_latestOnlyAdmitsMissingIntent = true;
        f.runtime.assertActionReady = originalGuard;
        await assert.rejects(f.work.list(), /ADOPTION_NOT_READY/);
      } else if (task.mode === 'ordinary-nonrepo') {
        alternatives.fullActualStatusMs = await measure(f.work.status);
        const { ConfigStore } = await import(pathToFileURL(path.join(args.baseline, 'dist/config.js')));
        const saved = f.runtime.store;
        f.runtime.store = new ConfigStore(f.home);
        alternatives.UNSAFE_baselineStoreActualStatusMs = await measure(f.work.status);
        f.runtime.store = saved;
        alternatives.note = 'Baseline store ablation removes cooperating-process exclusion/authority protection; not a shippable alternative.';
      }
    }
    return { task, alternatives, requestUnits: { sequential_load: 2, overlap: 4 }, functionalTraceSha256, functional: args['cold-only'] ? 'cold-only; common trace asserted in full warm run' : 'equivalent normalized common trace', columns: ['callMs', 'endToEndMs', 'syncGitCount', 'syncGitMs', 'asyncGitCount', 'asyncGitMs', 'maxSyncGitSpanMs', 'heartbeatP95Ms', 'heartbeatMaxMs', 'refusal', 'maxSyncGuardSpanMs'], rows };
  } finally { for (const f of fixtures) { for (const runtime of f.runtimes) await runtime.close(); await f.dispose(); await rm(f.home, { recursive: true, force: true }); } }
}
if (args.task) {
  console.log(JSON.stringify(await childRun(JSON.parse(args.task))));
} else {
  assert.ok(args.baseline && args.original && args.output, '--baseline, --original, --output required; roots must be disposable git archives with existing isolated dependencies');
  const output = path.resolve(args.output); await mkdir(path.dirname(output), { recursive: true });
  const sourceFiles = ['src/adoption.ts', 'src/config.ts', 'src/runtime.ts', 'src/handoff.ts', 'src/reports.ts', 'src/observability.ts', 'dist/adoption.js', 'dist/config.js', 'dist/runtime.js', 'dist/handoff.js', 'dist/reports.js', 'dist/observability.js', 'tests/adoption-differential.mjs', 'tests/fixtures/adoption-fixture.mjs', 'tests/fixtures/adoption-support.mjs'];
  const candidateSha256 = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, createHash('sha256').update(await readFile(path.join(args.candidate ?? here, file))).digest('hex')])));
  const expected = { baseline: 'e5b817a7b309dd28c2b56efc25506aa431fc0e68', original: 'f04c1f42bbc4359aa0ad7d2c39c60f9cd29cdb10' };
  const referenceDistSha256 = {};
  for (const [name, sha] of Object.entries(expected)) {
    referenceDistSha256[name] = {};
    const files = (await execute('git', ['ls-tree', '-r', '--name-only', sha, '--', 'dist'], { cwd: here })).stdout.trim().split('\n');
    for (const file of files) {
      const exported = await readFile(path.join(args[name], file));
      const actual = (await execute('git', ['show', `${sha}:${file}`], { cwd: here, encoding: 'buffer' })).stdout;
      assert.deepEqual(exported, actual, `${name}/${file} must be actual immutable committed dist`);
      referenceDistSha256[name][file] = createHash('sha256').update(actual).digest('hex');
    }
  }
  const cpuAffinity = (await readFile('/proc/self/status', 'utf8')).split('\n').find(line => line.startsWith('Cpus_allowed_list:'))?.split(':')[1].trim();
  const metadata = { kind: 'metadata', cpuAffinity, measurementPrecision: 'raw performance.now() milliseconds; throughput uses completed request units / measured active batch wall time, excluding inter-pair heartbeat padding and fixture work', started: new Date().toISOString(), node: process.version, os: [os.type(), os.release(), os.arch()], git: (await execute('git', ['--version'])).stdout.trim(), filesystem: (await execute('stat', ['-f', '-c', '%T', here])).stdout.trim(), roots: { baseline: args.baseline, original: args.original, candidate: args.candidate ?? here }, candidateHead: args.candidate ? null : (await execute('git', ['rev-parse', 'HEAD'], { cwd: here })).stdout.trim(), candidateSha256, referenceDistSha256, expected, samples, runs, warmup, churn: args.churn ? 'unrelated commit outside timed call every tenth warm sample; costs/indices retained' : false, damage: args.damage ?? null, recovery: !!args.recovery, handoffCounts: !!args['handoff-counts'], seed: 'run*101+workers; LCG1664525/1013904223', note: `${args['cold-only'] ? 'Fresh fixture process; first measured access per operation after startup (and any earlier operations in this task)' : 'Warm run; first measured samples follow the functional trace'}, NOT OS page-cache cold. Default observer actual append+flush included separately from handler wall time. Baseline does not implement claim safety.` };
  await writeFile(output, JSON.stringify(metadata) + '\n');
  for (let run = 0; run < runs; run++) for (const profile of profiles.filter(p => !args.workers || args.workers.split(',').map(Number).includes(p.workers))) for (const observer of ['noop', 'default'].filter(v => !args.observer || args.observer === v)) for (const mode of modes.filter(v => !args.modes || args.modes.split(',').includes(v))) {
    const task = { run, profile, observer, mode };
    const argv = [fileURLToPath(import.meta.url), ...process.argv.slice(2), '--task', JSON.stringify(task)];
    const { stdout } = await execute(process.execPath, argv, { maxBuffer: 32 * 1024 * 1024, env: { ...process.env, PI_ROLE_DIR: '', PI_INTERCOM_WORKER_ROLE: '' } });
    const result = JSON.parse(stdout.trim()); await appendFile(output, JSON.stringify(result) + '\n');
    console.error(JSON.stringify({ completed: task, candidate: Object.fromEntries(Object.entries(result.rows[3].operations).map(([op, row]) => [op, { median: row.samples.length ? quantile(row.samples.map(s => s[0]), .5) : null, p95: row.samples.length ? quantile(row.samples.map(s => s[0]), .95) : null, firstMeasured: row.cold?.[0], sync: (row.samples[0] ?? row.cold)?.[2], async: (row.samples[0] ?? row.cold)?.[4] }])) }));
  }
  console.error(`Raw durable evidence: ${output}`);
}
