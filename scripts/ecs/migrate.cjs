const { spawnSync } = require('node:child_process');

function databaseUrl(env) {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  for (const key of ['DB_HOST', 'DB_USER', 'DB_PASSWORD']) {
    if (!env[key]) throw new Error(`Missing ${key}`);
  }
  const url = new URL(`postgresql://${env.DB_HOST}:5432/${env.DB_NAME || 'culture_eats'}`);
  url.username = env.DB_USER;
  url.password = env.DB_PASSWORD;
  url.searchParams.set('sslmode', 'require');
  url.searchParams.set('sslaccept', 'strict');
  url.searchParams.set('sslcert', '/etc/ssl/certs/rds-ca-bundle.pem');
  return url.toString();
}

function migrate(env = process.env, run = spawnSync) {
  const grantRole = Boolean(env.DB_HOST);
  if (grantRole && !env.APP_DB_PASSWORD) throw new Error('Missing APP_DB_PASSWORD');
  const result = run('prisma', ['migrate', 'deploy'], {
    env: { ...env, DATABASE_URL: databaseUrl(env) }, stdio: 'inherit', windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new Error('Schema migration failed; services must not be updated');
  if (!grantRole) return;

  // Secrets are passed through the environment, never command-line arguments or logs.
  const grants = run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f', '/job/grant-app-role.sql'], {
    env: { ...env, PGHOST: env.DB_HOST, PGPORT: '5432', PGDATABASE: env.DB_NAME || 'culture_eats',
      PGUSER: env.DB_USER, PGPASSWORD: env.DB_PASSWORD, PGSSLMODE: 'verify-full',
      PGSSLROOTCERT: '/etc/ssl/certs/rds-ca-bundle.pem' },
    stdio: 'inherit', windowsHide: true,
  });
  if (grants.error || grants.status !== 0) throw new Error('Application database grants failed; services must not be updated');
}

module.exports = { databaseUrl, migrate };
if (require.main === module) {
  try { migrate(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
