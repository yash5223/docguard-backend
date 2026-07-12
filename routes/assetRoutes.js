const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const router = express.Router();
const User = require('../models/User');
const Asset = require('../models/Asset');
const { uploadBufferToCloudinary, deleteFromCloudinaryByUrl } = require('../utils/cloudinary');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
router.post('/save-asset', upload.array('images', 10), async (expressRequest, expressResponse) => {
  try {
    const { email, password } = expressRequest.body;
    if (!expressRequest.body.assetData) {
      return expressResponse.status(400).json({ error: 'Asset parameters are missing.' });
    }
    const assetData = JSON.parse(expressRequest.body.assetData);
    if (!email || !password) {
      return expressResponse.status(401).json({ error: 'Authentication credentials required.' });
    }
    const userMatch = await User.findOne({ email: email.toLowerCase().trim() });
    if (!userMatch) {
      return expressResponse.status(401).json({ error: 'Invalid user account credentials.' });
    }
    const isPasswordValid = await bcrypt.compare(password, userMatch.passwordHash);
    if (!isPasswordValid) {
      return expressResponse.status(401).json({ error: 'Invalid user account credentials.' });
    }
    const assetDocuments = [];
    const uploadedFiles = expressRequest.files || [];
    if (uploadedFiles.length > 0) {
      const sanitizedAssetName = assetData.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      const timestamp = Date.now();
      for (let i = 0; i < uploadedFiles.length; i++) {
        const fileIndex = String(i + 1).padStart(2, '0');
        const publicId = `${userMatch.customer_id}_${sanitizedAssetName}_${fileIndex}_${timestamp}`;
        const secureUrl = await uploadBufferToCloudinary(uploadedFiles[i].buffer, publicId);
        assetDocuments.push(secureUrl);
      }
    }
    // Category-specific spec fields sent by the client with proper, descriptive
    // names (e.g. modelNumber, serialNumber) instead of generic specField1/specField2.
    // Only the pair relevant to assetData.category will actually be populated,
    // but we accept any of them defensively.
    const newAsset = new Asset({
      userId: userMatch.customer_id,
      name: assetData.name,
      category: assetData.category,
      subCategory: assetData.subCategory,
      brandOrDeveloper: assetData.brandOrDeveloper,
      storeOrSeller: assetData.storeOrSeller,
      purchaseOrRegDate: assetData.purchaseOrRegDate ? new Date(assetData.purchaseOrRegDate) : null,
      valueAmount: parseFloat(assetData.valueAmount) || 0,
      invoiceOrDeedNumber: assetData.invoiceOrDeedNumber,
      warrantyExpiry: assetData.warrantyExpiry ? new Date(assetData.warrantyExpiry) : null,
      notesOrAddress: assetData.notesOrAddress,
      // Property
      builtUpArea: assetData.builtUpArea || '',
      reraKhataNumber: assetData.reraKhataNumber || '',
      // Vehicles
      registrationNumber: assetData.registrationNumber || '',
      mileage: assetData.mileage || '',
      // Gadgets / Electronics
      modelNumber: assetData.modelNumber || '',
      serialNumber: assetData.serialNumber || '',
      // Jewelry
      caratPurity: assetData.caratPurity || '',
      weightMaterial: assetData.weightMaterial || '',
      // Furniture
      dimensions: assetData.dimensions || '',
      materialType: assetData.materialType || '',
      // Other
      customAttribute1: assetData.customAttribute1 || '',
      customAttribute2: assetData.customAttribute2 || '',
      documents: assetDocuments
    });
    await newAsset.save();
    return expressResponse.status(201).json({ success: true, message: 'Asset successfully saved to vault.' });
  } catch (serverError) {
    return expressResponse.status(500).json({ error: serverError.message });
  }
});
router.post('/append-document', upload.single('image'), async (req, res) => {
  try {
    const { assetId, email } = req.body;
    if (!req.file || !assetId || !email) {
      return res.status(400).json({ error: 'Missing parameters or file data.' });
    }
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    const asset = await Asset.findById(assetId);
    if (!user || !asset) {
      return res.status(404).json({ error: 'Asset parameters not found.' });
    }
    const currentCount = asset.documents ? asset.documents.length : 0;
    const nextIndex = String(currentCount + 1).padStart(2, '0');
    const sanitizedName = asset.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const publicId = `${user.customer_id}_${sanitizedName}_${nextIndex}_${Date.now()}`;
    const secureUrl = await uploadBufferToCloudinary(req.file.buffer, publicId);
    asset.documents = asset.documents || [];
    asset.documents.push(secureUrl);
    await asset.save();
    return res.status(200).json({ success: true, documents: asset.documents });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
router.delete('/delete-document', async (req, res) => {
  try {
    const { assetId, filename } = req.body;
    if (!assetId || !filename) {
      return res.status(400).json({ error: 'Asset ID and filename are required parameters.' });
    }
    const asset = await Asset.findById(assetId);
    if (!asset) {
      return res.status(404).json({ error: 'Asset record not found.' });
    }
    asset.documents = asset.documents.filter(doc => doc !== filename);
    await asset.save();
    await deleteFromCloudinaryByUrl(filename);
    return res.status(200).json({ success: true, documents: asset.documents });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
router.get('/dashboard-summary', async (expressRequest, expressResponse) => {
  try {
    const { email } = expressRequest.query;
    if (!email) {
      return expressResponse.status(400).json({ error: 'Email parameter is required.' });
    }
    const userMatch = await User.findOne({ email: email.toLowerCase().trim() });
    if (!userMatch) {
      return expressResponse.status(404).json({ error: 'User account profile not found.' });
    }
    const userAssets = await Asset.find({ userId: userMatch.customer_id });
    let totalValue = 0;
    let activeCount = 0;
    let expiredCount = 0;
    const rightNow = new Date();
    userAssets.forEach(asset => {
      totalValue += asset.valueAmount || 0;
      if (asset.category === 'Property') {
        activeCount++;
      } else if (asset.warrantyExpiry) {
        const expiryDate = new Date(asset.warrantyExpiry);
        if (expiryDate >= rightNow) {
          activeCount++;
        } else {
          expiredCount++;
        }
      } else {
        activeCount++;
      }
    });
    return expressResponse.status(200).json({
      success: true,
      metrics: {
        totalAssets: userAssets.length,
        totalValue: Math.round(totalValue),
        activeAssets: activeCount,
        expiredAssets: expiredCount
      }
    });
  } catch (serverError) {
    return expressResponse.status(500).json({ error: serverError.message });
  }
});
router.post('/append-service-record', async (req, res) => {
  try {
    const { assetId, title, date, cost, notes } = req.body;
    if (!assetId || !title || !date || !cost) {
      return res.status(400).json({ error: 'Missing mandatory record parameters.' });
    }
    const asset = await Asset.findById(assetId);
    if (!asset) {
      return res.status(404).json({ error: 'Target asset record not found.' });
    }
    asset.serviceRecords = asset.serviceRecords || [];
    asset.serviceRecords.push({
      title,
      date: new Date(date),
      cost: parseFloat(cost) || 0,
      notes: notes || '-'
    });
    await asset.save();
    return res.status(200).json({ success: true, serviceRecords: asset.serviceRecords });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
router.delete('/delete-asset/:id', async (req, res) => {
  try {
    const assetId = req.params.id;
    const asset = await Asset.findById(assetId);
    if (!asset) {
      return res.status(404).json({ error: 'Asset record not found.' });
    }
    const filesToDelete = asset.documents || [];
    await Promise.all(filesToDelete.map(filename => deleteFromCloudinaryByUrl(filename)));
    await Asset.findByIdAndDelete(assetId);
    return res.status(200).json({ success: true, message: 'Asset and all associated files deleted successfully.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
router.get('/fetch-assets', async (expressRequest, expressResponse) => {
  try {
    const { email, search } = expressRequest.query;
    if (!email) {
      return expressResponse.status(400).json({ error: 'Email parameter is required.' });
    }
    const userMatch = await User.findOne({ email: email.toLowerCase().trim() });
    if (!userMatch) {
      return expressResponse.status(404).json({ error: 'User account profile not found.' });
    }
    let queryConditions = { userId: userMatch.customer_id };
    if (search && search.trim() !== '') {
      const searchRegex = new RegExp(search.trim(), 'i');
      queryConditions.$or = [
        { name: searchRegex },
        { brandOrDeveloper: searchRegex }
      ];
    }
    const userAssets = await Asset.find(queryConditions).sort({ createdAt: -1 });
    return expressResponse.status(200).json({
      success: true,
      assets: userAssets
    });
  } catch (serverError) {
    return expressResponse.status(500).json({ error: serverError.message });
  }
});
module.exports = router;
