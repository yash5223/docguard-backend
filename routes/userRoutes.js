const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Otp = require('../models/Otp');

const router = express.Router();

// 1. REGISTER A NEW USER
router.post('/register', async (req, res) => {
  try {
    const { fullName, dob, gender, email, phone, aadhaar, passwordHash } = req.body;

    // Check unique constraints explicitly and return uniform JSON wrappers
    if (await User.findOne({ email: email.toLowerCase().trim() })) {
      return res.status(400).json({ error: 'Email address already registered.' });
    }
    if (await User.findOne({ phone: phone.trim() })) {
      return res.status(400).json({ error: 'Phone number already registered.' });
    }
    if (await User.findOne({ aadhaar: aadhaar.trim() })) {
      return res.status(400).json({ error: 'Aadhaar card number already registered.' });
    }

    // Safe Sequential Auto-Increment Logic for Custom Customer IDs
    // Find the latest user sorted by descending database creation order
    const lastUser = await User.findOne().sort({ _id: -1 });
    
    let nextNum = 1;
    if (lastUser && lastUser.customer_id) {
      // Split the string prefix by the underscore to extract the numerical suffix
      const lastIdParts = lastUser.customer_id.split('_');
      const lastNum = parseInt(lastIdParts[1], 10);
      if (!isNaN(lastNum)) {
        nextNum = lastNum + 1;
      }
    }
    const generatedCustomerId = `CUST_${nextNum}`;

    // Encrypt password natively
    const hashedPassword = await bcrypt.hash(passwordHash, 10);

    // Create new User record incorporating new architecture properties
    const newUser = await User.create({
      fullName,
      dob: new Date(dob),
      gender,
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      aadhaar: aadhaar.trim(),
      passwordHash: hashedPassword,
      customer_id: generatedCustomerId, // Injected unique customer_id property
      subscription_plan: ""             // Injected initial empty baseline configuration
    });

    res.status(201).json({ 
      success: true, 
      message: 'Account created successfully',
      data: {
        customer_id: newUser.customer_id,
        subscription_plan: newUser.subscription_plan
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. LOGIN USER
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    
    if (!user) {
      return res.status(444).json({ error: 'No account found with this email.' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Incorrect password.' });
    }

    res.status(200).json({
      success: true,
      user: { id: user._id, fullName: user.fullName, email: user.email }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. FORGOT PASSWORD - REQUEST OTP
router.post('/forgot-password/request', async (req, res) => {
  try {
    const { contactInfo } = req.body;
    const cleanContact = contactInfo.toLowerCase().trim();

    const user = await User.findOne({
      $or: [{ email: cleanContact }, { phone: cleanContact }]
    });

    if (!user) {
      return res.status(444).json({ error: 'No account associated with that contact.' });
    }

    const otpCode = "123456"; 
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); 

    await Otp.create({ contactInfo: cleanContact, otpCode, expiresAt });
    res.status(200).json({ success: true, message: 'Verification code generated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. FORGOT PASSWORD - VERIFY OTP
router.post('/forgot-password/verify', async (req, res) => {
  try {
    const { contactInfo, otpCode } = req.body;
    const match = await Otp.findOne({
      contactInfo: contactInfo.toLowerCase().trim(),
      otpCode: otpCode
    });

    if (!match) {
      return res.status(400).json({ error: 'Invalid verification code.' });
    }
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. FORGOT PASSWORD - RESET PASS
router.post('/forgot-password/reset', async (req, res) => {
  try {
    const { contactInfo, newPassword } = req.body;
    const cleanContact = contactInfo.toLowerCase().trim();
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    await User.updateMany(
      { $or: [{ email: cleanContact }, { phone: cleanContact }] },
      { $set: { passwordHash: hashedNewPassword } }
    );

    res.status(200).json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. SET / UPDATE 2FA PIN
router.post('/set-pin', async (req, res) => {
  try {
    const { email, password, pin } = req.body;
    if (!email || !password || !pin) {
      return res.status(400).json({ error: 'Email, password and pin are required.' });
    }
    if (!/^\d{4,6}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be 4 to 6 digits.' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(444).json({ error: 'No account found with this email.' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Incorrect password.' });
    }

    const hashedPin = await bcrypt.hash(pin, 10);
    user.pinHash = hashedPin;
    user.pinEnabled = true;
    await user.save();

    res.status(200).json({ success: true, message: '2FA PIN saved successfully.', pinEnabled: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. VERIFY 2FA PIN
router.post('/verify-pin', async (req, res) => {
  try {
    const { email, pin } = req.body;
    if (!email || !pin) {
      return res.status(400).json({ error: 'Email and pin are required.' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(444).json({ error: 'No account found with this email.' });
    }

    if (!user.pinEnabled || !user.pinHash) {
      return res.status(200).json({ success: true, valid: true });
    }

    const isMatch = await bcrypt.compare(pin, user.pinHash);
    if (!isMatch) {
      return res.status(200).json({ success: false, valid: false });
    }

    res.status(200).json({ success: true, valid: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. REMOVE 2FA PIN
router.post('/remove-pin', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(444).json({ error: 'No account found with this email.' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Incorrect password.' });
    }

    user.pinHash = null;
    user.pinEnabled = false;
    await user.save();

    res.status(200).json({ success: true, message: '2FA PIN removed successfully.', pinEnabled: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. FETCH 2FA PIN STATUS
router.get('/pin-status', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(444).json({ error: 'No account found with this email.' });
    }

    res.status(200).json({ success: true, pinEnabled: !!user.pinEnabled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;