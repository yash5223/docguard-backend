const crypto = require('crypto');

function secret() {
  const s = process.env.FIELD_HASH_SECRET || process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error('FIELD_HASH_SECRET (or JWT_SECRET) is missing or too short.');
  }
  return s;
}

// We never store the full Aadhaar number. Instead we store a keyed hash
// (for uniqueness checks / lookups) and the last 4 digits (for display,
// e.g. "XXXX-XXXX-1234"), which is not sensitive on its own.
function hashAadhaar(aadhaar) {
  const digitsOnly = String(aadhaar || '').replace(/\D/g, '');
  return crypto.createHmac('sha256', secret()).update(digitsOnly).digest('hex');
}

function aadhaarLast4(aadhaar) {
  const digitsOnly = String(aadhaar || '').replace(/\D/g, '');
  return digitsOnly.slice(-4);
}

function isValidAadhaarFormat(aadhaar) {
  return /^\d{12}$/.test(String(aadhaar || '').replace(/\s/g, ''));
}

module.exports = { hashAadhaar, aadhaarLast4, isValidAadhaarFormat };
