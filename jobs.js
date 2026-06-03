// netlify/functions/jobs.js
// Live job search via JSearch API (RapidAPI) — returns real Indeed/LinkedIn/Glassdoor listings
// Setup: add JSEARCH_API_KEY to Netlify environment variables
// Free tier: 500 requests/month at https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let query, location, employmentTypes, remoteOnly;
  try {
    const body = JSON.parse(event.body || '{}');
    query = body.query || 'Training Manager';
    location = body.location || 'Fort Lauderdale, FL';
    remoteOnly = body.remoteOnly || false;
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const apiKey = process.env.JSEARCH_API_KEY;

  // If no API key configured, return empty so frontend uses its own fallback UI
  if (!apiKey) {
    console.log('JSEARCH_API_KEY not set — returning empty results');
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ results: [], source: 'no_key' })
    };
  }

  try {
    // JSearch supports multi-word queries with AND/OR, remote filter, location radius
    const searchQuery = remoteOnly ? `${query} remote` : query;
    const params = new URLSearchParams({
      query: `${searchQuery} in ${location}`,
      page: '1',
      num_pages: '1',
      date_posted: 'month',        // jobs posted in the last 30 days only — keeps listings fresh
      employment_types: 'FULLTIME,CONTRACTOR,PARTTIME',
      job_requirements: 'no_experience,under_3_years_experience,more_than_3_years_experience'
    });

    const response = await fetch(
      `https://jsearch.p.rapidapi.com/search?${params}`,
      {
        method: 'GET',
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': 'jsearch.p.rapidapi.com'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`JSearch API returned ${response.status}`);
    }

    const data = await response.json();
    const raw = data.data || [];

    // Normalize JSearch format into CareerCompass job shape
    const results = raw.slice(0, 12).map((job, i) => {
      // Build a direct apply URL — JSearch provides job_apply_link when available
      const applyUrl = job.job_apply_link ||
        job.job_google_link ||
        buildFallbackUrl(job);

      // Map employment type to our labels
      const typeMap = {
        FULLTIME: 'Full-time', PARTTIME: 'Part-time',
        CONTRACTOR: 'Contract', INTERN: 'Internship'
      };
      const type = job.job_is_remote ? 'Remote'
        : typeMap[job.job_employment_type] || 'Full-time';

      // Salary — JSearch returns min/max when available
      const salary = formatSalary(job.job_min_salary, job.job_max_salary, job.job_salary_currency);

      // Posted date — convert epoch to relative string
      const posted = relativeDate(job.job_posted_at_timestamp);

      // Pick a background colour based on job category (deterministic by index)
      const bgs = ['#e8f4fd','#fff3e0','#f3e5f5','#e8f5e9','#fffde7','#fce4ec','#e3f2fd','#fbe9e7','#f1f8e9','#e0f2f1'];
      const logos = ['🏢','💼','📊','🎯','🚀','⭐','🔷','💡','🌐','📈'];

      return {
        id: job.job_id || `live_${i}`,
        title: job.job_title || 'Open Role',
        company: job.employer_name || 'Company',
        location: job.job_is_remote ? 'Remote (US)'
          : [job.job_city, job.job_state].filter(Boolean).join(', ') || location,
        type,
        salary,
        desc: (job.job_description || '').slice(0, 220).replace(/\n/g, ' ').trim() + '…',
        url: applyUrl,
        posted,
        logo: job.employer_logo ? null : logos[i % logos.length],  // null = use employer_logo in frontend
        employer_logo: job.employer_logo || null,
        bg: bgs[i % bgs.length],
        source: job.job_publisher || 'Indeed',
        // match score calculated client-side based on user profile
        match: null,
        category: deriveCategory(job.job_title, job.job_description)
      };
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ results, source: 'jsearch' })
    };

  } catch (err) {
    console.error('JSearch error:', err.message);
    // Return empty — frontend will show "no live results" message with search links
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ results: [], source: 'error', error: err.message })
    };
  }
};

function buildFallbackUrl(job) {
  // Best possible fallback: quoted title + company on Indeed
  const title = encodeURIComponent(`"${(job.job_title || '').trim()}"`);
  const company = encodeURIComponent(`"${(job.employer_name || '').trim()}"`);
  const loc = job.job_is_remote
    ? '&remotejob=032b3046-06a3-4876-8dfd-474eb5e7ed11'
    : `&l=${encodeURIComponent([job.job_city, job.job_state].filter(Boolean).join(', '))}`;
  return `https://www.indeed.com/jobs?q=${title}+${company}${loc}`;
}

function formatSalary(min, max, currency) {
  if (!min && !max) return null;
  const fmt = (n) => {
    if (n >= 1000) return '$' + Math.round(n / 1000) + 'K';
    return '$' + Math.round(n);
  };
  if (min && max) return `${fmt(min)} – ${fmt(max)}`;
  if (min) return `From ${fmt(min)}`;
  if (max) return `Up to ${fmt(max)}`;
  return null;
}

function relativeDate(timestamp) {
  if (!timestamp) return 'Recently';
  const days = Math.floor((Date.now() / 1000 - timestamp) / 86400);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return '1 week ago';
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return 'This month';
}

function deriveCategory(title, desc) {
  const t = ((title || '') + ' ' + (desc || '')).toLowerCase();
  const cats = [];
  if (/train|learn|develop|l&d|instructional|coach|facilitat/.test(t)) cats.push('training');
  if (/sales|revenue|quota|account|business develop/.test(t)) cats.push('sales');
  if (/direct|vp |vice president|head of|chief|manager|lead/.test(t)) cats.push('leadership');
  if (/remote|anywhere|distributed/.test(t)) cats.push('remote');
  if (/operat|project|program|coordinat|process/.test(t)) cats.push('operations');
  return cats.length ? cats : ['other'];
}
