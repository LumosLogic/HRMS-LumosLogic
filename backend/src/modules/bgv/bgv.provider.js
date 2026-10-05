/**
 * bgv.provider.js — provider abstraction for Background Verification.
 *
 * The rest of HRMS only talks to the interface below, never to a vendor directly.
 * To add another vendor: implement this interface in a new file and register it in PROVIDERS.
 *
 * Provider interface:
 *   name                                   string, stored in bgv_requests.provider
 *   ensureReady()                          optional; throws BgvProviderError if config is incomplete (called before any paid call)
 *   getReport({ candidateId, storedUrl })  -> { kind:'pdf', base64, fileName } | { kind:'url', url }
 *   createCandidate({ employee, packageIdentifier, reference })
 *        -> { candidateId, requestId?, providerStatus?, raw? }   (throws BgvProviderError)
 *   verifyWebhook(req)                     -> true | throws BgvProviderError (auth/signature check)
 *   parseWebhook(req)                      -> { eventId, candidateId, providerStatus, reportUrl?, raw }
 *   mapStatus(providerStatus)              -> 'pending'|'in_progress'|'completed'|'failed'|'cancelled'|null
 *
 * Selection: BGV_PROVIDER_MODE = 'springverify' | 'mock'. Unset => no provider (feature unusable, safe).
 * 'mock' is refused when NODE_ENV === 'production'.
 */

class BgvProviderError extends Error {
  /**
   * @param {string}  code          stable machine code
   * @param {string}  message       internal message (not shown to end users verbatim)
   * @param {object}  [opts]
   * @param {boolean} [opts.outcomeUnknown] request may have reached the provider (timeout etc.)
   */
  constructor(code, message, opts = {}) {
    super(message);
    this.name = 'BgvProviderError';
    this.code = code;
    this.outcomeUnknown = !!opts.outcomeUnknown;
  }
}

const PROVIDERS = {
  springverify: () => require('./springverify.client'),
  mock:         () => require('./mock.provider'),
};

function getProvider() {
  const mode = (process.env.BGV_PROVIDER_MODE || '').trim().toLowerCase();
  if (!mode) throw new BgvProviderError('PROVIDER_NOT_CONFIGURED', 'BGV_PROVIDER_MODE is not set');
  if (mode === 'mock' && process.env.NODE_ENV === 'production') {
    throw new BgvProviderError('MOCK_FORBIDDEN_IN_PRODUCTION', 'Mock BGV provider is disabled in production');
  }
  const load = PROVIDERS[mode];
  if (!load) throw new BgvProviderError('PROVIDER_UNKNOWN', `Unknown BGV_PROVIDER_MODE "${mode}"`);
  return load();
}

module.exports = { getProvider, BgvProviderError };
