const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const { runOcr, SUPPORTED_MIMETYPES } = require('../utils/ocrEngine');
const { detectFileType } = require('../utils/detectFileType');
const { classifyDocument } = require('../config/documentSignatures');
const { getFieldsForDocumentType } = require('../config/documentFieldTemplates');
const { extractFieldsForDocumentType, extractName, extractNotes, extractStoreOrSeller } = require('../utils/fieldExtractors');

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 15 * 1024 * 1024 },
  // No fileFilter here: the client-supplied Content-Type can't be trusted
  // (many HTTP clients send "application/octet-stream" when they can't
  // infer a type from the file path). The file is validated by sniffing
  // its actual bytes once it's on disk, below.
});

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';

// Builds an LLM prompt that only asks for the fields relevant to the
// detected documentType, instead of a fixed generic field list — keeps the
// fallback consistent with the regex path and with what actually gets
// stored in the DB.
async function llmFallback(rawText, documentType) {
  const applicableFields = getFieldsForDocumentType(documentType);
  const fieldList = ['name', 'storeOrSeller', 'notesOrAddress', ...applicableFields].join(', ');
  const prompt =
    `Extract these fields from the document text below and respond with ONLY valid JSON, no explanation, no markdown fences.\n` +
    `Fields: ${fieldList}.\n` +
    `If a field is not found use an empty string.\n\nDocument text:\n${rawText}`;

  const ollamaRes = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt, format: 'json', stream: false }),
  });
  if (!ollamaRes.ok) return null;
  const ollamaJson = await ollamaRes.json();
  return JSON.parse(ollamaJson.response);
}

router.post('/scan-receipt', upload.single('image'), async (req, res) => {
  const tmpFiles = [];
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }
    tmpFiles.push(req.file.path);

    const detectedType = detectFileType(req.file.path);
    if (!detectedType) {
      return res.status(400).json({
        error: `Unrecognized file type. Supported: JPEG, PNG, WEBP, HEIC, PDF. (Client sent Content-Type: "${req.file.mimetype}")`,
      });
    }

    const trainedDataPath = path.join(__dirname, '..', 'eng.traineddata');
    if (!fs.existsSync(trainedDataPath)) {
      console.error(`[OCR] FATAL: eng.traineddata not found at ${trainedDataPath}.`);
      return res.status(500).json({ error: 'OCR language data missing on server (eng.traineddata not found).' });
    }

    const baseName = path.basename(req.file.filename, path.extname(req.file.filename));
    const { text: rawText, confidence: ocrConfidence } = await runOcr({
      filePath: req.file.path,
      mimetype: detectedType,
      tmpDir: uploadDir,
      baseName,
    });

    console.log(`[OCR] extracted ${rawText.trim().length} chars, confidence ${ocrConfidence}`);

    if (!rawText || !rawText.trim()) {
      return res.status(200).json({ success: true, extracted: false });
    }

    // 1. Classify which of the ~40+ document types this text matches.
    const classification = classifyDocument(rawText);

    // 2. Extract only the fields relevant to that document type.
    const dynamicFields = extractFieldsForDocumentType(classification.documentType, rawText);

    let parsed = {
      category: classification.category,
      subCategory: classification.subCategory,
      documentType: classification.documentType,
      name: extractName(rawText),
      storeOrSeller: extractStoreOrSeller(rawText),
      issuingAuthority: dynamicFields.issuingAuthority,
      notesOrAddress: extractNotes(rawText),
      ...dynamicFields,
      classificationConfidence: classification.confidence,
      needsReview: classification.needsReview,
      ocrConfidence,
    };

    // 3. Fall back to the local LLM only when the regex pass came back thin
    // (missing a name, or low classification/OCR confidence) — keeps the
    // fast path fast for the common case.
    const shouldUseFallback = !parsed.name || ocrConfidence < 60 || classification.needsReview;
    if (shouldUseFallback) {
      try {
        const llmParsed = await llmFallback(rawText, classification.documentType);
        if (llmParsed) {
          // Never let the LLM silently drop a value the regex pass already
          // found — only fill in blanks, don't overwrite good data.
          for (const key of Object.keys(llmParsed)) {
            if (!parsed[key] && llmParsed[key]) parsed[key] = llmParsed[key];
          }
        }
      } catch (llmError) {
        console.error('[OCR] LLM fallback failed, returning regex-only result:', llmError.message);
      }
    }

    return res.status(200).json({ success: true, extracted: true, data: parsed, rawText });
  } catch (err) {
    console.error('[OCR] scan-receipt failed:', err);
    return res.status(500).json({ error: err.message });
  } finally {
    for (const f of tmpFiles) {
      if (fs.existsSync(f)) fs.unlink(f, () => {});
    }
  }
});

module.exports = router;