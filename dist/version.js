import { readFileSync } from 'node:fs';
// Both src/ and dist/ sit directly below this package's own manifest. Capture
// once at process startup, not from cwd or on each render after an update.
function packageVersion() {
    try {
        const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
        const version = manifest.version;
        if (typeof version === 'string' && version.length <= 64 && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version))
            return version;
    }
    catch { /* A display label must never prevent the monitor starting. */ }
    return 'unknown';
}
export const INTERCOM_VERSION = packageVersion();
//# sourceMappingURL=version.js.map