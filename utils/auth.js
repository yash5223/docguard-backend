const jwt = require('jsonwebtoken');

const TOKEN_EXPIRY = '30d';

function requireSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    // Fail loudly on boot-time misconfiguration rather than silently signing
    // tokens with a weak/missing secret.
    throw new Error('JWT_SECRET is missing or too short. Set a random 32+ character secret in your .env.');
  }
  return secret;
}

// Issues a session token for a user. Only ever call this after verifying the
// user's password (login) or during registration.
function signToken(user) {
  return jwt.sign(
    { uid: user._id.toString(), cid: user.customer_id, email: user.email },
    requireSecret(),
    { expiresIn: TOKEN_EXPIRY }
  );
}

// Express middleware: every route that touches user data must use this.
// It NEVER trusts an email/id supplied by the client (query, body, or
// params) to decide whose data to return — identity always comes from the
// verified token.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Authentication required. Please log in again.' });
  }
  try {
    const payload = jwt.verify(token, requireSecret());
    req.userId = payload.uid;
    req.customerId = payload.cid;
    req.userEmail = payload.email;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Your session has expired or is invalid. Please log in again.' });
  }
}

module.exports = { signToken, requireAuth };
