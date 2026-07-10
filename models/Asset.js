const mongoose = require('mongoose');

const ServiceRecordSchema = new mongoose.Schema({
  title: { type: String, required: true },
  date: { type: Date, required: true },
  cost: { type: Number, required: true },
  notes: { type: String, default: '-' }
});

const AssetSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  name: { type: String, required: true },
  category: { type: String, required: true },
  subCategory: { type: String, default: '' },
  brandOrDeveloper: { type: String, default: '' },
  storeOrSeller: { type: String, default: '' },
  purchaseOrRegDate: { type: Date },
  valueAmount: { type: Number, default: 0 },
  invoiceOrDeedNumber: { type: String, default: '' },
  warrantyExpiry: { type: Date },
  notesOrAddress: { type: String, default: '' },
  specField1: { type: String, default: '' },
  specField2: { type: String, default: '' },
  documents: [{ type: String }],
  serviceRecords: [ServiceRecordSchema], // 🛠️ ADDED: Array definition matching your screen log
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Asset', AssetSchema);