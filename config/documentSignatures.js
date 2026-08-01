// Score-based document classifier.
//
// Replaces the old if/else keyword chain. Each entry is
// [category, subCategory, documentType, keywords]. To support a new
// document type, add one line here — no code changes needed elsewhere.
// Multi-word keywords count double since they're more specific/less prone
// to false positives than single words.

const SIGNATURES = [
  // Personal > Identity & Legal
  ['Personal', 'Identity & Legal', 'Aadhaar Card', ['aadhaar', 'uidai', 'unique identification authority']],
  ['Personal', 'Identity & Legal', 'PAN Card', ['permanent account number', 'income tax department', 'pan card']],
  ['Personal', 'Identity & Legal', 'Passport', ['passport', 'republic of india', 'nationality', 'place of birth']],
  ['Personal', 'Identity & Legal', 'Driving Licence', ['driving licence', 'driving license', 'transport department', 'mcwg', 'lmv']],
  ['Personal', 'Identity & Legal', 'Voter ID', ['voter id', 'election commission', 'epic no']],
  ['Personal', 'Identity & Legal', 'Birth Certificate', ['birth certificate', 'date of birth certificate', 'municipal corporation birth']],
  ['Personal', 'Identity & Legal', 'Marriage Certificate', ['marriage certificate', 'solemnized', 'marriage registrar']],
  ['Personal', 'Identity & Legal', 'Name Change Affidavit', ['name change', 'affidavit for change of name']],

  // Personal > Financial
  ['Personal', 'Financial', 'Bank Account Documents', ['account number', 'ifsc', 'branch', 'bank statement', 'passbook']],
  ['Personal', 'Financial', 'Fixed Deposits (FDs)', ['fixed deposit', 'fd account', 'maturity date', 'maturity amount']],
  ['Personal', 'Financial', 'Mutual Funds (MF)', ['mutual fund', 'folio number', 'nav', 'sip', 'amc']],
  ['Personal', 'Financial', 'Income Tax (IT) Returns', ['income tax return', 'itr', 'assessment year', 'form 26as']],
  ['Personal', 'Financial', 'Form 16', ['form 16', 'form no. 16', 'tds certificate']],
  ['Personal', 'Financial', 'Loan Documents', ['loan agreement', 'sanction letter', 'emi', 'loan account number']],

  // Personal > Insurance
  ['Personal', 'Insurance', 'Health Insurance', ['health insurance', 'mediclaim', 'sum insured', 'cashless']],
  ['Personal', 'Insurance', 'Life Insurance', ['life insurance', 'sum assured', 'policy bond', 'nominee']],
  ['Personal', 'Insurance', 'Vehicle Insurance', ['vehicle insurance', 'motor insurance', 'third party', 'own damage', 'idv']],
  ['Personal', 'Insurance', 'Home Insurance', ['home insurance', 'householder policy', 'structure insured']],
  ['Personal', 'Insurance', 'Travel Insurance', ['travel insurance', 'trip cancellation', 'baggage loss cover']],

  // Personal > Healthcare
  ['Personal', 'Healthcare', 'Medical Reports', ['medical report', 'diagnosis', 'lab report', 'pathology', 'radiology']],
  ['Personal', 'Healthcare', 'Prescriptions', ['prescription', 'rx', 'dosage', 'take.*tablet', 'dr\\.']],
  ['Personal', 'Healthcare', 'Vaccination Records', ['vaccination', 'vaccine certificate', 'dose 1', 'dose 2', 'immunization']],
  ['Personal', 'Healthcare', 'Blood Group Information', ['blood group', 'blood type']],

  // Personal > Property
  ['Personal', 'Property', 'Sale Deeds', ['sale deed', 'vendor', 'vendee', 'conveyance']],
  ['Personal', 'Property', 'Purchase Documents', ['flat', 'apartment', 'villa', 'plot', 'khata', 'rera', 'built-up area', 'builder buyer agreement']],

  // Personal > Vehicle
  ['Personal', 'Vehicle', 'RC Book', ['registration certificate', 'rc book', 'chassis number', 'engine number', 'vin']],
  ['Personal', 'Vehicle', 'PUC Certificate', ['puc certificate', 'pollution under control', 'emission test']],
  ['Personal', 'Vehicle', 'Service History', ['service invoice', 'workshop', 'odometer reading', 'service center']],

  // Personal > Gadgets & Appliances
  ['Personal', 'Gadgets & Appliances', 'Mobile Phone', ['smartphone', 'mobile phone', 'imei']],
  ['Personal', 'Gadgets & Appliances', 'Laptop', ['laptop', 'notebook computer', 'macbook']],
  ['Personal', 'Gadgets & Appliances', 'TV', ['television', 'smart tv', 'led tv', 'oled']],
  ['Personal', 'Gadgets & Appliances', 'Refrigerator', ['refrigerator', 'fridge', 'freezer']],
  ['Personal', 'Gadgets & Appliances', 'Washing Machine', ['washing machine', 'washer dryer', 'front load', 'top load']],

  // Personal > Jewellery
  ['Personal', 'Jewellery', 'Hallmark Certificate', ['hallmark', 'bis hallmark', 'hallmarking']],
  ['Personal', 'Jewellery', 'Valuation Certificate', ['valuation certificate', 'appraised value', 'valuer']],
  ['Personal', 'Jewellery', 'Warranty', ['warranty card', 'guarantee card']],
  ['Personal', 'Jewellery', 'Insurance', ['jewellery insurance', 'jewelry insurance']],
  ['Personal', 'Jewellery', 'Purchase Invoice', ['gold', 'diamond', 'carat', 'purity', 'jewellery', 'jewelry', 'necklace', 'bangle', 'silver ornament']],

  // Personal > Travel
  ['Personal', 'Travel', 'Flight Tickets', ['boarding pass', 'flight ticket', 'pnr', 'e-ticket', 'departure', 'arrival']],
  ['Personal', 'Travel', 'Hotel Bookings', ['hotel booking', 'check-in', 'check-out', 'reservation confirmed', 'room type']],
  ['Personal', 'Travel', 'Visa', ['visa', 'consulate', 'entries', 'duration of stay']],
  ['Personal', 'Travel', 'Foreign Exchange Cards', ['forex card', 'foreign exchange', 'currency card']],

  // Professional > Employment
  ['Professional', 'Employment', 'Appointment Letter / Offer Letter', ['offer letter', 'appointment letter', 'joining date', 'ctc']],
  ['Professional', 'Employment', 'Experience Certificate', ['experience certificate', 'worked with us', 'tenure of employment']],
  ['Professional', 'Employment', 'Relieving Letter', ['relieving letter', 'last working day']],
  ['Professional', 'Employment', 'Salary Slips', ['salary slip', 'payslip', 'net pay', 'gross earnings', 'basic pay']],
  ['Professional', 'Employment', 'Promotion Letters', ['promotion letter', 'promoted to', 'designation change']],
  ['Professional', 'Employment', 'Appraisal Documents', ['appraisal', 'performance review', 'rating cycle']],

  // Professional > Certifications
  ['Professional', 'Certifications', 'Degree Certificate', ['degree certificate', 'bachelor of', 'master of', 'convocation']],
  ['Professional', 'Certifications', 'Mark Sheets', ['mark sheet', 'marksheet', 'grade sheet', 'cgpa', 'percentage obtained']],
  ['Professional', 'Certifications', 'Course Completion Certificates', ['course completion', 'certificate of completion', 'successfully completed the course']],
  ['Professional', 'Certifications', 'Sports Certificates', ['sports certificate', 'tournament', 'championship', 'participated in the sport']],
  ['Professional', 'Certifications', 'Music Certificates', ['music certificate', 'grade examination', 'trinity college london', 'music exam']],

  // Corporate > Business
  ['Corporate', 'Business', 'GST Documents', ['gstin', 'goods and services tax', 'gst registration']],
  ['Corporate', 'Business', 'Company Registration Certificate', ['certificate of incorporation', 'cin', 'registrar of companies']],
  ['Corporate', 'Business', 'MSME Registration', ['msme', 'udyam registration', 'udyog aadhaar']],
  ['Corporate', 'Business', 'Business PAN', ['company pan', 'business pan']],
  ['Corporate', 'Business', 'TAN', ['tax deduction account number', 'tan number']],
  ['Corporate', 'Business', 'Business Licenses', ['trade license', 'shop and establishment', 'fssai license']],

  // Corporate > Intellectual Property
  ['Corporate', 'Intellectual Property', 'Patent Application', ['patent application', 'application number', 'provisional specification']],
  ['Corporate', 'Intellectual Property', 'Granted Patents', ['patent granted', 'letters patent', 'patent number']],
  ['Corporate', 'Intellectual Property', 'Trademark Registration', ['trademark', 'trade mark registry', 'class of goods']],
  ['Corporate', 'Intellectual Property', 'Copyright Registration', ['copyright registration', 'copyright office']],

  // Legal > Legal Agreements
  ['Legal', 'Legal Agreements', 'Affidavits', ['affidavit', 'solemnly affirm', 'deponent']],
  ['Legal', 'Legal Agreements', 'Notarized Documents', ['notary public', 'notarized', 'notarised']],
  ['Legal', 'Legal Agreements', 'Court Orders', ['in the court of', 'honourable court', 'order dated', 'petitioner', 'respondent']],
  ['Legal', 'Legal Agreements', 'Legal Notices', ['legal notice', 'through advocate', 'take notice that']],
  ['Legal', 'Legal Agreements', 'Power of Attorney', ['power of attorney', 'attorney holder', 'executant']],
  ['Legal', 'Legal Agreements', 'Agreements & Contracts', ['this agreement is made', 'party of the first part', 'terms and conditions of this contract']],

  // Legal > Family Legal
  ['Legal', 'Family Legal', 'Will', ['last will and testament', 'testator', 'bequeath']],
  ['Legal', 'Family Legal', 'Succession Certificate', ['succession certificate', 'legal heirs']],
  ['Legal', 'Family Legal', 'Probate', ['probate', 'grant of probate']],
  ['Legal', 'Family Legal', 'Nomination Documents', ['nomination form', 'nominee details']],

  // Legal > Compliance
  ['Legal', 'Compliance', 'Government Notices', ['government notice', 'gazette', 'public notice']],
  ['Legal', 'Compliance', 'Licenses', ['license number', 'valid up to', 'issuing department']],
];

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Scores every known document type against the OCR'd text and returns the
 * best match. Multi-word keywords are weighted higher since they're much
 * less likely to appear by coincidence.
 */
function classifyDocument(text) {
  const lower = (text || '').toLowerCase();
  let best = null;
  let bestScore = 0;

  for (const [category, subCategory, documentType, keywords] of SIGNATURES) {
    let score = 0;
    for (const kw of keywords) {
      const isPhrase = kw.trim().includes(' ');
      const pattern = isPhrase ? kw : `\\b${escapeRegex(kw)}\\b`;
      const re = new RegExp(pattern, 'gi');
      const matches = lower.match(re);
      if (matches) score += Math.min(matches.length, 3) * (isPhrase ? 2 : 1);
    }
    if (score > bestScore) {
      bestScore = score;
      best = { category, subCategory, documentType };
    }
  }

  if (!best) {
    return {
      category: 'Personal',
      subCategory: 'Gadgets & Appliances',
      documentType: 'Mobile Phone',
      confidence: 0,
      needsReview: true,
    };
  }

  return { ...best, confidence: bestScore, needsReview: bestScore < 2 };
}

module.exports = { SIGNATURES, classifyDocument };