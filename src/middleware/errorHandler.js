const { ZodError } = require('zod');
const { HttpError } = require('../lib/httpError');

function notFoundHandler(req, res) {
  res.status(404).json({ code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) });
    return;
  }
  if (err instanceof ZodError) {
    const fields = {};
    for (const issue of err.issues) fields[issue.path.join('.') || '_'] = issue.message;
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid request.', fields });
    return;
  }
  // body-parser (express.json) failures — surfaced as real 4xx instead of a
  // generic 500, so e.g. an oversized photo upload tells the user why.
  if (err && typeof err === 'object' && err.type === 'entity.too.large') {
    res.status(413).json({ code: 'PAYLOAD_TOO_LARGE', message: 'That file is too large. Please use a smaller photo.' });
    return;
  }
  if (err && typeof err === 'object' && err.type === 'entity.parse.failed') {
    res.status(400).json({ code: 'INVALID_JSON', message: 'Invalid request body.' });
    return;
  }
  if (err && typeof err === 'object' && 'name' in err && err.name === 'ValidationError') {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: err.message });
    return;
  }
  if (err && typeof err === 'object' && 'name' in err && err.name === 'CastError') {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Resource not found.' });
    return;
  }
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Something went wrong.' });
}

module.exports = { notFoundHandler, errorHandler };
