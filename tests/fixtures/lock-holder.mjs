// Test-only lock holder for the ADR 0025 P1 evidence. It runs in a separate OS process so the native
// kernel lock, crash release and descriptor non-inheritance are real, not mocked. NOT shipped.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { acquireConfigLock } from '../../dist/native-lock.js';
import { ConfigStore } from '../../dist/config.js';

const [mode, home] = process.argv.slice(2);
const guard = path.join(home, '.pi-intercom', 'config.lock');
const caller = { sessionId: 'gone-coordinator', port: 41001 };
// A pending top-level await alone lets Node exit; a live timer keeps this holder running until killed.
const forever = () => { setInterval(() => {}, 60_000); return new Promise(() => {}); };
await mkdir(path.dirname(guard), { recursive: true });

// Keep a live reference: a collected FileHandle would close its descriptor and release the lock.
if (mode === 'hold') {
  globalThis.__held = await acquireConfigLock(guard);
  process.send({ ready: true, pid: process.pid, guard });
  await forever();
} else if (mode === 'hold-and-child') {
  globalThis.__held = await acquireConfigLock(guard);
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: ['ignore', 'ignore', 'ignore'] });
  process.send({ ready: true, pid: process.pid, childPid: child.pid });
  await forever();
} else if (mode === 'crash-in-transaction') {
  const store = new ConfigStore(home);
  await store.transaction(async () => { process.send({ ready: true, pid: process.pid }); await forever(); });
} else if (mode === 'crash-after-temp') {
  class CrashStore extends ConfigStore {
    async openTemporary(file) {
      const handle = await super.openTemporary(file);
      return {
        writeFile: data => handle.writeFile(data),
        sync: () => handle.sync(),
        close: async () => { await handle.close(); process.send({ ready: true, pid: process.pid }); await forever(); },
      };
    }
  }
  const store = new CrashStore(home);
  await store.update(caller, config => { config.multiplexer = 'none'; });
} else if (mode === 'publish') {
  const store = new ConfigStore(home);
  await store.update(caller, config => { config.multiplexer = 'none'; });
  process.send({ ready: true, pid: process.pid, published: true });
  await forever();
} else {
  throw new Error(`unknown holder mode ${mode}`);
}
