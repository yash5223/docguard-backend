const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  dob: { type: Date, required: true },
  gender: { type: String, required: true, enum: ['Male', 'Female', 'Other'] },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, required: true, unique: true, trim: true },
  aadhaar: { type: String, required: true, unique: true, trim: true },
  passwordHash: { type: String, required: true }, 
  // Keeps existing subscription_plan field as it is
  subscription_plan: { type: String, default: ""  },
  // Added custom unique sequential ID field
  customer_id: { type: String, unique: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema, 'users');