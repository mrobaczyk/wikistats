(() => {
  'use strict';

  const DB_NAME = 'wiki-activity-cache';
  const DB_VERSION = 1;
  const STORE_NAME = 'contributions';
  const PALETTE = ['#176d54', '#dc654c', '#e9b74e', '#5c8fa3', '#779c64', '#bb7650', '#7587a0', '#9d9a58'];
  const NAMESPACE_NAMES = {
    '-2': 'Media', '-1': 'Special', '0': 'Main', '1': 'Talk', '2': 'User', '3': 'User talk',
    '4': 'Civilization Wiki', '5': 'Civilization Wiki talk', '6': 'File', '7': 'File talk', '8': 'MediaWiki',
    '9': 'MediaWiki talk', '10': 'Template', '11': 'Template talk', '12': 'Help', '13': 'Help talk',
    '14': 'Category', '15': 'Category talk', '420': 'Gadget', '421': 'Gadget talk', '828': 'Module', '829': 'Module talk'
  };
  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const charts = new Map();
  let database;
  let currentContributions = [];

  const $ = (selector) => document.querySelector(selector);
  const elements = {
    wiki: $('#wiki-input'), mainUser: $('#main-user-input'), botUser: $('#bot-user-input'),
    status: $('#status-message'), detail: $('#sync-detail'), sync: $('#sync-button'), fullSync: $('#full-sync-button')
  };

  function setStatus(message, detail = '') {
    elements.status.textContent = message;
    elements.detail.textContent = detail;
  }

  function identity(username) {
    return `${elements.wiki.value.trim().toLowerCase()}|${username.trim().toLowerCase()}`;
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      request.onsuccess = () => { database = request.result; resolve(database); };
      request.onerror = () => reject(request.error);
    });
  }

  function readCache(id) {
    return new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  function writeCache(id, username, contributions) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put({ id, username, contributions, updatedAt: new Date().toISOString() });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  }

  function normalizeContribution(record, username) {
    return {
      ...record,
      user: record.user || username,
      ns: Number.isFinite(Number(record.ns)) ? Number(record.ns) : 0,
      sizediff: record.sizediff === undefined || record.sizediff === null || record.sizediff === '' ? null : Number(record.sizediff),
      timestamp: record.timestamp || ''
    };
  }

  function contributionKey(record) {
    if (record.revid) return `rev:${record.revid}`;
    return `${record.user || ''}|${record.timestamp || ''}|${record.title || ''}|${record.sizediff ?? ''}`;
  }

  function mergeContributions(existing, incoming, username) {
    const merged = new Map();
    for (const record of [...existing, ...incoming]) {
      const normalized = normalizeContribution(record, username);
      merged.set(contributionKey(normalized), normalized);
    }
    return [...merged.values()].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
  }

  async function fetchContributions(username, since, onPage) {
    const params = new URLSearchParams({
      action: 'query', list: 'usercontribs', ucuser: username, uclimit: 'max',
      ucprop: 'timestamp|title|sizediff|comment', format: 'json', origin: '*'
    });
    if (since) {
      params.set('ucstart', new Date().toISOString());
      params.set('ucend', since);
      params.set('ucsort', 'older');
    }

    const results = [];
    let page = 0;
    while (true) {
      const response = await fetch(`https://${elements.wiki.value.trim()}.fandom.com/api.php?${params}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`API returned HTTP ${response.status}.`);
      const payload = await response.json();
      if (payload.error) throw new Error(payload.error.info || 'The API returned an error.');
      const batch = payload.query?.usercontribs || [];
      results.push(...batch);
      page += 1;
      onPage(page, results.length);
      if (!payload.continue) break;
      for (const [key, value] of Object.entries(payload.continue)) params.set(key, value);
    }
    return results;
  }

  function newestTimestamp(contributions) {
    return contributions.reduce((newest, record) => record.timestamp && record.timestamp > newest ? record.timestamp : newest, '');
  }

  async function syncUser(username, fullHistory, role) {
    if (!username.trim()) return { count: 0, skipped: true };
    const id = identity(username);
    const cached = await readCache(id);
    const existing = cached?.contributions || [];
    const since = !fullHistory && existing.length ? newestTimestamp(existing) : null;
    const fresh = await fetchContributions(username, since, (page, count) => {
      setStatus(`${role}: fetching ${since ? 'recent edits' : 'history'}…`, `${count.toLocaleString('en-US')} records · page ${page}`);
    });
    const combined = mergeContributions(existing, fresh, username);
    await writeCache(id, username, combined);
    return { count: fresh.length, total: combined.length, username };
  }

  async function syncAll(fullHistory) {
    if (!/^[a-z0-9-]+$/i.test(elements.wiki.value.trim())) {
      setStatus('Invalid wiki subdomain.', 'Use letters, numbers, or hyphens.');
      return;
    }
    const mainUser = elements.mainUser.value.trim();
    if (!mainUser) { setStatus('Enter a main account name.'); return; }
    saveSettings();
    elements.sync.disabled = true;
    elements.fullSync.disabled = true;
    const started = Date.now();
    try {
      const results = await Promise.all([
        syncUser(mainUser, fullHistory, 'Main account'),
        elements.botUser.value.trim() ? syncUser(elements.botUser.value.trim(), fullHistory, 'Bot') : Promise.resolve({ skipped: true })
      ]);
      await render();
      const added = results.reduce((total, result) => total + (result.count || 0), 0);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      setStatus(added ? 'Sync complete.' : 'Data is up to date.', `${added.toLocaleString('en-US')} edits fetched · ${seconds} s`);
    } catch (error) {
      setStatus(`Sync failed: ${error.message}`, 'Check the wiki name, connection, and API availability.');
    } finally {
      elements.sync.disabled = false;
      elements.fullSync.disabled = false;
    }
  }

  function saveSettings() {
    localStorage.setItem('wiki-activity-settings', JSON.stringify({
      wiki: elements.wiki.value.trim(), mainUser: elements.mainUser.value.trim(), botUser: elements.botUser.value.trim()
    }));
    $('#wiki-label').textContent = `${elements.wiki.value.trim()}.fandom.com`;
  }

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem('wiki-activity-settings') || '{}');
      if (saved.wiki) elements.wiki.value = saved.wiki;
      if (saved.mainUser) elements.mainUser.value = saved.mainUser;
      if (saved.botUser !== undefined) elements.botUser.value = saved.botUser;
    } catch { /* Ignore damaged preferences and use defaults. */ }
    saveSettings();
  }

  async function seedFromPublishedFiles() {
    const candidates = [
      { username: 'Robal91', file: 'fandom_edits.json' },
      { username: 'RobalBot', file: 'fandom_edits_bot.json' }
    ];
    for (const candidate of candidates) {
      if (!candidate.username || (await readCache(identity(candidate.username)))) continue;
      try {
        const response = await fetch(candidate.file);
        if (!response.ok) continue;
        const data = await response.json();
        if (Array.isArray(data) && data.length) await writeCache(identity(candidate.username), candidate.username, mergeContributions([], data, candidate.username));
      } catch { /* Published data files are optional. */ }
    }
  }

  function createChart(canvasId, key, config) {
    if (charts.has(key)) charts.get(key).destroy();
    const chart = new Chart(document.getElementById(canvasId), {
      ...config,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 350 },
        plugins: {
          legend: { labels: { color: '#65736c', usePointStyle: true, boxWidth: 7, font: { family: 'Manrope', size: 10 } } },
          tooltip: { backgroundColor: '#1d2825', padding: 10, titleFont: { family: 'Manrope' }, bodyFont: { family: 'Manrope' } },
          ...(config.options?.plugins || {})
        },
        scales: config.type === 'doughnut' ? undefined : {
          x: { grid: { color: '#edf0ed' }, ticks: { color: '#7e8983', font: { family: 'DM Mono', size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 }, ...(config.options?.scales?.x || {}) },
          y: { beginAtZero: true, grid: { color: '#edf0ed' }, ticks: { color: '#7e8983', font: { family: 'DM Mono', size: 9 } }, ...(config.options?.scales?.y || {}) }
        },
        ...(config.options || {})
      },
      plugins: [{
        id: 'whiteBackground',
        beforeDraw(chartInstance) {
          const { ctx, width, height } = chartInstance;
          ctx.save(); ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height); ctx.restore();
        }
      }]
    });
    charts.set(key, chart);
  }

  function formatBytes(value) {
    if (!Number.isFinite(value) || value === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(Math.abs(value)) / Math.log(1024)), units.length - 1);
    const amount = value / (1024 ** index);
    return `${amount > 0 ? '+' : ''}${amount.toLocaleString('en-US', { maximumFractionDigits: 1 })} ${units[index]}`;
  }

  function renderStats(main, bot, all) {
    const pages = new Set(all.map((record) => record.title).filter(Boolean));
    const sizedRecords = all.filter((record) => Number.isFinite(record.sizediff));
    const netBytes = sizedRecords.reduce((sum, record) => sum + record.sizediff, 0);
    const timestamps = all.map((record) => Date.parse(record.timestamp)).filter(Number.isFinite);
    const start = timestamps.length ? new Date(Math.min(...timestamps)) : null;
    const end = timestamps.length ? new Date(Math.max(...timestamps)) : null;
    $('#stat-edits').textContent = all.length.toLocaleString('en-US');
    $('#stat-edits-note').textContent = `${(main.contributions || []).length.toLocaleString('en-US')} main · ${(bot.contributions || []).length.toLocaleString('en-US')} bot`;
    $('#stat-pages').textContent = pages.size.toLocaleString('en-US');
    $('#stat-bytes').textContent = formatBytes(netBytes);
    $('#stat-bytes').title = `${sizedRecords.length.toLocaleString('en-US')} edits with size data`;
    $('#stat-period').textContent = start && end ? `${start.getFullYear()}–${end.getFullYear()}` : '—';
    $('#stat-period-note').textContent = start && end ? `${start.toLocaleDateString('en-US')} — ${end.toLocaleDateString('en-US')}` : 'no dates';
    $('#record-count').textContent = `${all.length.toLocaleString('en-US')} records · ${sizedRecords.length.toLocaleString('en-US')} with sizediff`;
    const updatedAt = [main.updatedAt, bot.updatedAt].filter(Boolean).sort().at(-1);
    $('#last-updated').textContent = updatedAt ? `SAVED ${new Date(updatedAt).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}` : 'NO DATA';
  }

  function renderTimeline(all) {
    const daily = new Map();
    for (const record of all) {
      const date = new Date(record.timestamp);
      if (!Number.isFinite(date.getTime())) continue;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      daily.set(key, (daily.get(key) || 0) + 1);
    }
    const dates = [...daily.keys()].sort();
    const averages = dates.map((_, index) => {
      const values = dates.slice(Math.max(0, index - 29), index + 1).map((date) => daily.get(date));
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    });
    createChart('timeline-chart', 'timeline', {
      type: 'line', data: { labels: dates, datasets: [
        { label: 'Daily edits', data: dates.map((date) => daily.get(date)), borderColor: '#5c8fa3', backgroundColor: '#5c8fa329', pointRadius: 0, borderWidth: 1.4, fill: true, tension: .16 },
        { label: '30-active-day average', data: averages, borderColor: '#dc654c', pointRadius: 0, borderWidth: 2, tension: .28 }
      ] }, options: {
        plugins: { legend: { position: window.matchMedia('(max-width: 760px)').matches ? 'bottom' : 'top' } },
        scales: { x: { ticks: { maxTicksLimit: 10 } } }
      }
    });
  }

  function renderNamespaces(all) {
    const counts = new Map();
    all.forEach((record) => counts.set(record.ns, (counts.get(record.ns) || 0) + 1));
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    createChart('namespaces-chart', 'namespaces', {
      type: 'doughnut', data: { labels: entries.map(([ns]) => NAMESPACE_NAMES[ns] || `NS ${ns}`), datasets: [{ data: entries.map(([, count]) => count), backgroundColor: entries.map((_, index) => PALETTE[index % PALETTE.length]), borderColor: '#fff', borderWidth: 2 }] },
      options: { cutout: '62%', plugins: { legend: { position: window.matchMedia('(max-width: 760px)').matches ? 'bottom' : 'right', labels: { boxWidth: 8, padding: 10 } } } }
    });
  }

  function renderPages(all) {
    const counts = new Map();
    all.forEach((record) => { if (record.title) counts.set(record.title, (counts.get(record.title) || 0) + 1); });
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
    const maxLabelLength = window.matchMedia('(max-width: 760px)').matches ? 22 : 32;
    createChart('pages-chart', 'pages', {
      type: 'bar', data: { labels: entries.map(([title]) => title), datasets: [{ label: 'Edits', data: entries.map(([, count]) => count), backgroundColor: '#176d54', borderRadius: 2, barThickness: 12 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { precision: 0 } }, y: { reverse: true, grid: { display: false }, ticks: { autoSkip: false, callback(value) { const label = this.getLabelForValue(value); return label.length > maxLabelLength ? `${label.slice(0, maxLabelLength - 1)}…` : label; } } } } }
    });
  }

  function renderSizes(all) {
    const values = all.map((record) => record.sizediff).filter(Number.isFinite);
    const labels = ['< -1k', '-1k…-100', '-100…-10', '-10…-1', '0', '1…10', '10…100', '100…1k', '> 1k'];
    const buckets = Array(labels.length).fill(0);
    values.forEach((value) => {
      const index = value < -1000 ? 0 : value <= -100 ? 1 : value <= -10 ? 2 : value < 0 ? 3 : value === 0 ? 4 : value <= 10 ? 5 : value <= 100 ? 6 : value <= 1000 ? 7 : 8;
      buckets[index] += 1;
    });
    createChart('sizes-chart', 'sizes', {
      type: 'bar', data: { labels, datasets: [{ label: 'Number of edits', data: buckets, backgroundColor: labels.map((_, index) => index < 4 ? '#dc654c' : index === 4 ? '#9ba69f' : '#176d54'), borderRadius: 2 }] },
      options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { ticks: { precision: 0 } } } }
    });
  }

  function renderMonthly(main, bot) {
    const countByMonth = (records) => {
      const counts = new Map();
      records.forEach((record) => {
        const date = new Date(record.timestamp);
        if (Number.isFinite(date.getTime())) {
          const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          counts.set(key, (counts.get(key) || 0) + 1);
        }
      });
      return counts;
    };
    const mainCounts = countByMonth(main.contributions || []);
    const botCounts = countByMonth(bot.contributions || []);
    const months = [...new Set([...mainCounts.keys(), ...botCounts.keys()])].sort();
    createChart('monthly-chart', 'monthly', {
      type: 'bar', data: { labels: months, datasets: [
        { label: main.username || elements.mainUser.value, data: months.map((month) => mainCounts.get(month) || 0), backgroundColor: '#176d54', stack: 'edits' },
        { label: bot.username || elements.botUser.value || 'Bot', data: months.map((month) => botCounts.get(month) || 0), backgroundColor: '#dc654c', stack: 'edits' }
      ] }, options: { scales: { x: { stacked: true }, y: { stacked: true, ticks: { precision: 0 } } } }
    });
  }

  function renderHeatmap(all) {
    const canvas = $('#heatmap-chart');
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    const context = canvas.getContext('2d');
    context.scale(ratio, ratio);
    const width = rect.width;
    const height = rect.height;
    const left = 43, top = 11, bottom = 28, right = 8;
    const cellWidth = (width - left - right) / 24;
    const cellHeight = (height - top - bottom) / 7;
    const matrix = Array.from({ length: 7 }, () => Array(24).fill(0));
    all.forEach((record) => {
      const date = new Date(record.timestamp);
      if (!Number.isFinite(date.getTime())) return;
      const weekday = (date.getDay() + 6) % 7;
      matrix[weekday][date.getHours()] += 1;
    });
    const max = Math.max(1, ...matrix.flat());
    context.font = '10px Manrope, sans-serif';
    context.textBaseline = 'middle';
    context.fillStyle = '#7e8983';
    DAY_LABELS.forEach((day, row) => {
      context.textAlign = 'right';
      context.fillText(day, left - 8, top + row * cellHeight + cellHeight / 2);
      for (let hour = 0; hour < 24; hour += 1) {
        const intensity = matrix[row][hour] / max;
        context.fillStyle = intensity ? `rgba(23,109,84,${0.12 + intensity * 0.82})` : '#edf1ed';
        context.beginPath();
        const x = left + hour * cellWidth + 1;
        const y = top + row * cellHeight + 1;
        const radius = Math.min(2, cellWidth / 4, cellHeight / 4);
        context.roundRect(x, y, Math.max(1, cellWidth - 2), Math.max(1, cellHeight - 2), radius);
        context.fill();
      }
    });
    context.fillStyle = '#7e8983';
    context.textAlign = 'center';
    for (let hour = 0; hour < 24; hour += 3) context.fillText(String(hour).padStart(2, '0'), left + hour * cellWidth + cellWidth / 2, height - 11);
  }

  async function render() {
    const main = await readCache(identity(elements.mainUser.value.trim())) || { contributions: [], username: elements.mainUser.value.trim() };
    const bot = elements.botUser.value.trim() ? await readCache(identity(elements.botUser.value.trim())) : { contributions: [] };
    const mainRecords = main.contributions || [];
    const botRecords = bot?.contributions || [];
    const all = [...mainRecords, ...botRecords];
    currentContributions = all;
    renderStats(main, bot || { contributions: [] }, all);
    if (typeof Chart === 'undefined') {
      setStatus('Could not load the chart library.', 'Check access to cdn.jsdelivr.net.');
      return;
    }
    renderTimeline(all);
    renderNamespaces(all);
    renderPages(all);
    renderSizes(all);
    renderMonthly(main, bot || { contributions: [] });
    renderHeatmap(all);
  }

  function downloadBlob(blob, filename) {
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url; link.download = filename; link.click();
    URL.revokeObjectURL(url);
  }

  function exportJson(username) {
    if (!username) { setStatus('Enter an account name before exporting data.'); return; }
    readCache(identity(username)).then((cached) => {
      if (!cached) { setStatus(`No saved data for ${username}.`); return; }
      const blob = new Blob([JSON.stringify(cached.contributions, null, 2)], { type: 'application/json' });
      const filename = elements.botUser.value.trim() && username.toLowerCase() === elements.botUser.value.trim().toLowerCase() ? 'fandom_edits_bot.json' : 'fandom_edits.json';
      downloadBlob(blob, filename);
      setStatus(`Exported data for ${username}.`, `${cached.contributions.length.toLocaleString('en-US')} records`);
    }).catch((error) => setStatus(`Export failed: ${error.message}`));
  }

  async function importJson(file, username) {
    if (!file || !username) { setStatus('Enter an account name before importing a file.'); return; }
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed)) throw new Error('The file must contain a JSON array of contribution records.');
      const existing = await readCache(identity(username));
      const combined = mergeContributions(existing?.contributions || [], parsed, username);
      await writeCache(identity(username), username, combined);
      await render();
      setStatus(`Imported data for ${username}.`, `${parsed.length.toLocaleString('en-US')} records in file`);
    } catch (error) { setStatus(`Import failed: ${error.message}`); }
  }

  function downloadChart(key) {
    if (key === 'heatmap') {
      $('#heatmap-chart').toBlob((blob) => { if (blob) downloadBlob(blob, 'fandom_activity_hours.png'); });
      return;
    }
    const chart = charts.get(key);
    if (!chart) { setStatus('Wykres nie jest jeszcze gotowy do pobrania.'); return; }
    const link = document.createElement('a');
    link.href = chart.toBase64Image('image/png', 1);
    link.download = `fandom_activity_${key}.png`;
    link.click();
  }

  async function initialize() {
    loadSettings();
    [elements.wiki, elements.mainUser, elements.botUser].forEach((input) => input.addEventListener('change', saveSettings));
    elements.sync.addEventListener('click', () => syncAll(false));
    elements.fullSync.addEventListener('click', () => syncAll(true));
    $('#export-main-json').addEventListener('click', () => exportJson(elements.mainUser.value.trim()));
    $('#export-bot-json').addEventListener('click', () => exportJson(elements.botUser.value.trim()));
    $('#main-file-input').addEventListener('change', (event) => importJson(event.target.files[0], elements.mainUser.value.trim()));
    $('#bot-file-input').addEventListener('change', (event) => importJson(event.target.files[0], elements.botUser.value.trim()));
    document.querySelectorAll('.download-chart').forEach((button) => button.addEventListener('click', () => downloadChart(button.dataset.chart)));
    window.addEventListener('resize', () => {
      if ($('#heatmap-chart').width) renderHeatmap(currentContributions);
    });

    try {
      await openDatabase();
      await seedFromPublishedFiles();
      await render();
      const currentCount = (await readCache(identity(elements.mainUser.value.trim())))?.contributions?.length || 0;
      setStatus(currentCount ? 'Data loaded from local cache.' : 'No saved data. Run Sync latest to fetch contribution history.');
    } catch (error) {
      setStatus(`Could not open local database: ${error.message}`, 'Open the app over HTTPS or localhost.');
    }
  }

  initialize();
})();