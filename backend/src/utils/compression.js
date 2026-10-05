// Response compression options (the `compression` package: Brotli quality 4 for clients that send `br`, gzip otherwise).
//   - only compressible text types are touched (JS, CSS, JSON, SVG, text…): the package's default filter uses the mime-db
//     `compressible` flag, so images, fonts, zip, pdf and xlsx are skipped
//   - responses under 1 KB are sent as-is (compressing them costs more than it saves)
//   - gzip level 5 (Brotli stays at the library default, quality 4 — measured ≈ gzip-5 size/CPU on our bundles): ~same size as 6–9 on our bundles at a fraction of the CPU
//   - never for the biometric device endpoints (/iclock, firmware is not guaranteed to handle Content-Encoding) and never
//     for text/event-stream: compression buffers, which would stall the live-log SSE stream
//   - Cache-Control / ETag set by the app are left untouched; `Vary: Accept-Encoding` is added so shared caches stay correct,
//     and a client that does not send Accept-Encoding: gzip still gets the plain body
const compression = require('compression');

function shouldCompress(req, res) {
  if (req.headers['x-no-compression']) return false;
  if (req.path && req.path.startsWith('/iclock')) return false;
  if (String(res.getHeader('Content-Type') || '').includes('text/event-stream')) return false;
  return compression.filter(req, res);
}

const compressionOptions = { threshold: 1024, level: 5, filter: shouldCompress };

module.exports = { compression, compressionOptions, shouldCompress };
