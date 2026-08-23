require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const userRoutes = require('./routes/userRoutes');
const scanReceiptRoutes = require('./routes/scanReceipt');
const assetRoutes = require('./routes/assetRoutes');
const vaultRoutes = require('./routes/vaultRoutes');
const aiRoutes = require('./routes/aiRoutes');
const { router: alertRoutes } = require('./routes/alertRoutes');
const Invite = require('./models/Invite');

// Fail fast on boot if required secrets aren't configured, instead of
// silently running with an insecure default.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET is missing or shorter than 32 characters. Set it in your .env before starting the server.');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet());

// CORS: only relevant to browser (web build) callers — native mobile
// requests don't send an Origin header at all. Restrict to known origins
// in production via ALLOWED_ORIGINS; fall back to allowing everything only
// when explicitly running in development.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true); // no Origin header (mobile apps, curl, server-to-server)
    if (allowedOrigins.length === 0) {
      if (process.env.NODE_ENV === 'production') {
        console.warn(`[CORS] Blocked browser request from ${origin} — set ALLOWED_ORIGINS in .env to allow your web app's domain.`);
        return callback(new Error('Not allowed by CORS'));
      }
      return callback(null, true); // dev convenience only
    }
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
}));

app.use(express.json({ limit: '2mb' }));
app.use(mongoSanitize()); // strips `$`/`.` keys from body/query/params to block NoSQL-injection-style payloads

app.use((req, res, next) => {
  // Log method + path only — the old logger also printed the full query
  // string, which leaked emails/tokens into server logs.
  console.log(`[${req.method}] ${req.path}`);
  next();
});

app.use('/api/users', userRoutes);
app.use('/api/receipt', scanReceiptRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/vault', vaultRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/alerts', alertRoutes);

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
mongoose.set('bufferTimeoutMS', 8000);
mongoose.connect(MONGODB_URI, {
  serverSelectionTimeoutMS: 8000,
})
  .then(async () => {
    console.log('Connected to MongoDB Atlas');
    try {
      const SharedDocument = require('./models/SharedDocument');
      await SharedDocument.syncIndexes();
      console.log('SharedDocument indexes synced.');
    } catch (indexErr) {
      console.error('Failed to sync SharedDocument indexes:', indexErr);
    }
  })
  .catch((err) => console.error('Connection error:', err));

app.get('/', (req, res) => {
  res.send('Server is running');
});

app.get('/join/:token', async (req, res) => {
  const { token } = req.params;
  let statusMessage = 'This invite link is invalid.';
  let statusOk = false;
  try {
    const invite = await Invite.findOne({ token });
    if (invite) {
      if (invite.status === 'accepted') {
        statusMessage = 'This invite has already been used.';
      } else if (invite.status === 'revoked' || invite.expiresAt < new Date()) {
        statusMessage = 'This invite link has expired or was revoked.';
      } else {
        statusOk = true;
        statusMessage = `You've been invited to join a DocGuard family vault as ${invite.role}.`;
      }
    }
  } catch (err) {
    console.error('[join] lookup failed:', err);
    statusMessage = 'Something went wrong checking this invite.';
  }
  const deepLink = `docguard://join/${token}`;
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Join DocGuard Vault</title>
<style>
  body { font-family: -apple-system, Roboto, Arial, sans-serif; background:#FAFAFB; color:#0B1F3D;
         display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; padding:24px; }
  .card { max-width:420px; width:100%; background:#fff; border-radius:16px; padding:32px 24px;
          box-shadow:0 4px 24px rgba(0,0,0,0.08); text-align:center; }
  h1 { font-size:22px; margin-bottom:12px; }
  p { font-size:15px; color:#4A5568; line-height:1.5; }
  .token { font-family:monospace; background:#F1F3F6; border-radius:8px; padding:10px 14px;
           margin:16px 0; font-size:14px; word-break:break-all; }
  button { background:#0B1F3D; color:#fff; border:none; border-radius:10px; padding:12px 20px;
           font-size:15px; cursor:pointer; width:100%; margin-top:8px; }
  button.secondary { background:#fff; color:#0B1F3D; border:1px solid #D8DCE3; }
</style>
</head>
<body>
  <div class="card">
    <h1>DocGuard</h1>
    <p>${statusMessage}</p>
    ${statusOk ? `
      <div class="token" id="tokenBox">${token}</div>
      <button onclick="window.location.href='${deepLink}'">Open in DocGuard app</button>
      <button class="secondary" onclick="copyToken()">Copy invite code</button>
      <p style="font-size:13px; margin-top:16px;">
        If the app doesn't open automatically, open DocGuard and enter this code
        on the "Join Vault" screen.
      </p>
    ` : ''}
  </div>
  <script>
    function copyToken() {
      navigator.clipboard.writeText(${JSON.stringify(token)});
      alert('Invite code copied');
    }
    ${statusOk ? `window.location.href = ${JSON.stringify(deepLink)};` : ''}
  </script>
</body>
</html>`);
});

// Catches multer file-type/size rejections and any other error that bubbles
// up without a route-level handler, so a stack trace never reaches the
// client.
app.use((err, req, res, next) => {
  if (err && err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'This origin is not allowed to access the API.' });
  }
  console.error('[unhandled]', err);
  res.status(err && err.status ? err.status : 400).json({ error: (err && err.message) || 'Request failed.' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

const selfUrl = process.env.RENDER_EXTERNAL_URL;
if (selfUrl) {
  const PING_INTERVAL_MS = 10 * 60 * 1000;
  setInterval(() => {
    fetch(selfUrl)
      .then(() => console.log('[keep-alive] self-ping OK'))
      .catch((err) => console.error('[keep-alive] self-ping failed:', err.message));
  }, PING_INTERVAL_MS);
  console.log(`[keep-alive] self-ping enabled, pinging ${selfUrl} every ${PING_INTERVAL_MS / 60000} min`);
}
