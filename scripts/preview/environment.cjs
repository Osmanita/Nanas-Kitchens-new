/** Settings for the invitation-only, laptop-hosted sandbox. Never accepts live keys. */
const hostnamePattern = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

function previewEnvironment(source) {
  if (!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(source.STRIPE_SECRET_KEY || '') ||
      !/^pk_test_[A-Za-z0-9]+$/.test(source.STRIPE_PUBLISHABLE_KEY || '')) {
    throw new Error('Private preview requires Stripe sandbox keys. Live payments are not allowed.');
  }
  const domain = source.PREVIEW_DOMAIN || 'nanaskitchens.app';
  if (!hostnamePattern.test(domain)) {
    throw new Error('PREVIEW_DOMAIN must be a hostname, without a URL scheme or path.');
  }
  return {
    ...source,
    NANAS_PREVIEW: '1',
    NEXT_PUBLIC_PREVIEW_MODE: '1',
    NEXT_PUBLIC_API_URL: '/api',
    API_INTERNAL_URL: 'http://127.0.0.1:8080',
    NEXT_DIST_DIR: '.next-preview',
    WEB_BASE_URL: `https://${domain}`,
    PUBLIC_BASE_URL: `https://${domain}/api`,
    APP_CORS_ALLOWED_ORIGIN_PATTERNS: `https://${domain},http://localhost:*,http://127.0.0.1:*`,
    SERVER_ADDRESS: '127.0.0.1',
    JAVA_API_PORT: '8080',
    SERVER_FORWARD_HEADERS_STRATEGY: 'framework',
    PAYMENTS_PROVIDER: 'stripe',
    // The preview never sends real courier requests or external notifications.
    DELIVERY_PROVIDER: 'mock',
    NOTIFICATIONS_CHANNELS: 'log',
  };
}

function tunnelConfiguration(settings, directory) {
  const { domain, tunnelId, teamName, audience } = settings;
  if (!hostnamePattern.test(domain || '') || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(teamName || '') ||
      !/^[0-9a-f]{64}$/i.test(audience || '') ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tunnelId || '')) {
    throw new Error('Verified Cloudflare Access team, application audience and tunnel are required.');
  }
  return {
    tunnel: tunnelId,
    'credentials-file': require('node:path').join(directory, `${tunnelId}.json`),
    ingress: [{
      hostname: domain,
      service: 'http://127.0.0.1:3000',
      originRequest: {
        access: { required: true, teamName, audTag: [audience] },
      },
    }, { service: 'http_status:404' }],
  };
}

module.exports = { previewEnvironment, tunnelConfiguration };
