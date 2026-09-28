/** Run one private-preview service without changing local .env or opening terminal windows. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { previewEnvironment, tunnelConfiguration } = require('./environment.cjs');
const root = path.resolve(__dirname, '../..');
process.loadEnvFile(path.join(root, '.env'));
const env = previewEnvironment(process.env);
const web = path.join(root, 'apps/web');
const api = path.join(root, 'apps/api-java');
const next = path.join(web, 'node_modules/next/dist/bin/next');
const mode = process.argv[2];
let executable = process.execPath;
let args;
let cwd = root;
switch (mode) {
  case 'build':
    args = [next, 'build']; cwd = web; break;
  case 'web':
    args = [next, 'start', '--hostname', '127.0.0.1', '--port', '3000']; cwd = web; break;
  case 'api-build':
    executable = process.platform === 'win32' ? 'cmd.exe' : './mvnw';
    args = process.platform === 'win32'
      ? ['/d', '/s', '/c', 'mvnw.cmd -q -DskipTests package'] : ['-q', '-DskipTests', 'package'];
    cwd = api; break;
  case 'api':
    if (!env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_')) throw new Error('Start the Stripe listener first.');
    executable = env.JAVA_HOME ? path.join(env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
    args = ['-jar', path.join(api, 'target/api-0.1.0.jar')]; cwd = api; break;
  case 'stripe':
    args = [path.join(root, 'scripts/stripe-listen.cjs')]; break;
  case 'tunnel': {
    const directory = path.join(os.homedir(), '.cloudflared');
    const settings = JSON.parse(fs.readFileSync(path.join(directory, 'nanas-preview.json'), 'utf8'));
    const config = tunnelConfiguration(settings, directory);
    const configFile = path.join(directory, 'nanas-preview-config.json');
    // JSON is valid YAML; quoting cannot create additional ingress routes.
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2), { mode: 0o600 });
    executable = env.CLOUDFLARED_PATH || (process.platform === 'win32'
      ? path.join(env.LOCALAPPDATA, 'Programs/cloudflared/cloudflared.exe') : 'cloudflared');
    args = ['tunnel', '--no-autoupdate', '--config', configFile, 'run', settings.tunnelId];
    break;
  }
  default:
    throw new Error('Usage: node scripts/preview/run.cjs build|web|api-build|api|stripe|tunnel');
}
const child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: 'inherit' });
child.on('error', () => { console.error(`Could not start preview ${mode}.`); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
