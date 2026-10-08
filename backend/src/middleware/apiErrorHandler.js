'use strict';
// Last-resort error handler for /api routes: always answer JSON.
//
// Without it, errors raised OUTSIDE a route's own try/catch (multer's file-size / unexpected-field errors, body-parser
// errors) fell through to Express's HTML error page, which the client cannot parse and replaced with its generic
// "Unexpected server error" text (DOC-014 and every upload with a too-large file).
const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE:       'The file is too large. The maximum upload size is 10 MB.',
  LIMIT_UNEXPECTED_FILE: 'Unexpected file field in the upload.',
  LIMIT_FILE_COUNT:      'Too many files in one upload.',
};

function apiErrorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const isApi = req.originalUrl && req.originalUrl.startsWith('/api/');
  if (!isApi) return next(err);

  if (err && err.name === 'MulterError')
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: MULTER_MESSAGES[err.code] || 'The upload could not be processed.' });
  if (err && err.type === 'entity.too.large')
    return res.status(413).json({ error: 'The request is too large.' });
  if (err && err.type === 'entity.parse.failed')
    return res.status(400).json({ error: 'The request body is not valid JSON.' });

  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(`[api] ${req.method} ${req.originalUrl}:`, err?.stack || err);
  return res.status(status).json({ error: status >= 500 ? 'Unexpected server error. Please try again.' : (err.message || 'Request failed') });
}

module.exports = { apiErrorHandler };
