const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
async function sendOtpEmail(toEmail, otpCode) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    throw new Error('BREVO_API_KEY is not configured.');
  }
  const fromAddress = process.env.SMTP_FROM;
  if (!fromAddress) {
    throw new Error('SMTP_FROM is not configured.');
  }
  const response = await fetch(BREVO_API_URL, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'DocGuard', email: fromAddress },
      to: [{ email: toEmail }],
      subject: 'Your DocGuard password reset code',
      htmlContent: `
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
      textContent: `Your DocGuard password reset code is: ${otpCode} (expires in 5 minutes)`,
    }),
  });
  if (!response.ok) {
    let detail = '';
    try {
      const errBody = await response.json();
      detail = errBody.message || JSON.stringify(errBody);
    } catch {
      detail = await response.text();
    }
    throw new Error(`Brevo API error (${response.status}): ${detail}`);
  }
}
module.exports = { sendOtpEmail };
