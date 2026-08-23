const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');
const Otp = require('../models/Otp');
const { sendOtpEmail } = require('../utils/mailer');
const { signToken, requireAuth } = require('../utils/auth');
const { hashAadhaar, aadhaarLast4, isValidAadhaarFormat } = require('../utils/piiFields');
const { sendServerError } = require('../utils/errors');
const { authLimiter, otpLimiter } = require('../middleware/rateLimiters');
const router = express.Router();
const EMAIL_REGEX = /^[\w.\-]+@[\w-]+\.[a-zA-Z]{2,}$/;
const PHONE_REGEX = /^\+?\d{7,15}$/;

router.post('/register/send-otp', otpLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    const cleanEmail = (email || '').toLowerCase().trim();
    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }
    if (await User.findOne({ email: cleanEmail })) {
      // Same generic message whether or not the email exists, to avoid
      // leaking which emails are registered.
      return res.status(200).json({ success: true, message: 'If this email can be registered, a verification code has been sent.' });
    }
    const otpCode = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await Otp.deleteMany({ contactInfo: cleanEmail, purpose: { $in: ['register', 'register_verified'] } });
    await Otp.create({ contactInfo: cleanEmail, otpCode, expiresAt, purpose: 'register' });
    try {
      await sendOtpEmail(cleanEmail, otpCode, 'register');
    } catch (mailErr) {
      console.error('[OTP] Failed to send registration email:', mailErr.message);
      await Otp.deleteMany({ contactInfo: cleanEmail, purpose: 'register' });
      return res.status(500).json({ error: 'Could not send verification email. Please try again in a moment.' });
    }
    res.status(200).json({ success: true, message: 'If this email can be registered, a verification code has been sent.' });
  } catch (err) {
    return sendServerError(res, err, 'register/send-otp');
  }
});

router.post('/register/verify-otp', otpLimiter, async (req, res) => {
  try {
    const { email, otpCode } = req.body;
    const cleanEmail = (email || '').toLowerCase().trim();
    if (!cleanEmail || !otpCode) {
      return res.status(400).json({ error: 'Email and verification code are required.' });
    }
    const match = await Otp.findOne({ contactInfo: cleanEmail, otpCode, purpose: 'register' });
    if (!match) {
      return res.status(400).json({ error: 'Invalid verification code.' });
    }
    if (match.expiresAt < new Date()) {
      await Otp.deleteOne({ _id: match._id });
      return res.status(400).json({ error: 'This code has expired. Please request a new one.' });
    }
    await Otp.deleteOne({ _id: match._id });
    const verificationToken = crypto.randomBytes(24).toString('hex');
    const tokenExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await Otp.create({ contactInfo: cleanEmail, otpCode: verificationToken, expiresAt: tokenExpiresAt, purpose: 'register_verified' });
    res.status(200).json({ success: true, verificationToken });
  } catch (err) {
    return sendServerError(res, err, 'register/verify-otp');
  }
});

