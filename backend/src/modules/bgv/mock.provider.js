/**
 * mock.provider.js — development/test BGV provider. NOT SpringVerify's contract; it only exercises
 * the HRMS flow (request -> webhook -> completed). Refused in production by getProvider().
 *
 * Mock webhook: POST /api/bgv/webhook (BGV_PROVIDER_MODE=mock)
 *   header  x-bgv-mock-secret: <SPRINGVERIFY_WEBHOOK_SECRET>
 *   body    { event_id, candidate_id, status: pending|in_progress|completed|failed|cancelled, report_url? }
 */
const crypto = require('crypto');
const { BgvProviderError } = require('./bgv.provider');

function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const STATUS_MAP = {
  pending: 'pending', in_progress: 'in_progress', completed: 'completed', failed: 'failed', cancelled: 'cancelled',
};

module.exports = {
  name: 'mock',

  ensureReady() {},

  async getReport({ storedUrl }) {
    if (!storedUrl) throw new BgvProviderError('REPORT_UNAVAILABLE', 'no stored report');
    return { kind: 'url', url: storedUrl };
  },

  async createCandidate({ employee, packageIdentifier }) {
    if (!employee?.email) throw new BgvProviderError('INVALID_INPUT', 'employee email required');
    const id = crypto.randomUUID();
    return { candidateId: `mock_${id}`, requestId: `mockreq_${id}`, providerStatus: 'pending',
             raw: { mock: true, package: packageIdentifier || null } };
  },

  async addCandidate({ employee }) {
    if (!employee?.email) throw new BgvProviderError('INVALID_INPUT', 'employee email required');
    return { candidateId: `mock_${crypto.randomUUID()}`, providerStatus: '3', raw: { mock: true } };
  },

  async submitBgv({ candidateId, documents }) {
    return { candidateId, providerStatus: null, raw: { mock: true, documents: documents.filter(d => d.sv).length } };
  },

  async refreshStatus() { return { providerStatus: 'in_progress', raw: { mock: true } }; },

  verifyWebhook(req) {
    const secret = process.env.SPRINGVERIFY_WEBHOOK_SECRET;
    if (!secret) throw new BgvProviderError('WEBHOOK_SECRET_MISSING', 'webhook secret not configured');
    const got = req.headers['x-bgv-mock-secret'];
    if (!got || !safeEqual(got, secret)) throw new BgvProviderError('WEBHOOK_UNAUTHORIZED', 'bad webhook secret');
    return true;
  },

  parseWebhook(req) {
    const b = req.body || {};
    if (!b.event_id || !b.candidate_id || !b.status) {
      throw new BgvProviderError('WEBHOOK_INVALID', 'event_id, candidate_id and status are required');
    }
    return { eventId: String(b.event_id), candidateId: String(b.candidate_id),
             providerStatus: String(b.status), reportUrl: b.report_url || null, raw: b };
  },

  mapStatus(s) { return STATUS_MAP[String(s).toLowerCase()] || null; },
};
