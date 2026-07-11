const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const FOLDER = process.env.CLOUDINARY_FOLDER || 'docguard';

/**
 * Uploads a file buffer (from multer memoryStorage) to Cloudinary.
 * @param {Buffer} buffer - the file buffer (req.file.buffer)
 * @param {string} publicId - desired public_id (no extension needed), e.g. "CUST_1_iphone_01"
 * @returns {Promise<string>} the secure_url of the uploaded asset
 */
function uploadBufferToCloudinary(buffer, publicId) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: FOLDER,
        public_id: publicId,
        resource_type: 'auto', // handles images, pdfs, etc.
        overwrite: true,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
}

/**
 * Extracts the Cloudinary public_id (including folder) and resource_type
 * from a secure_url produced by this app, e.g.:
 * https://res.cloudinary.com/<cloud>/image/upload/v169.../docguard/CUST_1_iphone_01.jpg
 */
function parseCloudinaryUrl(url) {
  const match = url.match(/\/([^/]+)\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-zA-Z0-9]+)?$/);
  if (!match) return null;
  const resourceType = url.includes('/image/upload/')
    ? 'image'
    : url.includes('/video/upload/')
      ? 'video'
      : 'raw';
  return { publicId: match[2], resourceType };
}

/**
 * Deletes an asset from Cloudinary given its stored secure_url.
 * Safe to call even if the string isn't a Cloudinary URL (e.g. legacy
 * local filenames) - it will simply resolve without throwing.
 */
async function deleteFromCloudinaryByUrl(url) {
  if (!url || typeof url !== 'string' || !url.includes('res.cloudinary.com')) {
    return; // not a Cloudinary asset (e.g. legacy local file), nothing to do
  }
  const parsed = parseCloudinaryUrl(url);
  if (!parsed) return;
  try {
    await cloudinary.uploader.destroy(parsed.publicId, { resource_type: parsed.resourceType });
  } catch (err) {
    console.error(`[Cloudinary] Failed to delete ${parsed.publicId}:`, err.message);
  }
}

module.exports = {
  cloudinary,
  uploadBufferToCloudinary,
  deleteFromCloudinaryByUrl,
};
