const fs = require('fs');
const path = require('path');

const API_URL = 'https://api.hypixel.net/resources/skyblock/items';

async function fetchAllItems() {
  console.log(`[fetch] Fetching items from Hypixel API: ${API_URL}`);
  
  try {
    const response = await fetch(API_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log(`[fetch] Success! Received ${Object.keys(data.items || {}).length} items`);
    
    // Save raw response for analysis
    const rawPath = path.resolve(__dirname, '..', 'data', 'raw_api_items.json');
    fs.writeFileSync(rawPath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`[fetch] Raw data saved to: ${rawPath}`);
    
    // Analyze the structure
    console.log('\n[analysis] Data structure:');
    console.log('- Success:', data.success);
    console.log('- Last Updated:', data.lastUpdated);
    console.log('- Items count:', Object.keys(data.items || {}).length);
    
    if (data.items) {
      // Sample a few items to understand structure
      const itemKeys = Object.keys(data.items).slice(0, 5);
      console.log('\n[analysis] Sample items:');
      itemKeys.forEach(key => {
        const item = data.items[key];
        console.log(`- ${key}:`, {
          name: item.name,
          category: item.category,
          tier: item.tier,
          museum: item.museum || 'not specified'
        });
      });
      
      // Look for museum-specific indicators
      const museumItems = Object.entries(data.items).filter(([key, item]) => {
        return item.museum === true || 
               item.category?.toLowerCase().includes('museum') ||
               item.name?.toLowerCase().includes('museum');
      });
      
      console.log(`\n[analysis] Items with museum indicators: ${museumItems.length}`);
      if (museumItems.length > 0) {
        museumItems.slice(0, 3).forEach(([key, item]) => {
          console.log(`- ${key}: ${item.name} (${item.category})`);
        });
      }
      
      // Analyze categories
      const categories = {};
      Object.values(data.items).forEach(item => {
        const cat = item.category || 'unknown';
        categories[cat] = (categories[cat] || 0) + 1;
      });
      
      console.log('\n[analysis] Categories found:');
      Object.entries(categories)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .forEach(([cat, count]) => {
          console.log(`- ${cat}: ${count} items`);
        });
    }
    
    return data;
    
  } catch (error) {
    console.error('[fetch] Error:', error.message);
    throw error;
  }
}

// Run the script
fetchAllItems().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});