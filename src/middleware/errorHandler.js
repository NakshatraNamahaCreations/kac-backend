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
