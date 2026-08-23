const mongoose = require('mongoose');
const userSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  dob: { type: Date, required: true },
  gender: { type: String, required: true, enum: ['Male', 'Female', 'Other'] },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, required: true, unique: true, trim: true },
  // The full Aadhaar number is never stored. `aadhaarHash` is a keyed hash
  // used only to enforce "one account per Aadhaar" and to look it up; it
  // cannot be reversed back into the original number. `aadhaarLast4` is
  // kept in plaintext purely for display ("XXXX-XXXX-1234") since the last
  // 4 digits alone aren't sensitive.
  aadhaarHash: { type: String, required: true, unique: true },
  aadhaarLast4: { type: String, required: true },
  passwordHash: { type: String, required: true },
  emailVerified: { type: Boolean, default: false },
  subscription_plan: { type: String, default: "" },
  customer_id: { type: String, unique: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  pinHash: { type: String, default: null },
  pinEnabled: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('User', userSchema, 'users');
