// Offset-based cursor matching the client's `Page<T> = { data, nextCursor }`
// contract. The cursor is just the next skip value — opaque to the client,
// which only ever round-trips it back as a query param.

function parseCursor(cursor) {
  const skip = Number(cursor ?? 0);
  return Number.isFinite(skip) && skip >= 0 ? skip : 0;
}

function buildPage(data, skip, limit, total) {
  const nextSkip = skip + data.length;
  return {
    data,
    nextCursor: nextSkip < total ? String(nextSkip) : null,
  };
}

module.exports = { parseCursor, buildPage };
