const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  contactInfo: { type: String, required: true, lowercase: true, trim: true },
  otpCode: { type: String, required: true },
  expiresAt: { type: Date, required: true }
});

module.exports = mongoose.model('Otp', otpSchema, 'password_resets');