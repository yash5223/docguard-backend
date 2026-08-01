const mongoose = require('mongoose');

const serviceRecordSchema = new mongoose.Schema(
  {
    title: { type: String, default: '' },
    date: { type: Date },
    cost: { type: Number, default: 0 },
    notes: { type: String, default: '-' },
  },
  { _id: false }
);

const assetSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },

    // Always present, regardless of document type
    name: { type: String, required: true },
    category: { type: String, required: true },
    subCategory: { type: String, required: true },
    subSubCategory: { type: String, default: '' },
    documentType: { type: String, required: true },
    issueDate: { type: Date },
    notesOrAddress: { type: String, default: '' },
    storeOrSeller: { type: String, default: '' },

    // Dynamic fields — only the ones relevant to `documentType` get a real
    // value when an asset is saved (see config/documentFieldTemplates.js).
    // Every other key below is explicitly stored as '' so every document
    // in the collection has the same flat, predictable shape.
    documentNumber: { type: String, default: '' },
    issuingAuthority: { type: String, default: '' },
    expiryDate: { type: String, default: '' },
    valueAmount: { type: String, default: '' },
    invoiceNumber: { type: String, default: '' },

    documents: { type: [String], default: [] },
    serviceRecords: { type: [serviceRecordSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Asset', assetSchema);