// netlify/functions/jobs-indeed.js
// Job search via Jooble API — aggregates Indeed, LinkedIn, ZipRecruiter, and 140k+ sources.
// Set JOOBLE_API_KEY in Netlify environment variables (free key from jooble.org/api/about).

const https = require('https');

// Compass type → Jooble keyword sets (role-specific, local-friendly)
const QUERY_MAP = {
  navigator:  ['Operations Manager', 'Program Director', 'Director of Operations'],
  connector:  ['Training Manager', 'Corporate Trainer', 'Learning Development Manager', 'HR Manager'],
  catalyst:   ['Sales Manager', 'Business Development Manager', 'Sales Director', 'Account Executive'],
  anchor:     ['Finance Manager', 'Financial Analyst', 'Operations Analyst', 'Compliance Manager'],
  pioneer:    ['Marketing Manager', 'Brand Manager', 'Marketing Director', 'Creative Director'],
  builder:    ['Product Manager', 'Instructional Designer', 'Project Manager', 'Systems Analyst'],
  diplomat:   ['Program Manager', 'Nonprofit Manager', 'Education Administrator', 'Community Manager'],
  pathfinder: ['Research Analyst', 'Strategy Consultant', 'Data Analyst', 'Business Analyst'],
};

function httpsPost(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'CareerCompass/1.0',
      },
    };
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse failed: ' + e.message + ' body: ' + data.substring(0, 100))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const ms = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(ms / 86400000);
  if (isNaN(days) || days < 0) return '';
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return '1 week ago';
  return `${Math.floor(days / 7)} weeks ago`;
}

function guessType(job) {
  const text = ((job.title || '') + ' ' + (job.type || '')).toLowerCase();
  if (text.includes('remote')) return 'Remote';
  if (text.includes('hybrid')) return 'Hybrid';
  if (text.includes('part')) return 'Part-time';
  if (text.includes('contract') || text.includes('freelance')) return 'Contract';
  return 'Full-time';
}

function guessLogo(title) {
  const t = (title || '').toLowerCase();
  if (t.includes('sales') || t.includes('account')) return '💼';
  if (t.includes('train') || t.includes('learn') || t.includes('coach')) return '🎓';
  if (t.includes('market') || t.includes('brand') || t.includes('creative')) return '📣';
  if (t.includes('finance') || t.includes('account') || t.includes('fiscal')) return '📊';
  if (t.includes('data') || t.includes('analyst') || t.includes('research')) return '🔭';
  if (t.includes('operations') || t.includes('director') || t.includes('manager')) return '🧭';
  if (t.includes('nonprofit') || t.includes('education') || t.includes('program')) return '🌿';
  if (t.includes('product') || t.includes('engineer') || t.includes('design')) return '🏗️';
  return '💼';
}

function normalizeJooble(job) {
  // Jooble fields: title, location, snippet, salary, type, link, company, updated
  const salary = job.salary ? String(job.salary).trim() : '';
  const desc = (job.snippet || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
    .substring(0, 240).trim();

  return {
    id: 'jbl_' + Math.random().toString(36).substring(2, 10),
    title: (job.title || '').replace(/<[^>]+>/g, '').trim(),
    company: (job.company || '').trim(),
    location: (job.location || '').trim(),
    type: guessType(job),
    salary,
    desc: desc ? desc + (desc.length >= 240 ? '…' : '') : '',
    url: job.link || '',
    posted: timeAgo(job.updated),
    logo: guessLogo(job.title),
    category: [],
    source: 'jooble',
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const JOOBLE_API_KEY = process.env.JOOBLE_API_KEY;
  if (!JOOBLE_API_KEY) {
    console.warn('JOOBLE_API_KEY not set — returning empty results');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results: [], source: 'no_key' }),
    };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const { location = 'Fort Lauderdale, FL', compassType = 'connector' } = body;
  const keywords = QUERY_MAP[compassType] || QUERY_MAP['connector'];

  // Run two parallel searches: primary role title + secondary title
  // Jooble works best with one clean keyword phrase per call
  const searches = [keywords[0], keywords[1]].filter(Boolean);

  const allResults = [];
  const seen = new Set();
  const errors = [];

  await Promise.all(searches.map(async (keyword) => {
    try {
      const payload = {
        keywords: keyword,
        location,
        radius: '40',   // ~25 miles — keeps results local
        page: 1,
      };
      const url = `https://jooble.org/api/${JOOBLE_API_KEY}`;
      const data = await httpsPost(url, payload);

      if (data && Array.isArray(data.jobs)) {
        data.jobs.forEach(job => {
          const key = (job.title + '|' + job.company + '|' + job.location).toLowerCase();
          if (!seen.has(key) && job.title) {
            seen.add(key);
            allResults.push(normalizeJooble(job));
          }
        });
      }
    } catch (e) {
      errors.push(`${keyword}: ${e.message}`);
    }
  }));

  if (errors.length) console.warn('Jooble search errors:', errors.join('; '));

  const source = allResults.length > 0 ? 'jooble' : 'no_results';

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ results: allResults, source }),
  };
};
