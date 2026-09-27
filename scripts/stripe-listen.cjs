/** Forward sandbox payments to the local Java API. Requires Node 20.12+ and Stripe CLI. */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const envPath = path.resolve(__dirname, '../.env');
process.loadEnvFile(envPath);
if (!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(process.env.STRIPE_SECRET_KEY || '') ||
    !/^pk_test_[A-Za-z0-9]+$/.test(process.env.STRIPE_PUBLISHABLE_KEY || '')) {
  throw new Error('Set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY to test keys in .env first.');
}

// Use the app's account even when the CLI browser login selected another sandbox.
const cliEnv = { ...process.env, STRIPE_API_KEY: process.env.STRIPE_SECRET_KEY };
const windowsCandidates = [
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'nanas-stripe-tools/node_modules/@stripe/cli-win32-x64/bin/stripe.exe'),
  process.env.APPDATA && path.join(process.env.APPDATA, 'npm/node_modules/@stripe/cli-win32-x64/bin/stripe.exe'),
].filter(Boolean);
const executable = process.env.STRIPE_CLI_PATH ||
  (process.platform === 'win32' ? windowsCandidates.find(p => fs.existsSync(p)) || 'stripe.exe' : 'stripe');
const port = process.env.JAVA_API_PORT || '8080';
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid JAVA_API_PORT');

const child = spawn(executable, [
  'listen', '--skip-update', '--events-from', '@self',
  '--events', 'payment_intent.succeeded,payment_intent.payment_failed,payment_intent.canceled,checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired',
  '--forward-to', `http://localhost:${port}/webhooks/stripe`,
], { env: cliEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

function handleLine(line) {
  const secret = line.match(/whsec_[A-Za-z0-9]+/)?.[0];
  if (secret) {
    let content = fs.readFileSync(envPath, 'utf8');
    let changed = false;
    for (const [key, value] of Object.entries({ STRIPE_WEBHOOK_SECRET: secret, PAYMENTS_PROVIDER: 'stripe' })) {
      const pattern = new RegExp(`^${key}=([^\\r\\n]*)`, 'm');
      if (content.match(pattern)?.[1] === value) continue;
      content = pattern.test(content) ? content.replace(pattern, () => `${key}=${value}`) : `${content}\n${key}=${value}\n`;
      changed = true;
    }
    if (changed) {
      fs.writeFileSync(envPath, content, 'utf8');
      console.log('Stripe sandbox configuration saved to .env. Start/restart the Java API to load it.');
    }
  }
  console.log(line.replace(/(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9_]+|whsec_[A-Za-z0-9_]+/g, '[REDACTED]'));
}

for (const stream of [child.stdout, child.stderr]) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) handleLine(line);
  });
  stream.on('end', () => { if (buffer) handleLine(buffer); });
}
child.on('error', () => {
  console.error('Could not start Stripe CLI. Install it or set STRIPE_CLI_PATH to its executable.');
  process.exitCode = 1;
});
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
