/**
 * update-lang.js
 * Tự động thêm các key còn thiếu vào các file ngôn ngữ, dịch sang ngôn ngữ tương ứng.
 * Sử dụng Google Translate (unofficial) thông qua fetch.
 */

const fs = require('fs');
const path = require('path');

const LANG_DIR = path.join(__dirname, 'lang');

// Mapping: language code -> Google Translate language code
const LANG_CODES = {
  'ar': 'ar', 'cs': 'cs', 'da': 'da', 'de': 'de', 'el': 'el',
  'es': 'es', 'fi': 'fi', 'fr': 'fr', 'he': 'iw', 'hi': 'hi',
  'hu': 'hu', 'id': 'id', 'it': 'it', 'ja': 'ja', 'ko': 'ko',
  'ms': 'ms', 'nb': 'no', 'nl': 'nl', 'pl': 'pl', 'pt': 'pt',
  'ro': 'ro', 'ru': 'ru', 'sv': 'sv', 'th': 'th', 'tl': 'tl',
  'tr': 'tr', 'vi': 'vi', 'zh': 'zh-CN'
};

// Google Translate unofficial API
async function translateText(text, targetLang) {
  if (!text || text.trim() === '') return text;
  
  // Preserve HTML tags: replace with placeholders
  const tagMap = {};
  let tagIndex = 0;
  let processedText = text.replace(/<[^>]+>/g, (match) => {
    const key = `XTAG${tagIndex++}X`;
    tagMap[key] = match;
    return key;
  });

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${targetLang}&dt=t&q=${encodeURIComponent(processedText)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      console.warn(`  [WARN] Translate API failed for "${text.substring(0, 30)}..." (${response.status})`);
      return text;
    }
    
    const data = await response.json();
    let translated = '';
    if (data && data[0]) {
      for (const part of data[0]) {
        if (part && part[0]) translated += part[0];
      }
    }
    
    // Restore HTML tags
    for (const [key, tag] of Object.entries(tagMap)) {
      translated = translated.replace(new RegExp(key, 'g'), tag);
    }
    
    // Also restore escaped quotes pattern for tfa2.waitNote
    return translated;
  } catch (err) {
    console.warn(`  [WARN] Translate error for "${text.substring(0, 30)}...": ${err.message}`);
    return text;
  }
}

// Sleep helper to avoid rate limiting
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processLanguage(langCode) {
  const googleLang = LANG_CODES[langCode];
  if (!googleLang) {
    console.log(`[SKIP] No Google Translate code for: ${langCode}`);
    return;
  }
  
  const filePath = path.join(LANG_DIR, `${langCode}.json`);
  if (!fs.existsSync(filePath)) {
    console.log(`[SKIP] File not found: ${langCode}.json`);
    return;
  }
  
  const enPath = path.join(LANG_DIR, 'en.json');
  // Strip BOM if present
  const readJSON = (p) => {
    let raw = fs.readFileSync(p, 'utf-8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); // strip BOM
    return JSON.parse(raw);
  };
  const enData = readJSON(enPath);
  const langData = readJSON(filePath);
  
  // Find missing keys (skip internal keys like _dir)
  const enKeys = Object.keys(enData).filter(k => !k.startsWith('_'));
  const langKeys = new Set(Object.keys(langData));
  const missingKeys = enKeys.filter(k => !langKeys.has(k));
  
  if (missingKeys.length === 0) {
    console.log(`[OK] ${langCode}.json - Already up to date (${enKeys.length} keys)`);
    return;
  }
  
  console.log(`[UPDATE] ${langCode}.json - Missing ${missingKeys.length} keys, translating to ${googleLang}...`);
  
  const newEntries = {};
  for (let i = 0; i < missingKeys.length; i++) {
    const key = missingKeys[i];
    const enValue = enData[key];
    
    // Special handling for tfa2.waitNote (contains escaped HTML)
    let translated;
    if (key === 'tfa2.waitNote') {
      // Translate the visible parts manually keeping the HTML structure
      const waitNote = await translateText('Please wait', googleLang);
      const toSubmit = await translateText('to submit.', googleLang);
      translated = `${waitNote} <strong class=\\"count-time\\">00:00</strong> ${toSubmit}`;
    } else {
      translated = await translateText(enValue, googleLang);
    }
    
    newEntries[key] = translated;
    process.stdout.write(`  [${i+1}/${missingKeys.length}] ${key} ✓\n`);
    
    // Rate limiting: small delay between requests
    if ((i + 1) % 5 === 0) await sleep(300);
  }
  
  // Merge: keep existing keys in order, add new ones at end (remove _dir if present)
  const { _dir, ...cleanLangData } = langData;
  const updatedData = { ...cleanLangData, ...newEntries };
  
  // Write back WITHOUT BOM (save as clean UTF-8)
  fs.writeFileSync(filePath, JSON.stringify(updatedData, null, 2) + '\n', 'utf-8');
  console.log(`  ✅ ${langCode}.json updated (${Object.keys(updatedData).length} total keys)\n`);
}

async function main() {
  const langCodes = Object.keys(LANG_CODES);
  
  // Check if specific lang code was passed as argument
  const targetLang = process.argv[2];
  if (targetLang) {
    if (!LANG_CODES[targetLang]) {
      console.error(`Unknown language code: ${targetLang}`);
      process.exit(1);
    }
    await processLanguage(targetLang);
  } else {
    console.log(`Processing ${langCodes.length} languages...\n`);
    for (const langCode of langCodes) {
      await processLanguage(langCode);
      await sleep(200);
    }
  }
  
  console.log('\n🎉 Done!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
