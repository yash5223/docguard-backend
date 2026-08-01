const { getFieldsForDocumentType } = require('../config/documentFieldTemplates');
const { parseAmount } = require('./aiEngine');

function extract(regex, text) {
  const match = text.match(regex);
  if (!match) return '';
  return (match[1] || match[0]).trim();
}

// documentNumber has a very different shape per document type, so a single
// generic regex is either too loose (matches garbage) or too strict
// (misses valid formats). Override per type where the format is known;
// everything else falls back to the generic "Number/No:" label pattern.
const DOCUMENT_NUMBER_PATTERNS = {
  'Aadhaar Card': /\b\d{4}[ ]?\d{4}[ ]?\d{4}\b/,
  'PAN Card': /\b[A-Z]{5}[0-9]{4}[A-Z]\b/,
  'Business PAN': /\b[A-Z]{5}[0-9]{4}[A-Z]\b/,
  'Passport': /\b[A-PR-WYa-pr-wy][0-9]{7}\b/,
  'GST Documents': /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/,
  'Voter ID': /\b[A-Z]{3}[0-9]{7}\b/i,
};

const GENERIC_NUMBER_LABEL = /(?:Number|No\.?|ID|Reg(?:istration)?)\s*[:#]?\s*([A-Za-z0-9\/\-]{4,20})/i;

function extractDocumentNumber(documentType, text) {
  const typedPattern = DOCUMENT_NUMBER_PATTERNS[documentType];
  if (typedPattern) {
    const m = text.match(typedPattern);
    if (m) return m[0].trim();
  }
  return extract(GENERIC_NUMBER_LABEL, text);
}

const KNOWN_AUTHORITIES = [
  'UIDAI', 'Income Tax Department', 'Election Commission', 'RTO', 'Passport Seva',
  'LIC', 'HDFC ERGO', 'ICICI Lombard', 'Star Health', 'Bajaj Allianz', 'Tata AIG',
  'Reliance Digital', 'Croma', 'Vijay Sales', 'Amazon', 'Flipkart',
  'LG', 'Samsung', 'Sony', 'Whirlpool', 'Godrej', 'IFB', 'Haier', 'Bosch', 'Panasonic',
  'DLF', 'Godrej Properties', 'Tata',
];

function extractIssuingAuthority(text) {
  const labelMatch = extract(/(?:Issuing Authority|Issued By|Bank|Insurer|Employer|University|Board|Hospital|Clinic|Airline|Hotel|Vendor|Seller|Store|Dealer)\s*[:]\s*([A-Za-z0-9 &.,]+)/i, text);
  if (labelMatch) return labelMatch;
  for (const name of KNOWN_AUTHORITIES) {
    if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) return name;
  }
  return '';
}

function extractExpiryDate(text) {
  const raw = extract(/(?:Expiry|Valid\s*(?:Upto|Till|Until)|Maturity Date|Policy Expiry|Warranty Expiry)\s*[:]\s*([\d]{1,4}[-\/][\d]{1,2}[-\/][\d]{1,4})/i, text);
  return raw;
}

function extractInvoiceNumber(text) {
  return extract(/(?:Invoice|Bill|Booking(?:\s*\/\s*PNR)?|Reference|Deed|Agreement)\s*(?:No|Number|Ref)\.?\s*[:]\s*([A-Za-z0-9\-\/]+)/i, text);
}

function extractValueAmount(text) {
  const nearLabel = extract(/(?:Total Amount|Grand Total|Net Payable|Value|Price|Sum Insured|Sum Assured|Premium)\s*[:]*\s*₹?\s*([\d,]+(?:\.\d+)?)/i, text);
  if (nearLabel) {
    const parsed = parseAmount(nearLabel);
    return parsed != null ? String(parsed) : nearLabel.replace(/,/g, '');
  }
  const fallback = extract(/₹\s?([\d,]+(?:\.\d+)?)/, text);
  return fallback ? fallback.replace(/,/g, '') : '';
}

const EXTRACTORS = {
  documentNumber: (documentType, text) => extractDocumentNumber(documentType, text),
  issuingAuthority: (documentType, text) => extractIssuingAuthority(text),
  expiryDate: (documentType, text) => extractExpiryDate(text),
  invoiceNumber: (documentType, text) => extractInvoiceNumber(text),
  valueAmount: (documentType, text) => extractValueAmount(text),
};

/**
 * Only extracts the fields that are actually relevant to `documentType`
 * (per config/documentFieldTemplates.js) — everything else is left as ''.
 * This keeps OCR extraction and DB storage using the exact same source of
 * truth, so they can never drift apart.
 */
function extractFieldsForDocumentType(documentType, text) {
  const applicableFields = getFieldsForDocumentType(documentType);
  const result = {};
  for (const key of Object.keys(EXTRACTORS)) {
    result[key] = applicableFields.includes(key) ? EXTRACTORS[key](documentType, text) : '';
  }
  return result;
}

function extractName(text) {
  return (
    extract(/(?:Description|Product|Item|Asset|Property Name|Name)\s*[:]\s*([A-Za-z0-9 ]+)/i, text) ||
    extract(/^([A-Za-z0-9 ]{3,40})/m, text)
  );
}

function extractNotes(text) {
  return extract(/(?:Notes|Address|Location)\s*[:]\s*([A-Za-z0-9,.\- ]+)/i, text);
}

function extractStoreOrSeller(text) {
  return extract(/(?:Store|Seller|Broker|Vendor|Agency|Dealer)\s*[:]\s*([A-Za-z0-9 &.,]+)/i, text) || extractIssuingAuthority(text);
}

module.exports = {
  extractFieldsForDocumentType,
  extractName,
  extractNotes,
  extractStoreOrSeller,
};