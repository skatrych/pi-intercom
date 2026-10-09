import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

try {
  require.resolve('typescript');
} catch (error) {
  if (error && error.code === 'MODULE_NOT_FOUND') {
    console.error('prepare: typescript is not installed; using committed dist (pi installs with --omit=dev)');
    process.exit(0);
  }
  throw error;
}

execSync('npm run build', { stdio: 'inherit' });
