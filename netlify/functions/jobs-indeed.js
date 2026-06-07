// netlify/functions/jobs-indeed.js
// Enhanced job search: Remotive (free) + Adzuna with richer, role-specific queries
// Falls through gracefully — always returns results or empty array, never throws to client.

const https = require('https');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'CareerCompass/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse failed: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

// Compass-type → rich keyword sets for each API
const QUERY_MAP = {
  navigator:  { remotive: 'operations manager',      adzuna: 'Operations Manager Director',       category: 'management' },
  connector:  { remotive: 'training manager',         adzuna: 'Training Manager Corporate Trainer', category: 'hr' },
  catalyst:   { remotive: 'sales director',           adzuna: 'Sales Director Business Development', category: 'sales' },
  anchor:     { remotive: 'finance manager',          adzuna: 'Finance Manager Analyst',            category: 'accounting' },
  pioneer:    { remotive: 'marketing director',       adzuna: 'Marketing Director Brand Manager',   category: 'marketing' },
  builder:    { remotive: 'product manager',          adzuna: 'Product Manager Instructional Designer', category: 'it-jobs' },
  diplomat:   { remotive: 'program manager nonprofit',adzuna: 'Program Director Nonprofit Education', category: 'social-work' },
  pathfinder: { remotive: 'data analyst',             adzuna: 'Research Analyst Data Scientist',    category: 'it-jobs' },
};

function normalizeRemotive(job) {
  return {
    id: 'rem_' + job.id,
    title: job.title || '',
    company: job.company_name || '',
    location: job.candidate_required_location || 'Remote',
    type: 'Remote',
    salary: job.salary || '',
    desc: (job.description || '').replace(/<[^>]+>/g, '').substring(0, 220).trim() + '…',
    url: job.url || '',
    posted: job.publication_date ? timeAgo(job.publication_date) : '',
    logo: '💼',
    category: ['remote'],
    source: 'remotive',
  };
}

function normalizeAdzuna(job, loc) {
  const isRemote = (job.title + ' ' + (job.description||'')).toLowerCase().includes('remote');
  const salary = job.salary_min && job.salary_max
    ? `$${Math.round(job.salary_min/1000)}K – $${Math.round(job.salary_max/1000)}K`
    : '';
  return {
    id: 'adz_' + job.id,
    title: job.title || '',
    company: (job.company && job.company.display_name) || '',
    location: (job.location && job.location.display_name) || loc,
    type: isRemote ? 'Remote' : 'On-site',
    salary,
    desc: (job.description || '').replace(/<[^>]+>/g, '').substring(0, 220).trim() + '…',
    url: job.redirect_url || '',
    posted: job.created ? timeAgo(job.created) : '',
    logo: '🏢',
    category: [],
    source: 'adzuna',
  };
}

function timeAgo(dateStr) {
  const ms = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(ms / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return '1 week ago';
  return `${Math.floor(days/7)} weeks ago`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const { location = 'Fort Lauderdale, FL', compassType = 'connector' } = body;
  const qmap = QUERY_MAP[compassType] || QUERY_MAP['connector'];

  // Parse location into city + state
  const locParts = location.split(',').map(s => s.trim());
  const city = locParts[0] || 'Fort Lauderdale';
  const stateRaw = (locParts[1] || 'FL').trim();
  // Adzuna uses full state names for US
  const STATE_NAMES = {
    FL:'florida',TX:'texas',CA:'california',NY:'new_york',GA:'georgia',
    IL:'illinois',PA:'pennsylvania',OH:'ohio',NC:'north_carolina',AZ:'arizona',
    WA:'washington',MA:'massachusetts',CO:'colorado',VA:'virginia',TN:'tennessee',
    NJ:'new_jersey',MI:'michigan',MN:'minnesota',MD:'maryland',WI:'wisconsin',
  };
  const stateCode = stateRaw.length === 2 ? stateRaw.toUpperCase() : stateRaw.toUpperCase().substring(0,2);
  const adzunaState = STATE_NAMES[stateCode] || 'florida';

  const ADZUNA_APP_ID  = process.env.ADZUNA_APP_ID;
  const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY;

  const results = [];
  const errors  = [];

  // ── 1. Remotive (remote jobs, no key needed) ─────────────────────
  try {
    const remotiveQ = encodeURIComponent(qmap.remotive);
    const remotiveUrl = `https://remotive.com/api/remote-jobs?search=${remotiveQ}&limit=6`;
    const rData = await httpsGet(remotiveUrl);
    if (rData.jobs && Array.isArray(rData.jobs)) {
      rData.jobs.slice(0, 5).forEach(j => results.push(normalizeRemotive(j)));
    }
  } catch(e) {
    errors.push('remotive: ' + e.message);
  }

  // ── 2. Adzuna (local + national) ────────────────────────────────
  if (ADZUNA_APP_ID && ADZUNA_APP_KEY) {
    try {
      const adzunaQ = encodeURIComponent(qmap.adzuna);
      const adzunaCity = encodeURIComponent(city);
      // Search by city first
      const adzunaUrl = `https://api.adzuna.com/v1/api/jobs/us/search/1?app_id=${ADZUNA_APP_ID}&app_key=${ADZUNA_APP_KEY}&results_per_page=8&what=${adzunaQ}&where=${adzunaCity}%20${stateCode}&content-type=application/json&sort_by=date`;
      const aData = await httpsGet(adzunaUrl);
      if (aData.results && Array.isArray(aData.results)) {
        aData.results.slice(0, 8).forEach(j => results.push(normalizeAdzuna(j, location)));
      }
    } catch(e) {
      errors.push('adzuna: ' + e.message);
    }

    // Also search broader state if city returned few results
    if (results.filter(r => r.source === 'adzuna').length < 3) {
      try {
        const adzunaQ = encodeURIComponent(qmap.adzuna);
        const adzunaUrl2 = `https://api.adzuna.com/v1/api/jobs/us/search/1?app_id=${ADZUNA_APP_ID}&app_key=${ADZUNA_APP_KEY}&results_per_page=6&what=${adzunaQ}&where=${adzunaState}&content-type=application/json&sort_by=date`;
        const aData2 = await httpsGet(adzunaUrl2);
        if (aData2.results && Array.isArray(aData2.results)) {
          aData2.results.slice(0, 5).forEach(j => {
            const norm = normalizeAdzuna(j, location);
            // Don't add duplicates
            if (!results.some(r => r.title === norm.title && r.company === norm.company)) {
              results.push(norm);
            }
          });
        }
      } catch(e) {
        errors.push('adzuna-state: ' + e.message);
      }
    }
  }

  if (errors.length) console.log('jobs-indeed errors:', errors.join('; '));

  const source = results.length > 0 ? 'enhanced' : 'no_results';

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ results, source, debug: errors }),
  };
};
