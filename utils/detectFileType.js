const fs = require('fs');

// Detects real file type from content (magic bytes), not from whatever
// Content-Type the client happened to send. Clients (mobile HTTP libs,
// browsers, curl) frequently send "application/octet-stream" when they
// can't infer a type from a file extension — trusting that header alone
// means rejecting perfectly valid uploads.
const SIGNATURES = [
  { mimetype: 'image/jpeg', check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mimetype: 'image/png', check: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mimetype: 'application/pdf', check: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
  {
    mimetype: 'image/webp',
    check: (b) => b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP',
  },
  {
    mimetype: 'image/heic',
    check: (b) => {
      if (b.slice(4, 8).toString('ascii') !== 'ftyp') return false;
      const subBrand = b.slice(8, 12).toString('ascii');
      return ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(subBrand);
    },
  },
];

/**
 * Reads the first bytes of a file on disk and returns the detected
 * mimetype, or null if it doesn't match any supported signature.
 */
function detectFileType(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(16);
  fs.readSync(fd, buffer, 0, 16, 0);
  fs.closeSync(fd);
  for (const sig of SIGNATURES) {
    if (sig.check(buffer)) return sig.mimetype;
  }
  return null;
}

module.exports = { detectFileType };