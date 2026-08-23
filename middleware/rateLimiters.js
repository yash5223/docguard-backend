const rateLimit = require('express-rate-limit');

// Login / password-reset-request / pin-verify: brute-force-sensitive,
// keyed by IP. Generous enough for a real user mistyping a password a
// few times, tight enough to stop automated guessing.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

// OTP send/verify: short numeric codes need a tighter cap so a 6-digit code
// can't be brute-forced within its expiry window.
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification attempts. Please request a new code.' },
});

module.exports = { authLimiter, otpLimiter };
