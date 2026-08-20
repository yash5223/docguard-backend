const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/User');
const Asset = require('../models/Asset');
const { generateReply, generateAssetSummary, generateWarrantyClaimEmail } = require('../utils/aiEngine');
router.post('/chat', async (req, res) => {
  try {
    const { email, message } = req.body;
    if (!email || !message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Email and valid message are required.' });
    }
    const userMatch = await User.findOne({ email: email.toLowerCase().trim() });
    if (!userMatch) {
      return res.status(404).json({ error: 'User account not found.' });
    }
    const assets = await Asset.find({ userId: userMatch.customer_id }).lean();
    const reply = generateReply(message.trim(), assets);
    return res.status(200).json({ success: true, reply });
  } catch (err) {
    console.error("AI Chat Error:", err);
    return res.status(500).json({ error: 'Internal server error during chat processing.' });
  }
});
router.post('/summary', async (req, res) => {
  console.log("DEBUG: Incoming request body:", JSON.stringify(req.body));
  try {
    const { email, assetId } = req.body;
    const cleanEmail = email ? email.toLowerCase().trim() : null;
    const cleanId = assetId ? assetId.trim() : null;
    if (!cleanEmail || !cleanId) {
      return res.status(400).json({ error: 'Email and assetId are required.' });
    }
    if (!mongoose.Types.ObjectId.isValid(cleanId)) {
      return res.status(400).json({ error: 'Invalid asset ID format.' });
    }
    const userMatch = await User.findOne({ email: cleanEmail });
    if (!userMatch) {
      return res.status(404).json({ error: 'User account not found.' });
    }
    const asset = await Asset.findOne({ 
        _id: new mongoose.Types.ObjectId(cleanId), 
        userId: userMatch.customer_id 
    }).lean();
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found or access denied.' });
    }
    const summary = generateAssetSummary(asset);
    return res.status(200).json({ success: true, summary });
  } catch (err) {
    console.error("AI Summary Route Error:", err);
    return res.status(500).json({ error: 'Internal server error while generating summary.' });
  }
});
router.post('/warranty-email', async (req, res) => {
  try {
    const { email, assetId } = req.body;
    const cleanEmail = email ? email.toLowerCase().trim() : null;
    const cleanId = assetId ? assetId.trim() : null;
    if (!cleanEmail || !cleanId) {
      return res.status(400).json({ error: 'Email and assetId are required.' });
    }
    if (!mongoose.Types.ObjectId.isValid(cleanId)) {
      return res.status(400).json({ error: 'Invalid asset ID format.' });
    }
    const userMatch = await User.findOne({ email: cleanEmail });
    if (!userMatch) {
      return res.status(404).json({ error: 'User account not found.' });
    }
    const asset = await Asset.findOne({
        _id: new mongoose.Types.ObjectId(cleanId),
        userId: userMatch.customer_id
    }).lean();
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found or access denied.' });
    }
    const { subject, body } = generateWarrantyClaimEmail(asset, userMatch);
    return res.status(200).json({ success: true, subject, body });
  } catch (err) {
    console.error("AI Warranty Email Route Error:", err);
    return res.status(500).json({ error: 'Internal server error while generating warranty claim email.' });
  }
});
module.exports = router;