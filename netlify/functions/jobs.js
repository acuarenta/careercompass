// netlify/functions/jobs.js
// ─────────────────────────────────────────────────────────────────
// CareerCompass Job Aggregator — v3
// Sources: Remotive (no key) + Adzuna + USAJobs
// All three run in parallel via Promise.allSettled
// Results are normalized, deduplicated, and returned as one list
// ─────────────────────────────────────────────────────────────────
// Netlify env vars needed:
//   ADZUNA_APP_ID   — from developer.adzuna.com
//   ADZUNA_APP_KEY  — from developer.adzuna.com
//   USAJOBS_API_KEY — from developer.usajobs.gov
//   USAJOBS_USER_AGENT — your email address (required by USAJobs)

const https = require('https');

// ─── HTTP helper ────────────────────────────────────────────────
function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = Object.assign({ headers }, require('url').parse(url));
    https.get(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    }).on('error', reject);
  });
}

// ─── Shared card background colors ──────────────────────────────
const BG_COLORS = ['#e8f4fd','#fff3e0','#f3e5f5','#e8f5e9','#fce4ec','#fffde7','#e3f2fd'];
function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  return h;
}
function bgFor(str) {
  return BG_COLORS[Math.abs(hashCode(str)) % BG_COLORS.length];
}

// ─── Category tagger (shared) ────────────────────────────────────
function tagCategories(text) {
  const t = text.toLowerCase();
  const cats = [];
  if (/train|coach|facilitat|l&d|learning|development|curriculum|instructional/.test(t)) cats.push('training');
  if (/sales|revenue|quota|account exec|business development/.test(t)) cats.push('sales');
  if (/lead|manager|director|vp|vice president|head of|chief/.test(t)) cats.push('leadership');
  if (/remote|work from home|wfh/.test(t)) cats.push('remote');
  return cats;
}

function logoFor(cats) {
  const map = { training:'📚', sales:'📊', leadership:'🏆', remote:'🌐' };
  return map[cats[0]] || '💼';
}

function daysAgoLabel(dateStr) {
  if (!dateStr) return 'Recently';
  const d = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (d <= 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 7) return `${d} days ago`;
  if (d < 14) return '1 week ago';
  return `${Math.floor(d/7)} weeks ago`;
}

// ─── Clean location: strip street address, keep City ST ──────────
function cleanLocation(raw) {
  if (!raw) return '';
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 3) {
    // "1409 NE 17th Ave, Fort Lauderdale, FL 33304" → "Fort Lauderdale FL"
    return parts.slice(-2).join(' ').replace(/\d{5}(-\d{4})?/, '').trim();
  }
  return raw.replace(/\d{5}(-\d{4})?/, '').trim();
}

