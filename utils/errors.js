// Logs the real error server-side but only ever sends a generic message to
// the client, so stack traces / DB / library internals never leak over the
// API (they used to be sent verbatim as `err.message`).
function sendServerError(res, err, context) {
  console.error(`[${context || 'server'}]`, err);
  return res.status(500).json({ error: 'Something went wrong. Please try again in a moment.' });
}

module.exports = { sendServerError };