router.post('/register', authLimiter, async (req, res) => {
  try {
    const { fullName, dob, gender, email, phone, aadhaar, passwordHash, verificationToken } = req.body;
    if (!fullName || !dob || !gender || !email || !phone || !aadhaar || !passwordHash) {
      return res.status(400).json({ error: 'All fields are required.' });
    }
    const cleanEmail = String(email).toLowerCase().trim();
    const cleanPhone = String(phone).trim();
    if (!EMAIL_REGEX.test(cleanEmail)) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }
    if (!PHONE_REGEX.test(cleanPhone)) {
      return res.status(400).json({ error: 'A valid phone number is required.' });
    }
    if (!isValidAadhaarFormat(aadhaar)) {
      return res.status(400).json({ error: 'Aadhaar number must be exactly 12 digits.' });
    }
    if (String(passwordHash).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    if (!verificationToken) {
      return res.status(400).json({ error: 'Email verification is required before creating an account.' });
    }
    const verified = await Otp.findOne({ contactInfo: cleanEmail, otpCode: verificationToken, purpose: 'register_verified' });
    if (!verified) {
      return res.status(400).json({ error: 'Email verification is required or has expired. Please verify your email again.' });
    }
    if (verified.expiresAt < new Date()) {
      await Otp.deleteOne({ _id: verified._id });
      return res.status(400).json({ error: 'Email verification has expired. Please verify your email again.' });
    }
    if (await User.findOne({ email: cleanEmail })) {
      return res.status(400).json({ error: 'Email address already registered.' });
    }
    if (await User.findOne({ phone: cleanPhone })) {
      return res.status(400).json({ error: 'Phone number already registered.' });
    }
    const aadhaarHash = hashAadhaar(aadhaar);
    if (await User.findOne({ aadhaarHash })) {
      return res.status(400).json({ error: 'This Aadhaar number is already registered.' });
    }
    const lastUser = await User.findOne().sort({ _id: -1 });
    let nextNum = 1;
    if (lastUser && lastUser.customer_id) {
      const lastIdParts = lastUser.customer_id.split('_');
      const lastNum = parseInt(lastIdParts[1], 10);
      if (!isNaN(lastNum)) {
        nextNum = lastNum + 1;
      }
    }
    const generatedCustomerId = `CUST_${nextNum}`;
    const hashedPassword = await bcrypt.hash(passwordHash, 12);
    const newUser = await User.create({
      fullName,
      dob: new Date(dob),
      gender,
      email: cleanEmail,
      phone: cleanPhone,
      aadhaarHash,
      aadhaarLast4: aadhaarLast4(aadhaar),
      passwordHash: hashedPassword,
      customer_id: generatedCustomerId,
      subscription_plan: "",
      emailVerified: true
    });
    await Otp.deleteOne({ _id: verified._id });
    const token = signToken(newUser);
    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      token,
      data: {
        customer_id: newUser.customer_id,
        subscription_plan: newUser.subscription_plan
      }
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(400).json({ error: 'An account with these details already exists.' });
    }
    return sendServerError(res, err, 'register');
  }
});

router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    // Same generic message whether the account doesn't exist or the
    // password is wrong — this prevents an attacker from using the login
    // endpoint to discover which emails are registered.
    const genericError = { error: 'Incorrect email or password.' };
    if (!user) {
      return res.status(401).json(genericError);
    }
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json(genericError);
    }
    const token = signToken(user);
    res.status(200).json({
      success: true,
      token,
      user: { id: user._id, fullName: user.fullName, email: user.email }
    });
  } catch (err) {
    return sendServerError(res, err, 'login');
  }
});

router.post('/forgot-password/request', authLimiter, async (req, res) => {
  try {
    const { contactInfo } = req.body;
    if (!contactInfo || !contactInfo.trim()) {
      return res.status(400).json({ error: 'Email or phone number is required.' });
    }
    const cleanContact = contactInfo.toLowerCase().trim();
    const genericResponse = { success: true, message: 'If that account exists, a verification code has been sent.' };
    if (!cleanContact.includes('@')) {
      // Don't confirm/deny whether the phone number exists either.
      return res.status(200).json(genericResponse);
    }
    const user = await User.findOne({ email: cleanContact });
    if (!user) {
      return res.status(200).json(genericResponse);
    }
    const otpCode = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await Otp.deleteMany({ contactInfo: cleanContact, purpose: 'password_reset' });
    await Otp.create({ contactInfo: cleanContact, otpCode, expiresAt, purpose: 'password_reset' });
    try {
      await sendOtpEmail(cleanContact, otpCode, 'password_reset');
    } catch (mailErr) {
      console.error('[OTP] Failed to send email:', mailErr.message);
      await Otp.deleteMany({ contactInfo: cleanContact, purpose: 'password_reset' });
      return res.status(500).json({ error: 'Could not send verification email. Please try again in a moment.' });
    }
    res.status(200).json(genericResponse);
  } catch (err) {
    return sendServerError(res, err, 'forgot-password/request');
  }
});

