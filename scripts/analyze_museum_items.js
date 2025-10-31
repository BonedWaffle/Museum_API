const fs = require('fs');
const path = require('path');

function analyzeMuseumItems() {
  const rawPath = path.resolve(__dirname, '..', 'data', 'raw_api_items.json');
  
  if (!fs.existsSync(rawPath)) {
    console.error('[error] Raw API data not found. Run fetch_api_items.js first.');
    return;
  }
  
  console.log('[analyze] Loading raw API data...');
  const data = JSON.parse(fs.readFileSync(rawPath, 'utf-8'));
  
  if (!data.items || !Array.isArray(data.items)) {
    console.error('[error] Invalid data structure');
    return;
  }
  
  console.log(`[analyze] Processing ${data.items.length} items...`);
  
  // Find items with museum property
  const museumItems = data.items.filter(item => item.museum === true);
  console.log(`[analyze] Items with museum=true: ${museumItems.length}`);
  
  // Find items with museum in name or category
  const museumRelated = data.items.filter(item => {
    const name = (item.name || '').toLowerCase();
    const category = (item.category || '').toLowerCase();
    const id = (item.id || '').toLowerCase();
    
    return name.includes('museum') || 
           category.includes('museum') || 
           id.includes('museum');
  });
  console.log(`[analyze] Items with 'museum' in name/category/id: ${museumRelated.length}`);
  
  // Analyze all categories to understand structure
  const categories = {};
  data.items.forEach(item => {
    const cat = item.category || 'UNKNOWN';
    if (!categories[cat]) {
      categories[cat] = { count: 0, samples: [] };
    }
    categories[cat].count++;
    if (categories[cat].samples.length < 3) {
      categories[cat].samples.push({
        id: item.id,
        name: item.name,
        tier: item.tier,
        museum: item.museum
      });
    }
  });
  
  console.log('\n[analyze] All categories with samples:');
  Object.entries(categories)
    .sort(([,a], [,b]) => b.count - a.count)
    .forEach(([cat, info]) => {
      console.log(`\n- ${cat}: ${info.count} items`);
      info.samples.forEach(sample => {
        console.log(`  * ${sample.id}: "${sample.name}" (${sample.tier}) ${sample.museum ? '[MUSEUM]' : ''}`);
      });
    });
  
  // Create a comprehensive museum dataset
  // Since there's no clear museum flag, we'll include all items that could be in museum
  const potentialMuseumCategories = [
    'SWORD', 'BOW', 'HELMET', 'CHESTPLATE', 'LEGGINGS', 'BOOTS',
    'ACCESSORY', 'WAND', 'FISHING_ROD', 'HOE', 'AXE', 'PICKAXE',
    'SHOVEL', 'SHEARS', 'COSMETIC', 'PET_ITEM', 'ARROW', 'DEPLOYABLE'
  ];
  
  const museumDataset = {};
  
  data.items.forEach(item => {
    if (potentialMuseumCategories.includes(item.category)) {
      const category = item.category.toLowerCase();
      if (!museumDataset[category]) {
        museumDataset[category] = [];
      }
      museumDataset[category].push(item.name);
    }
  });
  
  // Save the museum dataset
  const outputPath = path.resolve(__dirname, '..', 'data', 'api_museum_items.json');
  fs.writeFileSync(outputPath, JSON.stringify(museumDataset, null, 2), 'utf-8');
  
  console.log(`\n[analyze] Museum dataset created with ${Object.keys(museumDataset).length} categories:`);
  Object.entries(museumDataset).forEach(([cat, items]) => {
    console.log(`- ${cat}: ${items.length} items`);
  });
  
  console.log(`\n[analyze] Dataset saved to: ${outputPath}`);
  
  // Compare with existing dataset
  const existingPath = path.resolve(__dirname, '..', 'data', 'museum_items.json');
  if (fs.existsSync(existingPath)) {
    const existing = JSON.parse(fs.readFileSync(existingPath, 'utf-8'));
    
    console.log('\n[compare] Comparison with existing dataset:');
    console.log(`- Existing categories: ${Object.keys(existing).length}`);
    console.log(`- API categories: ${Object.keys(museumDataset).length}`);
    
    let existingTotal = 0;
    let apiTotal = 0;
    
    Object.values(existing).forEach(items => existingTotal += items.length);
    Object.values(museumDataset).forEach(items => apiTotal += items.length);
    
    console.log(`- Existing total items: ${existingTotal}`);
    console.log(`- API total items: ${apiTotal}`);
    
    // Find missing categories
    const existingCats = new Set(Object.keys(existing));
    const apiCats = new Set(Object.keys(museumDataset));
    
    const missingInApi = [...existingCats].filter(cat => !apiCats.has(cat));
    const newInApi = [...apiCats].filter(cat => !existingCats.has(cat));
    
    if (missingInApi.length > 0) {
      console.log(`- Categories in existing but not in API: ${missingInApi.join(', ')}`);
    }
    if (newInApi.length > 0) {
      console.log(`- New categories in API: ${newInApi.join(', ')}`);
    }
  }
  
  return museumDataset;
}

// Run the analysis
analyzeMuseumItems();