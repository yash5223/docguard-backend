const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const router = express.Router();
const User = require('../models/User');
const Invite = require('../models/Invite');
const VaultMember = require('../models/VaultMember');
const Asset = require('../models/Asset');
const SharedDocument = require('../models/SharedDocument');
const { createAlert } = require('./alertRoutes');
const INVITE_EXPIRY_DAYS = 7;
function buildInviteLink(token, req) {
  const configuredBase = process.env.JOIN_LINK_BASE;
  if (configuredBase) {
    return `${configuredBase.replace(/\/+$/, '')}/${token}`;
  }
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.get('host');
  return `${protocol}://${host}/join/${token}`;
}
function serializeInvite(invite, req) {
  return {
    id: invite._id,
    token: invite.token,
    link: buildInviteLink(invite.token, req),
    role: invite.role,
    status: invite.status,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt
  };
}
router.post('/create-invite', async (req, res) => {
  try {
    const { email, password, role } = req.body;
    if (!email || !password) {
      return res.status(401).json({ error: 'Authentication credentials required.' });
    }
    if (!['view', 'edit', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Role must be view, edit, or admin.' });
    }
    const owner = await User.findOne({ email: email.toLowerCase().trim() });
    if (!owner) {
      return res.status(401).json({ error: 'Invalid user account credentials.' });
    }
    const isPasswordValid = await bcrypt.compare(password, owner.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid user account credentials.' });
    }
    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    const invite = await Invite.create({
      ownerCustomerId: owner.customer_id,
      token,
      role,
      expiresAt
    });
    return res.status(201).json({ success: true, invite: serializeInvite(invite, req) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
router.get('/invites', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: 'Email parameter is required.' });
    }
    const owner = await User.findOne({ email: email.toLowerCase().trim() });
    if (!owner) {
      return res.status(404).json({ error: 'User account profile not found.' });
    }
    await Invite.updateMany(
      { ownerCustomerId: owner.customer_id, status: 'pending', expiresAt: { $lt: new Date() } },
      { $set: { status: 'revoked' } }
    );
    const invites = await Invite.find({
      ownerCustomerId: owner.customer_id,
      status: 'pending'
    }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, invites: invites.map(inv => serializeInvite(inv, req)) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
router.delete('/invites/:token', async (req, res) => {
  try {
    const { email } = req.query;
    const { token } = req.params;
    if (!email) {
      return res.status(400).json({ error: 'Email parameter is required.' });
    }
    const owner = await User.findOne({ email: email.toLowerCase().trim() });
    if (!owner) {
      return res.status(404).json({ error: 'User account profile not found.' });
    }
    const invite = await Invite.findOne({ token, ownerCustomerId: owner.customer_id });
    if (!invite) {
      return res.status(404).json({ error: 'Invite not found.' });
    }
    await Invite.deleteOne({ _id: invite._id });
    return res.status(200).json({ success: true, message: 'Invite revoked.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
router.post('/join', async (req, res) => {
  try {
    const { token, email, password } = req.body;
    if (!token || !email || !password) {
      return res.status(400).json({ error: 'Token, email and password are required.' });
    }
    const joiner = await User.findOne({ email: email.toLowerCase().trim() });
    if (!joiner) {
      return res.status(401).json({ error: 'Invalid user account credentials.' });
    }
    const isPasswordValid = await bcrypt.compare(password, joiner.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid user account credentials.' });
    }
    const invite = await Invite.findOne({ token });
    if (!invite || invite.status !== 'pending') {
      return res.status(404).json({ error: 'This invite link is invalid or has already been used.' });
    }
    if (invite.expiresAt < new Date()) {
      invite.status = 'revoked';
      await invite.save();
      return res.status(410).json({ error: 'This invite link has expired.' });
    }
    if (invite.ownerCustomerId === joiner.customer_id) {
      return res.status(400).json({ error: "You can't join your own vault." });
    }
    const existingMembership = await VaultMember.findOne({
      ownerCustomerId: invite.ownerCustomerId,
      memberCustomerId: joiner.customer_id
    });
    if (existingMembership) {
      existingMembership.role = invite.role;
      await existingMembership.save();
    } else {
      await VaultMember.create({
        ownerCustomerId: invite.ownerCustomerId,
        memberCustomerId: joiner.customer_id,
        memberEmail: joiner.email,
        memberName: joiner.fullName,
        role: invite.role
      });
    }
    invite.status = 'accepted';
    invite.acceptedByCustomerId = joiner.customer_id;
    invite.acceptedAt = new Date();
    await invite.save();
    const owner = await User.findOne({ customer_id: invite.ownerCustomerId });
    return res.status(200).json({
      success: true,
      message: 'You have joined the vault.',
      vault: { ownerCustomerId: invite.ownerCustomerId, ownerName: owner ? owner.fullName : '', role: invite.role }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
// 5. LIST MEMBERS OF A VAULT
router.get('/members', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: 'Email parameter is required.' });
    }
    const owner = await User.findOne({ email: email.toLowerCase().trim() });
    if (!owner) {
      return res.status(404).json({ error: 'User account profile not found.' });
    }
    const members = await VaultMember.find({ ownerCustomerId: owner.customer_id }).sort({ joinedAt: -1 });
    return res.status(200).json({
      success: true,
      members: members.map(m => ({
        id: m._id,
        name: m.memberName,
        email: m.memberEmail,
        role: m.role,
        joinedAt: m.joinedAt
      }))
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
router.delete('/members/:id', async (req, res) => {
  try {
    const { email } = req.query;
    const { id } = req.params;
    if (!email) {
      return res.status(400).json({ error: 'Email parameter is required.' });
    }
    const owner = await User.findOne({ email: email.toLowerCase().trim() });
    if (!owner) {
      return res.status(404).json({ error: 'User account profile not found.' });
    }
    const member = await VaultMember.findOne({ _id: id, ownerCustomerId: owner.customer_id });
    if (!member) {
      return res.status(404).json({ error: 'Member not found.' });
    }
    await VaultMember.deleteOne({ _id: member._id });
    return res.status(200).json({ success: true, message: 'Member removed.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
function serializeShare(share) {
  return {
    id: share._id,
    assetId: share.assetId,
    documentPath: share.documentPath,
    documentName: share.documentName,
    category: share.category,
    subCategory: share.subCategory,
    subSubCategory: share.subSubCategory,
    ownerName: share.ownerName,
    ownerEmail: share.ownerEmail,
    receiverName: share.receiverName,
    receiverEmail: share.receiverEmail,
    sharedAt: share.sharedAt,
  };
}

// 6. SHARE A DOCUMENT WITH ANOTHER USER
router.post('/share-document', async (req, res) => {
  try {
    const { email, password, assetId, documentPath, documentName, receiver } = req.body;
    if (!email || !password) {
      return res.status(401).json({ error: 'Authentication credentials required.' });
    }
    if (!assetId || !documentPath || !receiver) {
      return res.status(400).json({ error: 'Asset, document and receiver are required.' });
    }
    const owner = await User.findOne({ email: email.toLowerCase().trim() });
    if (!owner) {
      return res.status(401).json({ error: 'Invalid user account credentials.' });
    }
    const isPasswordValid = await bcrypt.compare(password, owner.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid user account credentials.' });
    }
    const asset = await Asset.findOne({ _id: assetId, userId: owner.customer_id });
    if (!asset) {
      return res.status(404).json({ error: 'Document not found in your vault.' });
    }
    if (!(asset.documents || []).includes(documentPath)) {
      return res.status(404).json({ error: 'Document not found in your vault.' });
    }
    const receiverKey = receiver.trim().toLowerCase();
    const receiverUser = await User.findOne({
      $or: [{ email: receiverKey }, { phone: receiver.trim() }],
    });
    if (!receiverUser) {
      return res.status(404).json({ error: 'No DocGuard account was found with that email or phone number.' });
    }
    if (receiverUser.customer_id === owner.customer_id) {
      return res.status(400).json({ error: "You can't share a document with yourself." });
    }
    const share = await SharedDocument.findOneAndUpdate(
      {
        ownerCustomerId: owner.customer_id,
        receiverEmail: receiverUser.email,
        assetId: String(assetId),
        documentPath,
      },
      {
        $set: {
          ownerName: owner.fullName || owner.email,
          ownerEmail: owner.email,
          receiverCustomerId: receiverUser.customer_id,
          receiverName: receiverUser.fullName || receiverUser.email,
          documentName: documentName || asset.name,
          category: asset.category,
          subCategory: asset.subCategory,
          subSubCategory: asset.subSubCategory,
          sharedAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await createAlert({
      title: 'Document Shared With You',
      message: `${owner.fullName || owner.email} shared "${documentName || asset.name}" with you.`,
      type: 'info',
      priority: 'low',
      sent_by: owner.fullName || owner.email,
      sent_to: receiverUser.customer_id,
    });
    return res.status(201).json({ success: true, message: 'Document shared successfully.', share: serializeShare(share) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(200).json({ success: true, message: 'Document shared successfully.' });
    }
    return res.status(500).json({ error: err.message });
  }
});

// 7. LIST DOCUMENTS SHARED WITH THE CURRENT USER (received)
router.get('/shared-with-me', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: 'Email parameter is required.' });
    }
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(404).json({ error: 'User account profile not found.' });
    }
    const shares = await SharedDocument.find({
      $or: [{ receiverCustomerId: user.customer_id }, { receiverEmail: user.email }],
    }).sort({ sharedAt: -1 });
    return res.status(200).json({ success: true, documents: shares.map(serializeShare) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 8. LIST DOCUMENTS THE CURRENT USER HAS SHARED OUT (sent)
router.get('/shared-by-me', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: 'Email parameter is required.' });
    }
    const owner = await User.findOne({ email: email.toLowerCase().trim() });
    if (!owner) {
      return res.status(404).json({ error: 'User account profile not found.' });
    }
    const shares = await SharedDocument.find({ ownerCustomerId: owner.customer_id }).sort({ sharedAt: -1 });
    return res.status(200).json({ success: true, documents: shares.map(serializeShare) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 9. REVOKE A SHARE (stop sharing a document)
router.delete('/shared/:id', async (req, res) => {
  try {
    const { email } = req.query;
    const { id } = req.params;
    if (!email) {
      return res.status(400).json({ error: 'Email parameter is required.' });
    }
    const owner = await User.findOne({ email: email.toLowerCase().trim() });
    if (!owner) {
      return res.status(404).json({ error: 'User account profile not found.' });
    }
    const share = await SharedDocument.findOne({ _id: id, ownerCustomerId: owner.customer_id });
    if (!share) {
      return res.status(404).json({ error: 'Shared document not found.' });
    }
    await SharedDocument.deleteOne({ _id: share._id });
    return res.status(200).json({ success: true, message: 'Stopped sharing this document.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

async function resolveVaultAccess(email, vaultOwnerCustomerId) {
  const requester = await User.findOne({ email: email.toLowerCase().trim() });
  if (!requester) return null;
  if (!vaultOwnerCustomerId || vaultOwnerCustomerId === requester.customer_id) {
    return { ownerCustomerId: requester.customer_id, role: 'admin', requester };
  }
  const membership = await VaultMember.findOne({
    ownerCustomerId: vaultOwnerCustomerId,
    memberCustomerId: requester.customer_id
  });
  if (!membership) return null;
  return { ownerCustomerId: vaultOwnerCustomerId, role: membership.role, requester };
}
module.exports = router;
module.exports.resolveVaultAccess = resolveVaultAccess;
