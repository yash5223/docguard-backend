const mongoose = require('mongoose');

const VaultMemberSchema = new mongoose.Schema({
  // customer_id of the vault being shared
  ownerCustomerId: { type: String, required: true },
  // customer_id of the person who joined the vault
  memberCustomerId: { type: String, required: true },
  memberEmail: { type: String, required: true, lowercase: true, trim: true },
  memberName: { type: String, default: '' },
  role: { type: String, enum: ['view', 'edit', 'admin'], default: 'view' },
  joinedAt: { type: Date, default: Date.now }
});

// A person can only hold one membership per vault
VaultMemberSchema.index({ ownerCustomerId: 1, memberCustomerId: 1 }, { unique: true });

module.exports = mongoose.model('VaultMember', VaultMemberSchema);
