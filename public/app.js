const form = document.getElementById('query-form');
const uuidInput = document.getElementById('uuid');
const apiKeyInput = document.getElementById('apiKey');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  statusEl.textContent = 'Fetching museum progress…';
  resultsEl.innerHTML = '';

  const uuid = uuidInput.value.trim();
  const apiKey = apiKeyInput.value.trim();

  if (!uuid || !apiKey) {
    statusEl.textContent = 'Please provide both UUID and API Key.';
    return;
  }

  try {
    const resp = await fetch('/api/museum', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uuid, apiKey }),
    });

    const data = await resp.json();
    if (!resp.ok || !data.success) {
      statusEl.textContent = 'Could not fetch museum data.';
      resultsEl.innerHTML = `<pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
      return;
    }

    statusEl.textContent = 'Success!';

    const { counts, categories, profileId, missing = [], hints = [] } = data;
    const donated = counts?.donated ?? '—';
    const total = counts?.total ?? '—';
    const pct = counts?.completionPct ?? '—';

    const statsHtml = `
      <div class="stat-grid">
        <div class="stat"><h3>Profile ID</h3><div class="value">${escapeHtml(profileId || '—')}</div></div>
        <div class="stat"><h3>Donated Items</h3><div class="value">${donated}</div></div>
        <div class="stat"><h3>Completion %</h3><div class="value">${pct === null ? '—' : pct + '%'}</div></div>
      </div>
    `;

    const catsHtml = categories?.length
      ? `<p>Categories detected: ${categories.map(escapeHtml).join(', ')}</p>`
      : '';

    const missingByCat = groupBy(missing, 'category');
    const categoryOrder = ['Weapons', 'Armor Sets', 'Rarities', 'Special'];
    const orderedMissing = Object.entries(missingByCat)
      .sort((a, b) => categoryOrder.indexOf(a[0]) - categoryOrder.indexOf(b[0]));

    const missingHtml = orderedMissing.length
      ? `
        <h2>Missing Items</h2>
        ${orderedMissing.map(([cat, items]) => {
          const list = items.map(i => `<li>${escapeHtml(i.name)}</li>`).join('') || '<li>None</li>';
          return `<div class="missing-cat"><h3>${escapeHtml(cat)}</h3><ul>${list}</ul></div>`;
        }).join('')}
      `
      : '';

    const hintsHtml = hints?.length ? `<p>${hints.map(escapeHtml).join('<br/>')}</p>` : '';

    const rawHtml = `<details><summary>Raw API Response</summary><pre>${escapeHtml(JSON.stringify(data.raw, null, 2))}</pre></details>`;

    resultsEl.innerHTML = statsHtml + catsHtml + missingHtml + hintsHtml + rawHtml;

  } catch (err) {
    statusEl.textContent = 'Unexpected error.';
    resultsEl.innerHTML = `<pre>${escapeHtml(String(err))}</pre>`;
  }
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function groupBy(arr, key) {
  const out = {};
  for (const item of arr || []) {
    const k = item?.[key];
    if (!k) continue;
    if (!out[k]) out[k] = [];
    out[k].push(item);
  }
  return out;
}