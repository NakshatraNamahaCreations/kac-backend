// Matches the client's NormalizedError shape ({ code, message, fields }) so
// apiClient.normalizeError on the mobile app reads real-backend errors the
// same way it reads mock-adapter errors.
class HttpError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

function fail(status, code, message, fields) {
  throw new HttpError(status, code, message, fields);
}

module.exports = { HttpError, fail };
