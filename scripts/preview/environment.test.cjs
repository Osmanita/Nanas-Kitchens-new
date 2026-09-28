const { test } = require('node:test');
const assert = require('node:assert/strict');
const { previewEnvironment, tunnelConfiguration } = require('./environment.cjs');
const sandbox = { STRIPE_SECRET_KEY: 'sk_test_example', STRIPE_PUBLISHABLE_KEY: 'pk_test_example' };

test('preview refuses live or mixed-mode payment keys', () => {
  assert.throws(() => previewEnvironment({ ...sandbox, STRIPE_SECRET_KEY: 'sk_live_example' }));
  assert.throws(() => previewEnvironment({ ...sandbox, STRIPE_PUBLISHABLE_KEY: 'pk_live_example' }));
  assert.throws(() => previewEnvironment({}));
});
test('preview keeps protected API calls same-origin and only binds the API to loopback', () => {
  const env = previewEnvironment({ ...sandbox, JAVA_API_PORT: '9000' });
  assert.equal(env.NEXT_PUBLIC_API_URL, '/api');
  assert.equal(env.SERVER_ADDRESS, '127.0.0.1');
  assert.equal(env.API_INTERNAL_URL, 'http://127.0.0.1:8080');
  assert.equal(env.JAVA_API_PORT, '8080');
  assert.equal(env.WEB_BASE_URL, 'https://nanaskitchens.app');
  assert.equal(env.PAYMENTS_PROVIDER, 'stripe');
  assert.equal(env.DELIVERY_PROVIDER, 'mock');
});
test('preview does not permit a URL to inject a return path or origin', () => {
  assert.throws(() => previewEnvironment({ ...sandbox, PREVIEW_DOMAIN: 'https://example.com/path' }));
  assert.throws(() => previewEnvironment({ ...sandbox, PREVIEW_DOMAIN: 'example.com@other.test' }));
});
test('tunnel requires an Access audience and rejects every unmatched hostname', () => {
  const settings = {
    domain: 'nanaskitchens.app', teamName: 'nanas-beta', audience: 'a'.repeat(64),
    tunnelId: '29807a28-b7fb-42a1-b58b-87d866f7b4c0',
  };
  const config = tunnelConfiguration(settings, '/private/cloudflared');
  assert.equal(config.ingress[0].originRequest.access.required, true);
  assert.deepEqual(config.ingress[0].originRequest.access.audTag, [settings.audience]);
  assert.equal(config.ingress[1].service, 'http_status:404');
  assert.throws(() => tunnelConfiguration({ ...settings, audience: '' }, '/private'));
});
