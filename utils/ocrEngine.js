const sharp = require('sharp');
const Tesseract = require('tesseract.js');
const fs = require('fs');
const path = require('path');

// A single worker is created once and reused for every request instead of
// spinning one up and tearing it down per scan — this is the single
// biggest throughput win when handling many files back to back.
let workerPromise = null;
function getWorker() {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker('eng', 1, {
      langPath: path.join(__dirname, '..'),
      gzip: false,
      logger: (m) => {
        if (m.status && m.progress === 1) console.log(`[OCR] ${m.status} done`);
      },
    });
  }
  return workerPromise;
}

async function terminateWorker() {
  if (workerPromise) {
    const w = await workerPromise;
    await w.terminate();
    workerPromise = null;
  }
}

function safeUnlink(p) {
  fs.unlink(p, () => {});
}

// Different source documents need different preprocessing: a clean phone
// photo of a receipt works fine with a light touch, but a washed-out
// photocopy or a low-contrast scan needs more aggressive contrast/threshold
// work. Rather than guess up front, we try the cheap variant first and
// only pay for a second pass if confidence is low.
const VARIANTS = {
  standard: (pipeline) => pipeline.resize({ width: 1800 }).grayscale().normalize().sharpen(),
  highContrast: (pipeline) => pipeline.resize({ width: 2200 }).grayscale().normalize().linear(1.3, -20).threshold(150),
};

const CONFIDENCE_GOOD_ENOUGH = 80;

async function ocrImageFile(inputPath, tmpDir, baseName) {
  const worker = await getWorker();
  let best = { text: '', confidence: 0 };

  for (const variantName of Object.keys(VARIANTS)) {
    const outPath = path.join(tmpDir, `${baseName}_${variantName}.png`);
    try {
      await VARIANTS[variantName](sharp(inputPath).rotate()).png().toFile(outPath);
      const { data } = await worker.recognize(outPath);
      const confidence = data.confidence || 0;
      if (confidence > best.confidence) {
        best = { text: data.text || '', confidence };
      }
    } catch (err) {
      console.error(`[OCR] preprocessing variant "${variantName}" failed:`, err.message);
    } finally {
      safeUnlink(outPath);
    }
    if (best.confidence >= CONFIDENCE_GOOD_ENOUGH) break;
  }

  return best;
}

async function ocrPdfFile(inputPath, tmpDir, baseName) {
  let convert;
  try {
    // Optional dependency — only required if PDF uploads are enabled.
    // npm install pdf-img-convert
    convert = require('pdf-img-convert');
  } catch (err) {
    throw new Error('PDF support requires the "pdf-img-convert" package. Run: npm install pdf-img-convert');
  }

  const pages = await convert.convert(inputPath, { width: 1800 });
  let combinedText = '';
  const confidences = [];

  for (let i = 0; i < pages.length; i++) {
    const pagePath = path.join(tmpDir, `${baseName}_p${i}.png`);
    fs.writeFileSync(pagePath, pages[i]);
    try {
      const result = await ocrImageFile(pagePath, tmpDir, `${baseName}_p${i}`);
      combinedText += `${result.text}\n`;
      confidences.push(result.confidence);
    } finally {
      safeUnlink(pagePath);
    }
  }

  const avgConfidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;
  return { text: combinedText.trim(), confidence: avgConfidence };
}

const SUPPORTED_MIMETYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']);

/**
 * Runs OCR on a single uploaded file, dispatching to the image or PDF path
 * based on mimetype. Returns { text, confidence }.
 */
async function runOcr({ filePath, mimetype, tmpDir, baseName }) {
  if (!SUPPORTED_MIMETYPES.has(mimetype)) {
    throw new Error(`Unsupported file type "${mimetype}". Supported: JPEG, PNG, WEBP, HEIC, PDF.`);
  }
  if (mimetype === 'application/pdf') {
    return ocrPdfFile(filePath, tmpDir, baseName);
  }
  return ocrImageFile(filePath, tmpDir, baseName);
}

module.exports = { runOcr, terminateWorker, SUPPORTED_MIMETYPES };