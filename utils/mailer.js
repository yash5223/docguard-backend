const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false, // STARTTLS on port 587
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
}

/**
 * Sends a 6-digit OTP code to the given email address.
 * Throws if the send fails, so callers can roll back / surface an error.
 */
async function sendOtpEmail(toEmail, otpCode) {
  const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER;
  await getTransporter().sendMail({
    from: `"DocGuard" <${fromAddress}>`,
    to: toEmail,
    subject: 'Your DocGuard password reset code',
    html: `
      <div style="font-family: -apple-system, Roboto, Arial, sans-serif; max-width: 420px; margin: 0 auto; padding: 24px; color: #0B1F3D;">
        <h2 style="margin-bottom: 8px;">Reset your password</h2>
        <p style="color:#4A5568; font-size: 14px; line-height: 1.5;">
          Use the code below to reset your DocGuard account password. This code expires in 5 minutes.
        </p>
        <div style="font-family: monospace; font-size: 32px; font-weight: 700; letter-spacing: 8px; background:#F1F3F6; border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0;">
          ${otpCode}
        </div>
        <p style="color:#94A3B8; font-size: 12px;">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `,
    text: `Your DocGuard password reset code is: ${otpCode} (expires in 5 minutes)`,
  });
}

module.exports = { sendOtpEmail };
