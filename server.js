const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Helper: robust normalization usable across module scope
function normalizeName(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .replace(/§./g, '')
    .replace(/_/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Load museum items dataset (prefer Wiki-sourced data)
let museumItems = {};
let aliasMap = {};
try {
  const wikiDataPath = path.join(__dirname, 'data', 'wiki_museum_items.json');
  const apiDataPath = path.join(__dirname, 'data', 'api_museum_items.json');
  if (fs.existsSync(wikiDataPath)) {
    const wikiRaw = JSON.parse(fs.readFileSync(wikiDataPath, 'utf-8'));
    museumItems = wikiRaw.categories || {};
    aliasMap = wikiRaw.aliases || {};
    console.log('[server] Wiki-sourced museum dataset loaded:', Object.keys(museumItems).length, 'categories');
    const totalItems = Object.values(museumItems).reduce((sum, items) => sum + (Array.isArray(items) ? items.length : 0), 0);
    console.log('[server] Total museum items in dataset:', totalItems);
    console.log('[server] Aliases loaded:', Object.keys(aliasMap).length);
  } else if (fs.existsSync(apiDataPath)) {
    const apiData = fs.readFileSync(apiDataPath, 'utf-8');
    museumItems = JSON.parse(apiData);
    console.log('[server] API-sourced museum dataset loaded:', Object.keys(museumItems).length, 'categories');
    const totalItems = Object.values(museumItems).reduce((sum, items) => sum + items.length, 0);
    console.log('[server] Total museum items in dataset:', totalItems);
  } else {
    const manualData = fs.readFileSync(path.join(__dirname, 'data', 'museum_items.json'), 'utf-8');
    museumItems = JSON.parse(manualData);
    console.log('[server] Manual museum dataset loaded:', Object.keys(museumItems).length, 'categories');
  }
} catch (error) {
  console.warn('[server] No museum dataset found. Use /admin.html to populate data or run scripts/fetch_api_items.js');
}
const museumDataset = museumItems;

// Build item metadata index from raw API items for classification (still useful for future rules)
let itemIndex = {};
try {
  const rawItemsPath = path.join(__dirname, 'data', 'raw_api_items.json');
  if (fs.existsSync(rawItemsPath)) {
    const raw = JSON.parse(fs.readFileSync(rawItemsPath, 'utf-8'));
    if (Array.isArray(raw.items)) {
      for (const it of raw.items) {
        const key = normalizeName(it.name || it.id);
        if (!key) continue;
        if (!itemIndex[key]) {
          itemIndex[key] = { id: it.id, name: it.name, category: it.category, tier: it.tier };
        }
      }
      console.log('[server] Item index built:', Object.keys(itemIndex).length);
    }
  } else {
    console.warn('[server] raw_api_items.json not found; classification will be heuristic.');
  }
} catch (e) {
  console.warn('[server] Failed building item index:', e && e.message ? e.message : e);
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function selectProfile(profiles, uuid) {
  if (!profiles || !Array.isArray(profiles)) return null;
  const selected = profiles.find(p => p.selected);
  if (selected) return selected;
  try {
    const withLastSave = profiles
      .map(p => ({
        profile: p,
        lastSave: p.members?.[uuid?.replace(/-/g, '')]?.last_save || 0,
      }))
      .sort((a, b) => b.lastSave - a.lastSave);
    return withLastSave[0]?.profile || profiles[0];
  } catch (e) {
    return profiles[0];
  }
}

app.post('/api/museum', async (req, res) => {
  const { uuid, apiKey } = req.body || {};
  if (!uuid || !apiKey) {
    return res.status(400).json({ error: 'uuid and apiKey are required' });
  }

  try {
    const profilesUrl = `https://api.hypixel.net/v2/skyblock/profiles?key=${encodeURIComponent(apiKey)}&uuid=${encodeURIComponent(uuid)}`;
    const profilesResp = await fetch(profilesUrl, { headers: { 'User-Agent': 'MuseumTracker/1.0' } });
    const profilesJson = await profilesResp.json();

    if (!profilesJson?.success) {
      return res.status(502).json({ error: 'Failed to fetch profiles', details: profilesJson });
    }
    const selectedProfile = selectProfile(profilesJson.profiles, uuid);
    if (!selectedProfile) {
      return res.status(404).json({ error: 'No profiles found for this UUID' });
    }
    const profileId = selectedProfile.profile_id;

    const museumUrl = `https://api.hypixel.net/v2/skyblock/museum?key=${encodeURIComponent(apiKey)}&profile=${encodeURIComponent(profileId)}`;
    const museumResp = await fetch(museumUrl, { headers: { 'User-Agent': 'MuseumTracker/1.0' } });
    const museumJson = await museumResp.json();

    if (!museumJson?.success) {
      return res.status(502).json({ error: 'Failed to fetch museum', details: museumJson });
    }

    try {
      const logsDir = path.join(__dirname, 'data', 'logs');
      fs.mkdirSync(logsDir, { recursive: true });
      const safeUuid = String(uuid).replace(/[^a-zA-Z0-9_-]/g, '');
      const safeProfile = String(profileId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '');
      const logFile = path.join(logsDir, `museum_${safeUuid}_${safeProfile}_${Date.now()}.json`);
      fs.writeFileSync(logFile, JSON.stringify(museumJson, null, 2), 'utf-8');
    } catch (e) {
      console.warn('Failed to write museum log:', e && e.message ? e.message : e);
    }

    const memberKey = uuid.replace(/-/g, '');
    const museumMember = museumJson?.museum?.members?.[memberKey] || museumJson?.members?.[memberKey] || null;

    let donatedCount = 0;
    let categories = [];

    const donatedByCategory = {};
    const donatedAll = new Set();

    function pushName(cat, name) {
      const n = normalizeName(name);
      if (!n) return;
      if (!donatedByCategory[cat]) donatedByCategory[cat] = new Set();
      donatedByCategory[cat].add(n);
      donatedAll.add(n);
      // Resolve aliases: if this donated item is an alias, mark its base as donated too
      const base = aliasMap[n];
      if (base) donatedAll.add(base);
    }

    if (museumJson?.profile?.items || museumJson?.profile?.special) {
      const itemsObj = museumJson.profile.items || {};
      const specialArr = museumJson.profile.special || [];
      const itemCats = Object.keys(itemsObj);
      categories = itemCats.length ? itemCats : categories;
      for (const k of itemCats) {
        const items = itemsObj[k];
        if (items && typeof items === 'object') {
          const itemKeys = Object.keys(items);
          donatedCount += itemKeys.length;
          for (const itemKey of itemKeys) {
            pushName(k, itemKey);
          }
        }
      }
      if (Array.isArray(specialArr)) {
        donatedCount += specialArr.length;
        for (const it of specialArr) {
          const name = it?.name || it?.display_name || it?.item_id || it?.id || (typeof it === 'string' ? it : null);
          pushName('special', name);
        }
      }
    } else if (museumMember) {
      const catKeys = Object.keys(museumMember);
      categories = catKeys;
      for (const k of catKeys) {
        const items = museumMember[k];
        if (Array.isArray(items)) {
          donatedCount += items.filter(Boolean).length;
          for (const it of items) {
            const name = it?.name || it?.display_name || it?.item_id || it?.id || (typeof it === 'string' ? it : null);
            pushName(k, name);
          }
        } else if (items && typeof items === 'object') {
          const itemKeys = Object.keys(items);
          donatedCount += itemKeys.length;
          for (const itemKey of itemKeys) {
            pushName(k, itemKey);
          }
        }
      }
    }

    const missing = [];
    const datasetItems = museumDataset && typeof museumDataset === 'object' ? museumDataset : null;
    const targetCatsMap = {
      'Weapons': 'Weapons',
      'Armor Sets': 'Armor Sets',
      'Rarities': 'Rarities',
      'Special': 'Special',
      'Special Items': 'Special'
    };
    let totalCount = 0;
    const uniqueDatasetItems = new Set(); // track unique items across all categories
    const seenMissing = new Set();

    if (datasetItems) {
      for (const [cat, list] of Object.entries(datasetItems)) {
        const mappedCat = targetCatsMap[cat] || null;
        if (!mappedCat) continue;
        const arr = Array.isArray(list) ? list : [];
        for (const itemName of arr) {
          const norm = normalizeName(itemName);
          if (!uniqueDatasetItems.has(norm)) {
            uniqueDatasetItems.add(norm);
            totalCount += 1;
          }
          // Consider alias: if norm is a base item, and any alias donor donated, donatedAll will include base
          if (!donatedAll.has(norm)) {
            const key = `${mappedCat}|${norm}`;
            if (!seenMissing.has(key)) {
              missing.push({ category: mappedCat, name: itemName });
              seenMissing.add(key);
            }
          }
        }
      }
    }

    const completionPct = uniqueDatasetItems.size > 0 ? Math.round((donatedCount / uniqueDatasetItems.size) * 100) : null;

    res.json({
      success: true,
      profileId,
      categories,
      counts: { donated: donatedCount, total: uniqueDatasetItems.size > 0 ? uniqueDatasetItems.size : null, completionPct },
      missing,
      hints: (
        (uniqueDatasetItems.size === 0) ? ['Completion percentage requires a populated dataset; currently using raw donations only.'] : []
      ),
      raw: museumJson,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unexpected server error', details: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`Museum Tracker server running on http://localhost:${PORT}`);
});