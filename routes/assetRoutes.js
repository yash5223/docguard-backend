const express = require('express');
const multer = require('multer');
const router = express.Router();
const User = require('../models/User');
const Asset = require('../models/Asset');
const { buildDynamicFields } = require('../config/documentFieldTemplates');
const { uploadBufferToCloudinary, deleteFromCloudinaryByUrl } = require('../utils/cloudinary');
const { createAlert, checkExpiryAlerts } = require('./alertRoutes');
const { requireAuth } = require('../utils/auth');
const { sendServerError } = require('../utils/errors');

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']);
function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return cb(new Error('Unsupported file type. Only images and PDFs are allowed.'));
  }
  cb(null, true);
}
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter,
});

// Every route below requires a valid session token. `req.customerId` comes
// from the verified token, never from the client — so a request can only
// ever touch assets that belong to the caller's own account.
router.use(requireAuth);

router.post('/save-asset', upload.array('images', 10), async (req, res) => {
  try {
    if (!req.body.assetData) {
      return res.status(400).json({ error: 'Asset parameters are missing.' });
    }
    const assetData = JSON.parse(req.body.assetData);
    const userMatch = await User.findById(req.userId);
    if (!userMatch) {
      return res.status(404).json({ error: 'Account not found.' });
    }
    const assetDocuments = [];
    const uploadedFiles = req.files || [];
    if (uploadedFiles.length > 0) {
      const sanitizedAssetName = String(assetData.name || 'document').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      const timestamp = Date.now();
      for (let i = 0; i < uploadedFiles.length; i++) {
        const fileIndex = String(i + 1).padStart(2, '0');
        const publicId = `${userMatch.customer_id}_${sanitizedAssetName}_${fileIndex}_${timestamp}`;
        const secureUrl = await uploadBufferToCloudinary(uploadedFiles[i].buffer, publicId);
        assetDocuments.push(secureUrl);
      }
    }
    const documentTypeValue = assetData.subSubCategory || assetData.documentType || '';
    const dynamicFields = buildDynamicFields(documentTypeValue, assetData);
    const issueDateValue = assetData.issueDate;
    const storeOrSellerValue = assetData.storeOrSeller || '';
    const editAssetId = assetData._id || assetData.id;
    const isEdit = Boolean(editAssetId);

    const assetFields = {
      userId: userMatch.customer_id,
      name: assetData.name,
      category: assetData.category,
      subCategory: assetData.subCategory,
      subSubCategory: documentTypeValue,
      issueDate: issueDateValue ? new Date(issueDateValue) : null,
      notesOrAddress: assetData.notesOrAddress || '',
      storeOrSeller: storeOrSellerValue,
      ...dynamicFields,
    };
    if (assetDocuments.length > 0) {
      assetFields.documents = assetDocuments;
    }

    let savedAsset;
    if (isEdit) {
      // Scoping by userId here is what stops one account from editing
      // another account's asset by guessing/enumerating an _id.
      savedAsset = await Asset.findOneAndUpdate(
        { _id: editAssetId, userId: userMatch.customer_id },
        { $set: assetFields },
        { new: true, runValidators: true }
      );
      if (!savedAsset) {
        return res.status(404).json({ error: 'Asset to update was not found.' });
      }
      if (assetDocuments.length > 0) {
        savedAsset.documents = [...(savedAsset.documents || []), ...assetDocuments];
        await savedAsset.save();
      }
    } else {
      savedAsset = new Asset({ ...assetFields, documents: assetDocuments });
      await savedAsset.save();
    }

    await createAlert({
      title: isEdit ? 'Document Updated' : 'Document Added',
      message: isEdit
        ? `"${savedAsset.name}" was updated in your vault.`
        : `"${savedAsset.name}" was added to your vault.`,
      type: 'success',
      priority: 'low',
      sent_by: userMatch.fullName || userMatch.email,
      sent_to: userMatch.customer_id,
    });
    return res.status(201).json({ success: true, message: 'Asset successfully saved to vault.', asset: savedAsset });
  } catch (err) {
    return sendServerError(res, err, 'save-asset');
  }
});

