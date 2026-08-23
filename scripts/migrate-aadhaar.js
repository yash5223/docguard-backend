// One-time migration: populate the new aadhaarHash / aadhaarLast4 fields
// from the old plaintext `aadhaar` field, for every existing user.
//
// Run this AGAINST YOUR PRODUCTION DATABASE once, before deploying the new
// server code (the new code reads aadhaarHash/aadhaarLast4, not aadhaar).
//
// Usage:
//   node scripts/migrate-aadhaar.js                 # populate new fields, keep old `aadhaar` field as a safety net
//   node scripts/migrate-aadhaar.js --remove-plaintext   # ALSO delete the old plaintext `aadhaar` field
//
// Run it WITHOUT --remove-plaintext first, deploy the new backend, verify
// login/profile/register all work, and only then re-run WITH
// --remove-plaintext to actually erase the plaintext numbers from the DB.
require('dotenv').config();
const mongoose = require('mongoose');
const { hashAadhaar, aadhaarLast4 } = require('../utils/piiFields');

const REMOVE_PLAINTEXT = process.argv.includes('--remove-plaintext');

async function run() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set. Point this at the same .env you deploy with.');
    process.exit(1);
  }
  if (!process.env.FIELD_HASH_SECRET && !process.env.JWT_SECRET) {
    console.error('FIELD_HASH_SECRET (or JWT_SECRET) is not set — required to compute the hash consistently with the server.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB.');

  const db = mongoose.connection.db;
  const users = db.collection('users');

  const cursor = users.find({
    aadhaar: { $exists: true, $ne: null },
    $or: [{ aadhaarHash: { $exists: false } }, { aadhaarHash: null }],
  });

  let migrated = 0;
  let skipped = 0;

  while (await cursor.hasNext()) {
    const user = await cursor.next();
    if (!user.aadhaar) {
      skipped++;
      continue;
    }
    const update = {
      aadhaarHash: hashAadhaar(user.aadhaar),
      aadhaarLast4: aadhaarLast4(user.aadhaar),
    };
    const unset = REMOVE_PLAINTEXT ? { aadhaar: '' } : undefined;
    await users.updateOne(
      { _id: user._id },
      unset ? { $set: update, $unset: unset } : { $set: update }
    );
    migrated++;
  }

  console.log(`Done. Migrated ${migrated} user(s), skipped ${skipped} (already had aadhaarHash or no aadhaar field).`);
  if (!REMOVE_PLAINTEXT) {
    console.log('Plaintext `aadhaar` field was left in place. Re-run with --remove-plaintext once you\'ve verified the new backend deploy works.');
  } else {
    console.log('Plaintext `aadhaar` field has been removed from all migrated users.');
  }
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
