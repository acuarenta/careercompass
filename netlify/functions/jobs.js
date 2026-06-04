// netlify/functions/jobs.js
// Live job search via Adzuna API
// Sign up free at https://developer.adzuna.com/
// Add to Netlify env vars: ADZUNA_APP_ID and ADZUNA_APP_KEY
// Free tier: 100 calls/day — no credit card required

exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const APP_ID  = process.env.ADZUNA_APP_ID;
  const APP_KEY = process.env.ADZUNA_APP_KEY;

  // If keys aren't set, return empty results — frontend shows the 4-board search card
  if (!APP_ID || !APP_KEY) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ results: [], source: 'no_key' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { query = 'training manager', location = 'Fort Lauderdale FL' } = body;

  // Adzuna uses a simple location string; strip commas for cleaner URL
  const locationClean = location.replace(/,/g, '').trim();

  // Build Adzuna API URL
  // Docs: https://api.adzuna.com/v1/api/jobs/us/search/1?...
  const params = new URLSearchParams({
    app_id: APP_ID,
    app_key: APP_KEY,
    results_per_page: 12,
    what: query,
    where: locationClean,
    sort_by: 'date',           // freshest first
    content_type: 'application/json',
  });

  const apiUrl = `https://api.adzuna.com/v1/api/jobs/us/search/1?${params.toString()}`;

  try {
    const resp = await fetch(apiUrl);
    if (!resp.ok) {
      console.error('Adzuna error:', resp.status, await resp.text());
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ results: [], source: 'api_error' }),
      };
    }

    const data = await resp.json();
    const raw = data.results || [];

    // Normalize to CareerCompass job shape
    const results = raw.map((job) => {
      const postedDate = job.created ? new Date(job.created) : null;
      const daysAgo    = postedDate ? Math.floor((Date.now() - postedDate.getTime()) / 86400000) : null;
      const posted     = daysAgo === null ? 'Recently'
                       : daysAgo === 0   ? 'Today'
                       : daysAgo === 1   ? 'Yesterday'
                       : daysAgo < 7     ? `${daysAgo} days ago`
                       :                   '1+ weeks ago';

      // Salary — Adzuna often has min/max salary fields
      let salary = null;
      if (job.salary_min && job.salary_max) {
        const lo = Math.round(job.salary_min / 1000);
        const hi = Math.round(job.salary_max / 1000);
        salary = `$${lo}K – $${hi}K`;
      } else if (job.salary_min) {
        salary = `From $${Math.round(job.salary_min / 1000)}K`;
      }

      // Work type — Adzuna uses contract_type field
      let type = 'Full-time';
      const ct = (job.contract_type || '').toLowerCase();
      const cl = (job.contract_time || '').toLowerCase();
      if (ct.includes('contract') || cl.includes('contract')) type = 'Contract';
      if (ct.includes('part')) type = 'Part-time';
      if ((job.title || '').toLowerCase().includes('remote') ||
          (job.description || '').toLowerCase().includes('remote')) type = 'Remote';

      // Category tags for filtering — infer from title + description
      const text = ((job.title || '') + ' ' + (job.description || '')).toLowerCase();
      const category = [];
      if (/train|coach|facilitat|l&d|learning|development|curriculum|instructional/.test(text)) category.push('training');
      if (/sales|revenue|quota|account|business development/.test(text)) category.push('sales');
      if (/lead|manager|director|vp|vice president|head of|chief/.test(text)) category.push('leadership');
      if (/remote|work from home|wfh/.test(text)) category.push('remote');

      // Emoji logo fallback based on category
      const logoEmojis = { training: '📚', sales: '📊', leadership: '🏆', remote: '🌐' };
      const logo = logoEmojis[category[0]] || '💼';

      // Card background colors — cycle through a pleasant set
      const bgColors = ['#e8f4fd', '#fff3e0', '#f3e5f5', '#e8f5e9', '#fce4ec', '#fffde7', '#e3f2fd'];
      const bg = bgColors[Math.abs(hashCode(job.id || job.title || '')) % bgColors.length];

      // Trim description to ~220 chars
      const desc = job.description
        ? job.description.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 220) + '…'
        : 'See full job description on the company site.';

      return {
        id:            job.id || `az_${Date.now()}_${Math.random()}`,
        title:         job.title  || 'Open Position',
        company:       (job.company && job.company.display_name) || 'Company',
        location:      job.location && job.location.display_name ? job.location.display_name : location,
        type,
        salary,
        desc,
        url:           job.redirect_url || job.adref || null,
        posted,
        employer_logo: null,      // Adzuna doesn't provide logos — app uses emoji fallback
        logo,
        bg,
        source:        'Adzuna',
        match:         null,      // scored client-side by scoreJob()
        category,
      };
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ results, source: 'adzuna' }),
    };
  } catch (err) {
    console.error('jobs.js fetch error:', err);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ results: [], source: 'fetch_error' }),
    };
  }
};

// Simple hash for deterministic background color assignment
function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  }
  return h;
}
