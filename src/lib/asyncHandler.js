// Wraps an async route handler so rejected promises reach the error
// middleware instead of crashing the process / hanging the request.
function asyncHandler(fn) {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

module.exports = { asyncHandler };
