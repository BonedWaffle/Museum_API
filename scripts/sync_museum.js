// Sync museum items dataset from the Hypixel SkyBlock Wiki via Fandom Parse API
// Page: https://hypixel-skyblock.fandom.com/wiki/Museum/Items
// API:  https://hypixel-skyblock.fandom.com/api.php?action=parse&page=Museum/Items&prop=text&format=json

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const PAGE_URL = 'https://hypixel-skyblock.fandom.com/wiki/Museum/Items';
const API_URL = 'https://hypixel-skyblock.fandom.com/api.php?action=parse&page=Museum/Items&prop=text&format=json';

function normalizeKey(name) {
  return name
    .toLowerCase()
    .replace(/[_\-]/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pushUnique(list, name, seen) {
  const raw = (name || '').trim();
  if (!raw) return;
  const key = normalizeKey(raw);
  if (!key || key.length < 2) return;
  if (seen.has(key)) return;
  seen.add(key);
  list.push(raw);
}

function extractSection($, headingText) {
  const items = [];
  const seen = new Set();

  // Find the section headline span (mw-headline), then climb to parent h2
  const headline = $('span.mw-headline').filter((_, el) => {
    return cheerio(el).text().toLowerCase().includes(headingText.toLowerCase());
  }).first();
  if (headline.length === 0) return items;

  const start = headline.parent('h2');
  if (start.length === 0) return items;

  let node = start.next();
  while (node && node.length) {
    // Stop at the next section header
    if (node[0].tagName && node[0].tagName.toLowerCase() === 'h2') break;

    // Collect anchors
    node.find('a').each((_, a) => {
      pushUnique(items, cheerio(a).text(), seen);
    });

    // Collect lists and tables cells
    node.find('li, td, th').each((_, el) => {
      const txt = cheerio(el).text();
      txt.split(/\n+/).forEach(t => pushUnique(items, t, seen));
    });

    node = node.next();
  }

  // Basic cleanup of non-item phrases
  const blacklist = ['icon', 'notes', 'donating', 'unobtainable', 'recipe removed', 'persists'];
  return items.filter(n => {
    const key = normalizeKey(n);
    if (!key) return false;
    return !blacklist.some(b => key.includes(b));
  });
}

async function run() {
  console.log(`[sync] Fetching parse API: ${API_URL}`);
  const res = await fetch(API_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch wiki parse API: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  const html = json?.parse?.text?.['*'];
  if (!html) {
    throw new Error('Parse API returned no HTML content');
  }

  const $ = cheerio.load(html);
  const weapons = extractSection($, 'Weapons');
  const armor = extractSection($, 'Armor Sets');
  const accessories = extractSection($, 'Accessories');
  let special = extractSection($, 'Special');
  if (special.length === 0) special = extractSection($, 'Special Items');

  const dataset = {
    source: PAGE_URL,
    updatedAt: new Date().toISOString(),
    items: {
      weapons,
      armor,
      accessories,
      special,
    }
  };

  const outPath = path.resolve(__dirname, '..', 'data', 'museum_items.json');
  console.log(`[sync] Writing dataset: ${outPath}`);
  fs.writeFileSync(outPath, JSON.stringify(dataset, null, 2), 'utf-8');
  console.log(`[sync] Done. Counts => weapons:${weapons.length} armor:${armor.length} accessories:${accessories.length} special:${special.length}`);
}

run().catch(err => {
  console.error('[sync] Error:', err);
  process.exit(1);
});