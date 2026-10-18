// Intended public host contract, offline. Loads extension factories ONLY (no session_start, model,
// auth, runtime endpoint, Pi workers, cancellation or installed resource mutation).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const npm = (args, options = {}) => process.env.npm_execpath
  ? execFileSync(process.execPath, [process.env.npm_execpath, ...args], options)
  : execFileSync('npm', args, options);
const hostRoot = process.env.PI_ADOPTION_HOST_ROOT ?? path.join(npm(['root', '-g'], { encoding: 'utf8' }).trim(), '@earendil-works/pi-coding-agent');

test('packed source loads against public Pi 1.2.0; actual SessionManager/custom-dir/event-bus APIs', async t => {
  const temp = await mkdtemp(path.join(tmpdir(), 'intercom-adoption-host-')); t.after(() => rm(temp, { recursive: true, force: true }));
  const manifest = JSON.parse(await readFile(path.join(hostRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.version, '1.2.0', 'intended host must be explicitly proved, never version-guessed');
  const prior = Object.fromEntries(['HOME', 'PI_CODING_AGENT_DIR', 'PI_OFFLINE'].map(key => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of Object.entries(prior)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  process.env.HOME = temp; process.env.PI_CODING_AGENT_DIR = path.join(temp, 'agent'); process.env.PI_OFFLINE = '1';
  const host = await import(pathToFileURL(path.join(hostRoot, 'dist/index.js')));
  const packed = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', temp], { cwd: root, encoding: 'utf8', env: { ...process.env, npm_config_offline: 'true', npm_config_update_notifier: 'false', npm_config_audit: 'false' } }));
  execFileSync('tar', ['-xzf', path.join(temp, packed[0].filename), '-C', temp]);
  const packageRoot = path.join(temp, 'package');
  // The same public-host fixture can be copied into an immutable baseline archive. Absence of a
  // not-yet-existing feature is then expected, not falsely attributed as a baseline host failure.
  const adoptionExpected = process.env.PI_ADOPTION_TEST_BASELINE !== '1';
  assert.equal(packed[0].files.some(file => file.path === 'src/adoption.ts'), adoptionExpected);
  assert.equal(packed[0].files.some(file => file.path === 'dist/adoption.js'), adoptionExpected);
  assert.ok(!packed[0].files.some(file => file.path.startsWith('tests/')));
  const bus = host.createEventBus(), payload = { offers: [] };
  const off = bus.on('fixture:discovery', value => value.offers.push({ protocol: 1 }));
  bus.emit('fixture:discovery', payload); assert.equal(payload.offers.length, 1, 'discovery is synchronous'); off();
  bus.emit('fixture:discovery', payload); assert.equal(payload.offers.length, 1, 'unsubscribe removes offer');
  const cwd = path.join(temp, 'projects'); await mkdir(cwd);
  const custom = path.join(temp, 'custom-session-dir');
  const manager = host.SessionManager.create(cwd, custom);
  manager.appendMessage({ role: 'user', content: 'fixture persistence, no model', timestamp: Date.now() });
  manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'fixture persisted response' }], api: 'openai-responses', provider: 'fixture', model: 'fixture', stopReason: 'stop', timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  assert.equal(manager.getSessionDir(), custom);
  const header = JSON.parse((await readFile(manager.getSessionFile(), 'utf8')).split('\n')[0]);
  assert.equal(header.id, manager.getSessionId());
  assert.ok((await host.SessionManager.list(cwd, manager.getSessionDir())).some(session => session.id === header.id && session.path === manager.getSessionFile()));
  const loader = new host.DefaultResourceLoader({ cwd, agentDir: path.join(temp, 'agent'), settingsManager: host.SettingsManager.inMemory({ packages: [], extensions: [] }),
    eventBus: bus, additionalExtensionPaths: [path.join(packageRoot, 'src/index.ts')], noContextFiles: true, noSkills: true, noPromptTemplates: true, noThemes: true });
  await loader.reload();
  const loaded = loader.getExtensions(); assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  assert.ok(loaded.extensions[0].tools.has('intercom_list'));
  assert.ok(!loaded.extensions[0].tools.has('intercom_adopt'), 'no model-callable adoption tool');
  assert.equal(loaded.extensions[0].commands.size, 0, 'global backend advertises no slash command');
  // Compile the entire shipped source against the intended host's exported public declarations.
  const config = path.join(temp, 'host-tsconfig.json');
  await writeFile(config, JSON.stringify({ extends: path.join(root, 'tsconfig.json'), compilerOptions: { noEmit: true, paths: { '@earendil-works/pi-coding-agent': [path.join(hostRoot, 'dist/index.d.ts')] } }, include: [path.join(root, 'src/**/*.ts')] }));
  execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', config], { cwd: root, encoding: 'utf8' });
  console.log(`HOST PROOF: Pi ${manifest.version}; Node ${process.version}; packed factory load, custom persisted session, synchronous bus/unsubscribe, full public-declaration typecheck; zero session_start/model/auth/ports`);
});