router.post('/append-document', upload.single('image'), async (req, res) => {
  try {
    const { assetId } = req.body;
    if (!req.file || !assetId) {
      return res.status(400).json({ error: 'Missing parameters or file data.' });
    }
    const user = await User.findById(req.userId);
    // Ownership check: the asset must belong to the caller.
    const asset = await Asset.findOne({ _id: assetId, userId: req.customerId });
    if (!user || !asset) {
      return res.status(404).json({ error: 'Asset not found.' });
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
    return sendServerError(res, err, 'append-document');
  }
});

router.delete('/delete-document', async (req, res) => {
  try {
    const { assetId, filename } = req.body;
    if (!assetId || !filename) {
      return res.status(400).json({ error: 'Asset ID and filename are required parameters.' });
    }
    // This route used to have NO ownership check at all — any caller who
    // knew an assetId could delete any file from any user's asset.
    const asset = await Asset.findOne({ _id: assetId, userId: req.customerId });
    if (!asset) {
      return res.status(404).json({ error: 'Asset record not found.' });
    }
    asset.documents = asset.documents.filter(doc => doc !== filename);
    await asset.save();
    await deleteFromCloudinaryByUrl(filename);
    return res.status(200).json({ success: true, documents: asset.documents });
  } catch (err) {
    return sendServerError(res, err, 'delete-document');
  }
});

router.get('/dashboard-summary', async (req, res) => {
  try {
    const userMatch = await User.findById(req.userId);
    if (!userMatch) {
      return res.status(404).json({ error: 'Account not found.' });
    }
    const userAssets = await Asset.find({ userId: userMatch.customer_id });
    await checkExpiryAlerts(userMatch, userAssets);
    let totalValue = 0;
    let activeCount = 0;
    let expiredCount = 0;
    const rightNow = new Date();
    userAssets.forEach(asset => {
      totalValue += asset.valueAmount || 0;
      if (asset.category === 'Property') {
        activeCount++;
      } else if (asset.expiryDate) {
        const expiryDate = new Date(asset.expiryDate);
        if (!isNaN(expiryDate.getTime()) && expiryDate < rightNow) {
          expiredCount++;
        } else {
          activeCount++;
        }
      } else {
        activeCount++;
      }
    });
    return res.status(200).json({
      success: true,
      metrics: {
        totalAssets: userAssets.length,
        totalValue: Math.round(totalValue),
        activeAssets: activeCount,
        expiredAssets: expiredCount
      }
    });
  } catch (err) {
    return sendServerError(res, err, 'dashboard-summary');
  }
});

router.post('/append-service-record', async (req, res) => {
  try {
    const { assetId, title, date, cost, notes } = req.body;
    if (!assetId || !title || !date || !cost) {
      return res.status(400).json({ error: 'Missing mandatory record parameters.' });
    }
    const asset = await Asset.findOne({ _id: assetId, userId: req.customerId });
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
    return sendServerError(res, err, 'append-service-record');
  }
});

router.put('/edit-service-record', async (req, res) => {
  try {
    const { assetId, recordId, title, date, cost, notes } = req.body;
    if (!assetId || !recordId || !title || !date || !cost) {
      return res.status(400).json({ error: 'Missing mandatory record parameters.' });
    }
    const asset = await Asset.findOne({ _id: assetId, userId: req.customerId });
    if (!asset) {
      return res.status(404).json({ error: 'Target asset record not found.' });
    }
    const record = asset.serviceRecords.id(recordId);
    if (!record) {
      return res.status(404).json({ error: 'Service record not found.' });
    }
    record.title = title;
    record.date = new Date(date);
    record.cost = parseFloat(cost) || 0;
    record.notes = notes || '-';
    await asset.save();
    return res.status(200).json({ success: true, serviceRecords: asset.serviceRecords });
  } catch (err) {
    return sendServerError(res, err, 'edit-service-record');
  }
});

router.delete('/delete-service-record', async (req, res) => {
  try {
    const { assetId, recordId } = req.body;
    if (!assetId || !recordId) {
      return res.status(400).json({ error: 'Asset ID and record ID are required parameters.' });
    }
    const asset = await Asset.findOne({ _id: assetId, userId: req.customerId });
    if (!asset) {
      return res.status(404).json({ error: 'Target asset record not found.' });
    }
    const record = asset.serviceRecords.id(recordId);
    if (!record) {
      return res.status(404).json({ error: 'Service record not found.' });
    }
    record.deleteOne();
    await asset.save();
    return res.status(200).json({ success: true, serviceRecords: asset.serviceRecords });
  } catch (err) {
    return sendServerError(res, err, 'delete-service-record');
  }
});

router.delete('/delete-asset/:id', async (req, res) => {
  try {
    const assetId = req.params.id;
    // This route used to delete ANY asset by id with no ownership check.
    const asset = await Asset.findOne({ _id: assetId, userId: req.customerId });
    if (!asset) {
      return res.status(404).json({ error: 'Asset record not found.' });
    }
    const filesToDelete = asset.documents || [];
    await Promise.all(filesToDelete.map(filename => deleteFromCloudinaryByUrl(filename)));
    await Asset.deleteOne({ _id: asset._id });
    await createAlert({
      title: 'Document Deleted',
      message: `"${asset.name}" was removed from your vault.`,
      type: 'warning',
      priority: 'medium',
      sent_by: 'System',
      sent_to: asset.userId,
    });
    return res.status(200).json({ success: true, message: 'Asset and all associated files deleted successfully.' });
  } catch (err) {
    return sendServerError(res, err, 'delete-asset');
  }
});

router.get('/fetch-assets', async (req, res) => {
  try {
    const { search } = req.query;
    const userMatch = await User.findById(req.userId);
    if (!userMatch) {
      return res.status(404).json({ error: 'Account not found.' });
    }
    let queryConditions = { userId: userMatch.customer_id };
    if (search && search.trim() !== '') {
      const searchRegex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      queryConditions.$or = [
        { name: searchRegex },
        { subSubCategory: searchRegex },
        { storeOrSeller: searchRegex }
      ];
    }
    const userAssets = await Asset.find(queryConditions).sort({ createdAt: -1 });
    await checkExpiryAlerts(userMatch, userAssets);
    return res.status(200).json({
      success: true,
      assets: userAssets
    });
  } catch (err) {
    return sendServerError(res, err, 'fetch-assets');
  }
});

module.exports = router;
