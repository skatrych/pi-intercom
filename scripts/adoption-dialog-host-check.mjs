// Bounded component/viewport diagnostic; --real additionally runs an isolated real Pi PTY smoke.
// No adoption runs in the host. Questions come from disposable domain fixtures that always decline.
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdoptionSelector, selectionPrompt } from '../dist/adoption-ui.js';
import { visibleWidth } from 'pi-intercom-tui';
const root = fileURLToPath(new URL('../', import.meta.url));
const child = spawnSync(process.execPath, [path.join(root, 'tests/fixtures/adoption-runner.mjs'), '--questions'], {
  cwd: root, encoding: 'utf8', timeout: 30_000, maxBuffer: 2_000_000,
  env: { ...process.env, PI_ROLE_DIR: '', PI_INTERCOM_WORKER_ROLE: '' },
});
if (child.error || child.status !== 0) throw new Error(`question capture failed: ${child.error ?? child.stderr}`);
const questions = [...child.stdout.matchAll(/^QUESTION BEGIN (\w+)\n([\s\S]*?)\nQUESTION END \1$/gm)]
  .map(match => ({ kind: match[1], prompt: match[2] }));
if (questions.length !== 1) throw new Error(`expected exactly one adoption question; got ${questions.length}`);
const normalize = value => value.replace(/\s/g, '');
for (const [index, question] of questions.entries()) {
  for (const [columns, rows] of [[100, 30], [60, 18], [40, 12]]) {
    const text = selectionPrompt(question.kind, question.prompt);
    const dialog = new AdoptionSelector(text, () => ({ columns, rows }), () => {}, () => {});
    const lines = new Map();
    for (let page = 0; page < 500; page++) {
      const painted = dialog.render(columns - 2);
      if (painted.length > rows - 2 || painted.some(line => visibleWidth(line) > columns - 2)) throw new Error('viewport overflow');
      const at = painted.findIndex(line => line.startsWith('Context '));
      const [, start, end, total] = painted[at].match(/Context (\d+)-(\d+)\/(\d+)/).map(Number);
      for (let i = start; i <= end; i++) lines.set(i, painted[i - start]);
      if (end === total) break;
      dialog.handleInput('\x1b[6~');
      if (page === 499) throw new Error('paging did not finish');
    }
    const recovered = [...lines].sort(([a], [b]) => a - b).map(([, line]) => line).join('');
    if (normalize(recovered) !== normalize(text)) throw new Error(`lost context: branch ${index}, ${columns}x${rows}`);
  }
}
console.log('PASS component viewport: one adoption question, 100x30/60x18/40x12; bounded rows, every question character retrievable. Not real-host evidence.');
if (process.argv.includes('--real')) {
  const hostRoot = process.env.PI_ADOPTION_HOST_ROOT;
  if (!hostRoot) throw new Error('--real requires explicit PI_ADOPTION_HOST_ROOT; no host/version guess');
  const manifest = JSON.parse(await readFile(path.join(hostRoot, 'package.json'), 'utf8'));
  if (manifest.name !== '@earendil-works/pi-coding-agent') throw new Error('not a Pi host');
  const temp = await mkdtemp(path.join(tmpdir(), 'intercom-dialog-smoke-'));
  try {
    // Synthetic extra-long context exercises scrolling beyond the real branch previews too.
    questions.push({ kind: 'synthetic-long', prompt: `${'Board root: /very/long/projects/home/'.repeat(8)}\nCurrent: 01a15161-da4d-73e7-ba68-c0a394830b98 port 43901\nPrevious: 01a15157-833e-7557-aee5-3858d48dc87e port 41233\n${Array.from({ length: 25 }, (_, i) => `Effect ${i}: untouched workers; no real adoption or authority.`).join('\n')}` });
    await writeFile(path.join(temp, 'questions.json'), JSON.stringify(questions));
    await writeFile(path.join(temp, 'smoke.mjs'), `import { readFileSync, appendFileSync } from 'node:fs';
import { askAdoptionDecision } from ${JSON.stringify(path.join(root, 'dist/adoption-ui.js'))};
const questions = JSON.parse(readFileSync(${JSON.stringify(path.join(temp, 'questions.json'))}, 'utf8'));
export default pi => { pi.registerCommand('smoke', { description: 'Synthetic selection only; no adoption', handler: async (args, ctx) => {
 const index = Number(args); const answer = await askAdoptionDecision(ctx.ui, questions[index]);
 appendFileSync(${JSON.stringify(path.join(temp, 'answers.jsonl'))}, JSON.stringify({ index, answer }) + '\\n');
} }); };
`);
    const result = spawnSync(process.env.PI_ADOPTION_PYTHON ?? 'python3', [path.join(root, 'scripts/adoption-dialog-pty.py'), temp,
      path.join(hostRoot, manifest.bin.pi), process.execPath, process.env.PI_ADOPTION_TUI_MODE ?? 'fullscreen'], {
      timeout: 100_000, encoding: 'utf8', maxBuffer: 1_000_000,
      env: { PATH: process.env.PATH, LANG: 'C.UTF-8', TERM: 'xterm-256color', PYTHONPATH: process.env.PI_ADOPTION_PYTE_PATH ?? '' },
    });
    if (result.error || result.status !== 0) throw new Error(`real-host smoke failed: ${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
    console.log(`HOST ${manifest.name}@${manifest.version}; Node ${process.version}; ${process.platform}; ${process.env.PI_ADOPTION_TUI_MODE ?? 'fullscreen'}`);
    console.log(result.stdout.trim());
  } finally { await rm(temp, { recursive: true, force: true }); }
}
