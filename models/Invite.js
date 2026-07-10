const mongoose = require('mongoose');

const InviteSchema = new mongoose.Schema({
  // customer_id of the vault owner who created this invite
  ownerCustomerId: { type: String, required: true },
  // Unguessable random token used in the shareable join link
  token: { type: String, required: true, unique: true },
  role: { type: String, enum: ['view', 'edit', 'admin'], default: 'view' },
  status: { type: String, enum: ['pending', 'accepted', 'revoked'], default: 'pending' },
  // Filled in once someone accepts the invite
  acceptedByCustomerId: { type: String, default: null },
  acceptedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Invite', InviteSchema);