// ─────────────────────────────────────────────────────────────────
// SOURCE 1: Remotive — remote jobs, no API key required
// ─────────────────────────────────────────────────────────────────
async function fetchRemotive(query) {
  try {
    const q = encodeURIComponent(query.split(' OR ')[0]); // use first term only
    const { status, body } = await httpsGet(
      `https://remotive.com/api/remote-jobs?search=${q}&limit=8`
    );
    if (status !== 200 || !body.jobs) return [];
    console.log(`jobs.js: Remotive got ${body.jobs.length} results`);
    return body.jobs.map(job => {
      const text = (job.title || '') + ' ' + (job.description || '');
      const cats = tagCategories(text);
      return {
        id:            'rm_' + job.id,
        title:         job.title || 'Open Position',
        company:       job.company_name || 'Company',
        location:      'Remote',
        type:          'Remote',
        salary:        job.salary || null,
        desc:          (job.description || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 220) + '…',
        url:           job.url || null,
        posted:        daysAgoLabel(job.publication_date),
        employer_logo: job.company_logo || null,
        logo:          logoFor(cats),
        bg:            bgFor(job.id + ''),
        source:        'Remotive',
        match:         null,
        category:      cats.length ? cats : ['remote'],
      };
    });
  } catch (err) {
    console.error('jobs.js: Remotive error:', err.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────
// SOURCE 2: Adzuna — broad job board aggregator
// ─────────────────────────────────────────────────────────────────
async function fetchAdzuna(query, location, appId, appKey) {
  if (!appId || !appKey) return [];
  try {
    // Use state-level search for better coverage in smaller markets
    const locClean = cleanLocation(location);
    const locForApi = locClean || 'Florida';
    const params = new URLSearchParams({
      app_id: appId,
      app_key: appKey,
      results_per_page: 10,
      what: query.split(' OR ')[0], // first term only for better results
      where: locForApi,
      sort_by: 'date',
    });
    const url = `https://api.adzuna.com/v1/api/jobs/us/search/1?${params}`;
    console.log('jobs.js: Adzuna calling:', url.replace(appKey, '***'));
    const { status, body } = await httpsGet(url);
    if (status !== 200 || !body.results) {
      console.error('jobs.js: Adzuna bad response:', status);
      return [];
    }
    console.log(`jobs.js: Adzuna got ${body.results.length} results`);
    return body.results.map(job => {
      let salary = null;
      if (job.salary_min && job.salary_max) {
        salary = `$${Math.round(job.salary_min/1000)}K – $${Math.round(job.salary_max/1000)}K`;
      } else if (job.salary_min) {
        salary = `From $${Math.round(job.salary_min/1000)}K`;
      }
      const ct = (job.contract_type || '').toLowerCase();
      let type = 'Full-time';
      if (ct.includes('contract')) type = 'Contract';
      if (ct.includes('part')) type = 'Part-time';
      const text = (job.title || '') + ' ' + (job.description || '');
      if (/remote|work from home/i.test(text)) type = 'Remote';
      const cats = tagCategories(text);
      const loc = job.location?.display_name || locClean || location;
      return {
        id:            'az_' + job.id,
        title:         job.title || 'Open Position',
        company:       job.company?.display_name || 'Company',
        location:      loc,
        type,
        salary,
        desc:          (job.description || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 220) + '…',
        url:           job.redirect_url || null,
        posted:        daysAgoLabel(job.created),
        employer_logo: null,
        logo:          logoFor(cats),
        bg:            bgFor(job.id + ''),
        source:        'Adzuna',
        match:         null,
        category:      cats,
      };
    });
  } catch (err) {
    console.error('jobs.js: Adzuna error:', err.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────
// SOURCE 3: USAJobs — federal positions
// ─────────────────────────────────────────────────────────────────
async function fetchUSAJobs(query, location, apiKey, userAgent) {
  if (!apiKey || !userAgent) return [];
  try {
    const locClean = cleanLocation(location) || 'Florida';
    // USAJobs uses keyword + LocationName
    const params = new URLSearchParams({
      Keyword:      query.split(' OR ')[0],
      LocationName: locClean,
      ResultsPerPage: 8,
      SortField:    'OpenDate',
      SortDirection:'Descending',
    });
    const url = `https://data.usajobs.gov/api/search?${params}`;
    console.log('jobs.js: USAJobs calling:', url);
    const { status, body } = await httpsGet(url, {
      'Authorization-Key': apiKey,
      'User-Agent':        userAgent,
      'Host':              'data.usajobs.gov',
    });
    if (status !== 200 || !body.SearchResult?.SearchResultItems) {
      console.error('jobs.js: USAJobs bad response:', status);
      return [];
    }
    const items = body.SearchResult.SearchResultItems;
    console.log(`jobs.js: USAJobs got ${items.length} results`);
    return items.map(item => {
      const pos = item.MatchedObjectDescriptor;
      const salLow  = pos.PositionRemuneration?.[0]?.MinimumRange;
      const salHigh = pos.PositionRemuneration?.[0]?.MaximumRange;
      const salary  = salLow && salHigh
        ? `$${Math.round(salLow/1000)}K – $${Math.round(salHigh/1000)}K`
        : salLow ? `From $${Math.round(salLow/1000)}K` : null;
      const text = (pos.PositionTitle || '') + ' ' + (pos.UserArea?.Details?.JobSummary || '');
      const cats = tagCategories(text);
      const loc = pos.PositionLocationDisplay || locClean;
      return {
        id:            'usa_' + pos.PositionID,
        title:         pos.PositionTitle || 'Federal Position',
        company:       pos.OrganizationName || 'U.S. Government',
        location:      loc,
        type:          pos.PositionSchedule?.[0]?.Name || 'Full-time',
        salary,
        desc:          (pos.UserArea?.Details?.JobSummary || pos.QualificationSummary || 'See full description on USAJobs.gov.')
                         .replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 220) + '…',
        url:           pos.PositionURI || null,
        posted:        daysAgoLabel(pos.PublicationStartDate),
        employer_logo: null,
        logo:          '🏛️',
        bg:            bgFor(pos.PositionID || ''),
        source:        'USAJobs',
        match:         null,
        category:      cats.length ? cats : ['leadership'],
      };
    });
  } catch (err) {
    console.error('jobs.js: USAJobs error:', err.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────
// DEDUPLICATION — remove near-duplicate title+company combos
// ─────────────────────────────────────────────────────────────────
function deduplicate(jobs) {
  const seen = new Set();
  return jobs.filter(job => {
    const key = (job.title + '|' + job.company).toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────────
exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  let reqBody;
  try { reqBody = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { query = 'Training Manager', location = 'Fort Lauderdale FL' } = reqBody;

  const ADZUNA_APP_ID   = process.env.ADZUNA_APP_ID;
  const ADZUNA_APP_KEY  = process.env.ADZUNA_APP_KEY;
  const USAJOBS_API_KEY = process.env.USAJOBS_API_KEY;
  const USAJOBS_UA      = process.env.USAJOBS_USER_AGENT;

  console.log('jobs.js: aggregator starting —', { query, location });
  console.log('jobs.js: keys present —', {
    adzuna: !!(ADZUNA_APP_ID && ADZUNA_APP_KEY),
    usajobs: !!(USAJOBS_API_KEY && USAJOBS_UA),
    remotive: true,
  });

  // Run all three sources in parallel — failures are isolated
  const [remotiveResult, adzunaResult, usajobsResult] = await Promise.allSettled([
    fetchRemotive(query),
    fetchAdzuna(query, location, ADZUNA_APP_ID, ADZUNA_APP_KEY),
    fetchUSAJobs(query, location, USAJOBS_API_KEY, USAJOBS_UA),
  ]);

  const remotive = remotiveResult.status === 'fulfilled' ? remotiveResult.value : [];
  const adzuna   = adzunaResult.status   === 'fulfilled' ? adzunaResult.value   : [];
  const usajobs  = usajobsResult.status  === 'fulfilled' ? usajobsResult.value  : [];

  console.log(`jobs.js: results — remotive:${remotive.length} adzuna:${adzuna.length} usajobs:${usajobs.length}`);

  // Interleave sources so the list isn't all-Remotive or all-Adzuna
  const combined = [];
  const maxLen = Math.max(remotive.length, adzuna.length, usajobs.length);
  for (let i = 0; i < maxLen; i++) {
    if (remotive[i]) combined.push(remotive[i]);
    if (adzuna[i])   combined.push(adzuna[i]);
    if (usajobs[i])  combined.push(usajobs[i]);
  }

  const results = deduplicate(combined).slice(0, 15);
  const source  = results.length > 0 ? 'aggregator' : 'no_results';

  console.log(`jobs.js: returning ${results.length} deduplicated results`);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ results, source }),
  };
};
