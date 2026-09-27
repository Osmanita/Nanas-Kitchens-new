const { test } = require('node:test');
const assert = require('node:assert/strict');
const { databaseUrl, migrate } = require('./migrate.cjs');

const env = { DB_HOST: 'db.example.test', DB_USER: 'nanas_admin', DB_PASSWORD: 'p@ss:/?#$word', APP_DB_PASSWORD: 'app-password' };

test('database URL encodes credentials and verifies the RDS certificate', () => {
  const url = new URL(databaseUrl(env));
  assert.equal(decodeURIComponent(url.password), env.DB_PASSWORD);
  assert.equal(url.hostname, env.DB_HOST);
  assert.equal(url.pathname, '/culture_eats');
  assert.equal(url.searchParams.get('sslaccept'), 'strict');
  assert.equal(url.searchParams.get('sslcert'), '/etc/ssl/certs/rds-ca-bundle.pem');
});
test('local migration can still use an existing DATABASE_URL', () => {
  const url = 'postgresql://local:local@localhost/test';
  assert.equal(databaseUrl({ DATABASE_URL: url }), url);
});
test('missing database credentials fail before starting a subprocess', () => {
  assert.throws(() => databaseUrl({ DB_HOST: env.DB_HOST }), /Missing DB_USER/);
  assert.throws(() => migrate({ ...env, APP_DB_PASSWORD: '' }, () => assert.fail()), /APP_DB_PASSWORD/);
});
test('failed schema migration never starts the grants phase', () => {
  let calls = 0;
  assert.throws(() => migrate(env, () => { calls++; return { status: 1 }; }), /Schema migration failed/);
  assert.equal(calls, 1);
});
test('grant failures fail the task so services cannot roll out', () => {
  assert.throws(() => migrate(env, command => ({ status: command === 'psql' ? 2 : 0 })), /grants failed/);
});
test('migration applies schema then grants without putting passwords in arguments', () => {
  const calls = [];
  migrate(env, (command, args, options) => { calls.push({ command, args, options }); return { status: 0 }; });
  assert.deepEqual(calls.map(c => c.command), ['prisma', 'psql']);
  assert.equal(calls[1].options.env.PGSSLMODE, 'verify-full');
  assert.equal(calls[1].options.env.PGPASSWORD, env.DB_PASSWORD);
  assert.ok(calls.every(c => !JSON.stringify(c.args).includes(env.DB_PASSWORD)));
});