router.post('/forgot-password/verify', otpLimiter, async (req, res) => {
  try {
    const { contactInfo, otpCode } = req.body;
    if (!contactInfo || !otpCode) {
      return res.status(400).json({ error: 'Contact info and code are required.' });
    }
    const match = await Otp.findOne({
      contactInfo: contactInfo.toLowerCase().trim(),
      otpCode,
      purpose: 'password_reset',
    });
    if (!match) {
      return res.status(400).json({ error: 'Invalid verification code.' });
    }
    if (match.expiresAt < new Date()) {
      await Otp.deleteOne({ _id: match._id });
      return res.status(400).json({ error: 'This code has expired. Please request a new one.' });
    }
    res.status(200).json({ success: true });
  } catch (err) {
    return sendServerError(res, err, 'forgot-password/verify');
  }
});

router.post('/forgot-password/reset', authLimiter, async (req, res) => {
  try {
    const { contactInfo, otpCode, newPassword } = req.body;
    if (!contactInfo || !otpCode || !newPassword) {
      return res.status(400).json({ error: 'Contact info, verification code and new password are required.' });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    const cleanContact = contactInfo.toLowerCase().trim();
    const match = await Otp.findOne({ contactInfo: cleanContact, otpCode, purpose: 'password_reset' });
    if (!match) {
      return res.status(400).json({ error: 'Invalid or already-used verification code.' });
    }
    if (match.expiresAt < new Date()) {
      await Otp.deleteOne({ _id: match._id });
      return res.status(400).json({ error: 'This code has expired. Please request a new one.' });
    }
    const hashedNewPassword = await bcrypt.hash(newPassword, 12);
    await User.updateMany(
      { $or: [{ email: cleanContact }, { phone: cleanContact }] },
      { $set: { passwordHash: hashedNewPassword } }
    );
    await Otp.deleteMany({ contactInfo: cleanContact, purpose: 'password_reset' });
    res.status(200).json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    return sendServerError(res, err, 'forgot-password/reset');
  }
});

// --- Everything below here requires a valid session token. Identity is
// always taken from the verified token (req.userId), never from a
// client-supplied email/id. ---

router.post('/set-pin', requireAuth, authLimiter, async (req, res) => {
  try {
    const { password, pin } = req.body;
    if (!password || !pin) {
      return res.status(400).json({ error: 'Current password and pin are required.' });
    }
    if (!/^\d{4,6}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be 4 to 6 digits.' });
    }
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'Account not found.' });
    }
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }
    user.pinHash = await bcrypt.hash(pin, 12);
    user.pinEnabled = true;
    await user.save();
    res.status(200).json({ success: true, message: '2FA PIN saved successfully.', pinEnabled: true });
  } catch (err) {
    return sendServerError(res, err, 'set-pin');
  }
});

router.post('/verify-pin', requireAuth, authLimiter, async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) {
      return res.status(400).json({ error: 'Pin is required.' });
    }
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'Account not found.' });
    }
    if (!user.pinEnabled || !user.pinHash) {
      return res.status(200).json({ success: true, valid: true });
    }
    const isMatch = await bcrypt.compare(pin, user.pinHash);
    return res.status(200).json({ success: isMatch, valid: isMatch });
  } catch (err) {
    return sendServerError(res, err, 'verify-pin');
  }
});

router.post('/remove-pin', requireAuth, authLimiter, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Current password is required.' });
    }
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'Account not found.' });
    }
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }
    user.pinHash = null;
    user.pinEnabled = false;
    await user.save();
    res.status(200).json({ success: true, message: '2FA PIN removed successfully.', pinEnabled: false });
  } catch (err) {
    return sendServerError(res, err, 'remove-pin');
  }
});

router.get('/pin-status', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'Account not found.' });
    }
    res.status(200).json({ success: true, pinEnabled: !!user.pinEnabled });
  } catch (err) {
    return sendServerError(res, err, 'pin-status');
  }
});

router.get('/profile', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'Account not found.' });
    }
    res.status(200).json({
      success: true,
      user: {
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        dob: user.dob,
        gender: user.gender,
        aadhaar: `XXXX-XXXX-${user.aadhaarLast4}`,
        customer_id: user.customer_id,
        subscription_plan: user.subscription_plan,
      },
    });
  } catch (err) {
    return sendServerError(res, err, 'profile');
  }
});

module.exports = router;
