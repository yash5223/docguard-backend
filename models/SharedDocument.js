const mongoose = require('mongoose');

const SharedDocumentSchema = new mongoose.Schema(
  {
    ownerCustomerId: { type: String, required: true, index: true },
    ownerName: { type: String, default: '' },
    ownerEmail: { type: String, default: '' },

    receiverCustomerId: { type: String, default: null, index: true },
    receiverEmail: { type: String, required: true, lowercase: true, trim: true, index: true },
    receiverName: { type: String, default: '' },

    assetId: { type: String, required: true },
    documentPath: { type: String, required: true },
    documentName: { type: String, default: '' },

    category: { type: String, default: '' },
    subCategory: { type: String, default: '' },
    subSubCategory: { type: String, default: '' },

    // Snapshot of the asset's document-detail fields at the time of sharing,
    // so the receiver can see the full "Database Information" for the
    // document (issue date, notes/address, value, etc.) without needing
    // access to the owner's asset record.
    issueDate: { type: Date, default: null },
    notesOrAddress: { type: String, default: '' },
    storeOrSeller: { type: String, default: '' },
    documentNumber: { type: String, default: '' },
    issuingAuthority: { type: String, default: '' },
    expiryDate: { type: String, default: '' },
    valueAmount: { type: String, default: '' },
    invoiceNumber: { type: String, default: '' },

    status: { type: String, enum: ['active', 'revoked'], default: 'active', index: true },
    sharedAt: { type: Date, default: Date.now },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Prevent the exact same document from being shared to the same receiver twice
SharedDocumentSchema.index(
  { ownerCustomerId: 1, receiverEmail: 1, assetId: 1, documentPath: 1 },
  { unique: true }
);

module.exports = mongoose.model('SharedDocument', SharedDocumentSchema);