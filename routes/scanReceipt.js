const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const Tesseract = require('tesseract.js');
const sharp = require('sharp');

const router = express.Router();
const uploadDir = path.join(__dirname, '..', 'uploads');

if (!fs.existsSync(uploadDir)) { 
  fs.mkdirSync(uploadDir, { recursive: true }); 
}

const upload = multer({ dest: uploadDir });

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';

function extract(regex, text) {
  const match = text.match(regex);
  if (!match) return "";
  return (match[1] || match[0]).trim();
}

function parseInvoice(text) {
  // Updated standard default parser context to default to Property
  let detectedCategory = "Property";
  if (/\b(car|motorcycle|suv|sedan|mileage|vin|registration|chassis)\b/i.test(text)) {
    detectedCategory = "Vehicles";
  } else if (/\b(phone|smartphone|laptop|macbook|smartwatch|tablet|ipad)\b/i.test(text)) {
    detectedCategory = "Gadgets";
  } else if (/\b(gold|diamond|carat|purity|jewelry|necklace|ring|silver)\b/i.test(text)) {
    detectedCategory = "Jewelry";
  } else if (/\b(tv|television|refrigerator|fridge|ac|washer|dryer|microwave)\b/i.test(text)) {
    detectedCategory = "Electronics";
  } else if (/\b(sofa|chair|table|desk|bed|furniture|wood|mattress)\b/i.test(text)) {
    detectedCategory = "Furniture";
  } else if (/\b(other|misc|miscellaneous)\b/i.test(text)) {
    detectedCategory = "Other";
  }

  const nameMatch = extract(/(?:Description|Product|Item|Asset|Property Name)\s*[: ]\s*([A-Za-z0-9 ]+)/i, text);

  return {
    category: detectedCategory,
    name: nameMatch || extract(/^([A-Za-z0-9 ]{3,24})/m, text),
    subType: extract(/(?:Type|Sub-Category)\s*[: ]\s*([A-Za-z0-9 ]+)/i, text) || extract(/\b(Apartment|Villa|SUV|Sedan|Smartphone|Laptop|TV|Sofa)\b/i, text),
    brand: extract(/(?:Brand|Builder|Developer|Manufacturer)\s*[: ]\s*([A-Za-z0-9 ]+)/i, text) || extract(/\b(LG|Samsung|Sony|Whirlpool|Godrej|IFB|Haier|Bosch|Panasonic|DLF|Godrej Properties|Tata)\b/i, text),
    store: extract(/(?:Store|Seller|Broker|Vendor|Agency)\s*[: ]\s*([A-Za-z0-9 ]+)/i, text) || extract(/\b(Reliance Digital|Croma|Vijay Sales)\b/i, text),
    date: extract(/(?:Invoice|Purchase|Registration)\s*Date\s*[: ]\s*([\d-]+)/i, text) || extract(/(\d{4}-\d{2}-\d{2})/, text),
    amount: extract(/(?:Total Amount|Grand Total|Net Payable|Value|Price)\s*[: ]*₹?\s*([\d,]+\.\d+)/i, text) || extract(/Total.*?([\d,]+\.\d+)/i, text),
    invoiceNumber: extract(/(?:Invoice|Bill|Deed|Agreement|Document)\s*No\s*[:+ ]\s*([A-Z0-9-]+)/i, text),
    expiryDate: extract(/(?:Warranty Expiry|Valid Upto)\s*[: ]\s*([\d-]+)/i, text),
    notes: extract(/(?:Notes|Address|Location)\s*[: ]\s*([A-Za-z0-9,.\- ]+)/i, text),
    specField1: extract(/(?:Built-up Area|Plot Size|Registration|License Plate|Model Number|Carat|Purity|Dimensions)\s*[: ]\s*([A-Za-z0-9,.\- ]+)/i, text),
    specField2: extract(/(?:RERA|Khata|VIN|Mileage|Serial Number|S\/N|Weight|Material)\s*[: ]\s*([A-Za-z0-9,.\- ]+)/i, text)
  };
}

router.post('/scan-receipt', upload.single('image'), async (req, res) => {
  let processedImagePath = null;
  
  try {
    if (!req.file) { return res.status(400).json({ error: 'No image uploaded' }); }

    processedImagePath = path.join(uploadDir, `proc_${req.file.filename}.png`);
    await sharp(req.file.path)
      .rotate()
      .resize({ width: 1800 })
      .grayscale()
      .normalize()
      .sharpen()
      .png()
      .toFile(processedImagePath);

    const worker = await Tesseract.createWorker('eng', 1, {
      langPath: path.join(__dirname, '..'),
      gzip: false,
      logger: (m) => {
        if (m.status && m.progress === 1) console.log(`[OCR] ${m.status} done`);
      },
    });
    let rawText = '';
    let ocrConfidence = 0;
    try {
      const { data } = await worker.recognize(processedImagePath);
      rawText = data.text || '';
      ocrConfidence = data.confidence || 0;
    } finally {
      await worker.terminate();
    }
    console.log(`[OCR] extracted ${rawText.trim().length} chars, confidence ${ocrConfidence}`);

    fs.unlink(req.file.path, () => {});
    fs.unlink(processedImagePath, () => {});

    if (!rawText || !rawText.trim()) {
      return res.status(200).json({ success: true, extracted: false });
    }

    let parsed = parseInvoice(rawText);

    if (!parsed.name || !parsed.amount) {
      try {
        const prompt = 'Extract these fields from the receipt text below and respond with ONLY valid JSON, no explanation, no markdown fences.\nFields: name, brand, store, date (YYYY-MM-DD), amount (number only, no currency symbol), invoiceNumber, expiryDate (YYYY-MM-DD or empty string), notes, category (one of Property, Electronics, Vehicles, Gadgets, Jewelry, Furniture, Other), subType, specField1, specField2.\nIf a field is not found use an empty string.\n\nReceipt text:\n' + rawText;
        
        const ollamaRes = await fetch(OLLAMA_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: OLLAMA_MODEL, prompt, format: 'json', stream: false })
        });

        if (ollamaRes.ok) {
          const ollamaJson = await ollamaRes.json();
          const llmParsed = JSON.parse(ollamaJson.response);
          parsed = { ...parsed, ...llmParsed };
        }
      } catch (llmError) {
        console.error("Backup LLM extraction failed, returning default regex map:", llmError);
      }
    }

    return res.status(200).json({ success: true, extracted: true, data: parsed, rawText });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlink(req.file.path, () => {});
    if (processedImagePath && fs.existsSync(processedImagePath)) fs.unlink(processedImagePath, () => {});
    
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;