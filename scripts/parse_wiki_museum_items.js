const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'Element_wiki');
const OUT_PATH = path.join(ROOT, 'data', 'wiki_museum_items.json');

function readHtml(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Wiki HTML file not found at ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function decodeHtml(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function normalizeName(s) {
  return s
    .toLowerCase()
    .replace(/§./g, '') // strip color codes
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function dedupe(names) {
  const seen = new Set();
  const out = [];
  for (const n of names) {
    const key = normalizeName(n);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(n);
    }
  }
  return out;
}

function extractSectionItemsAndAliases(sectionHtml) {
  const items = [];
  const aliases = {}; // normalized alias -> normalized base item name

  const rowRe = /<tr[^>]*>[\s\S]*?<\/tr>/g;
  const tdRe = /<td[\s\S]*?>[\s\S]*?<\/td>/g;
  for (const rowMatch of sectionHtml.matchAll(rowRe)) {
    const rowHtml = rowMatch[0];
    if (/<th/i.test(rowHtml)) continue; // skip header rows
    const tds = [...rowHtml.matchAll(tdRe)].map(m => m[0]);
    if (tds.length < 2) continue;

    const itemTd = tds[1];
    const aMatch = itemTd.match(/<a [^>]*title="([^"]+)"[^>]*>/i);
    if (!aMatch) continue;
    const itemName = decodeHtml(aMatch[1]).trim();
    if (!itemName) continue;
    items.push(itemName);

    // Parse notes cell for alias items that count towards this base item
    if (tds[2]) {
      const notesTd = tds[2];
      const aliasAnchors = [...notesTd.matchAll(/<a [^>]*title="([^"]+)"[^>]*>/ig)];
      for (const am of aliasAnchors) {
        const aliasName = decodeHtml(am[1]).trim();
        if (!aliasName) continue;
        const aliasKey = normalizeName(aliasName);
        const baseKey = normalizeName(itemName);
        if (aliasKey && baseKey && aliasKey !== baseKey) {
          aliases[aliasKey] = baseKey;
        }
      }
    }
  }
  return { items: dedupe(items), aliases };
}

function extractCategories(html) {
  const categories = {};
  const aliases = {};
  const headerRe = /<th[^>]*colspan="3"[^>]*>\s*<b>([^<]+)<\/b>/ig;
  const headers = [];
  for (const m of html.matchAll(headerRe)) {
    headers.push({ name: decodeHtml(m[1]).trim(), start: m.index, end: m.index + m[0].length });
  }
  for (let i = 0; i < headers.length; i++) {
    const cur = headers[i];
    const nextStart = i + 1 < headers.length ? headers[i + 1].start : html.length;
    const sectionHtml = html.slice(cur.end, nextStart);
    const { items, aliases: sectionAliases } = extractSectionItemsAndAliases(sectionHtml);
    if (items.length) categories[cur.name] = items;
    for (const [a, b] of Object.entries(sectionAliases)) {
      if (!aliases[a]) aliases[a] = b; // prefer first mapping
    }
  }
  return { categories, aliases };
}

function main() {
  const html = readHtml(HTML_PATH);
  const { categories, aliases } = extractCategories(html);
  const categoryNames = Object.keys(categories);
  const totalItems = Object.values(categories).reduce((sum, arr) => sum + arr.length, 0);

  const output = {
    source: 'Element_wiki',
    generated_at: new Date().toISOString(),
    category_count: categoryNames.length,
    total_items: totalItems,
    categories,
    aliases,
  };

  const dataDir = path.dirname(OUT_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), 'utf8');

  console.log(`Saved wiki museum dataset: ${categoryNames.length} categories, ${totalItems} items`);
  console.log(`Categories: ${categoryNames.join(', ')}`);
  console.log(`Aliases captured: ${Object.keys(aliases).length}`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('Failed to parse wiki HTML:', err.message);
    process.exitCode = 1;
  }
}