// netlify/functions/jobs.js
// Live job search via Adzuna API
// Sign up free at https://developer.adzuna.com/
// Netlify env vars needed: ADZUNA_APP_ID and ADZUNA_APP_KEY
// Uses Node's built-in https module — no fetch() dependency

const https = require('https');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    }).on('error', reject);
  });
}

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

  if (!APP_ID || !APP_KEY) {
    console.log('jobs.js: no API keys found in environment');
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ results: [], source: 'no_key' }),
    };
  }

  let reqBody;
  try {
    reqBody = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { query = 'training manager', location = 'Fort Lauderdale FL' } = reqBody;
  const locationClean = location.replace(/,/g, '').trim();

  const params = new URLSearchParams({
    app_id: APP_ID,
    app_key: APP_KEY,
    results_per_page: 12,
    what: query,
    where: locationClean,
    sort_by: 'date',
  });

  const apiUrl = `https://api.adzuna.com/v1/api/jobs/us/search/1?${params.toString()}`;
  console.log('jobs.js: calling Adzuna:', apiUrl.replace(APP_KEY, '***'));

  try {
    const { status, body: data } = await httpsGet(apiUrl);

    console.log('jobs.js: Adzuna status:', status);

    if (status !== 200 || !data.results) {
      console.error('jobs.js: Adzuna error response:', JSON.stringify(data).slice(0, 300));
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ results: [], source: 'api_error', debug: typeof data === 'object' ? data : {} }),
      };
    }

    const raw = data.results || [];
    console.log('jobs.js: got', raw.length, 'results from Adzuna');

    const results = raw.map((job) => {
      const postedDate = job.created ? new Date(job.created) : null;
      const daysAgo    = postedDate ? Math.floor((Date.now() - postedDate.getTime()) / 86400000) : null;
      const posted     = daysAgo === null ? 'Recently'
                       : daysAgo === 0   ? 'Today'
                       : daysAgo === 1   ? 'Yesterday'
                       : daysAgo < 7     ? `${daysAgo} days ago`
                       :                   '1+ weeks ago';

      let salary = null;
      if (job.salary_min && job.salary_max) {
        const lo = Math.round(job.salary_min / 1000);
        const hi = Math.round(job.salary_max / 1000);
        salary = `$${lo}K – $${hi}K`;
      } else if (job.salary_min) {
        salary = `From $${Math.round(job.salary_min / 1000)}K`;
      }

      let type = 'Full-time';
      const ct = (job.contract_type || '').toLowerCase();
      const cl = (job.contract_time || '').toLowerCase();
      if (ct.includes('contract') || cl.includes('contract')) type = 'Contract';
      if (ct.includes('part')) type = 'Part-time';
      if ((job.title || '').toLowerCase().includes('remote') ||
          (job.description || '').toLowerCase().includes('remote')) type = 'Remote';

      const text = ((job.title || '') + ' ' + (job.description || '')).toLowerCase();
      const category = [];
      if (/train|coach|facilitat|l&d|learning|development|curriculum|instructional/.test(text)) category.push('training');
      if (/sales|revenue|quota|account|business development/.test(text)) category.push('sales');
      if (/lead|manager|director|vp|vice president|head of|chief/.test(text)) category.push('leadership');
      if (/remote|work from home|wfh/.test(text)) category.push('remote');

      const logoEmojis = { training: '📚', sales: '📊', leadership: '🏆', remote: '🌐' };
      const logo = logoEmojis[category[0]] || '💼';

      const bgColors = ['#e8f4fd', '#fff3e0', '#f3e5f5', '#e8f5e9', '#fce4ec', '#fffde7', '#e3f2fd'];
      const bg = bgColors[Math.abs(hashCode(job.id || job.title || '')) % bgColors.length];

      const desc = job.description
        ? job.description.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 220) + '…'
        : 'See full job description on the company site.';

      return {
        id:            job.id || `az_${Date.now()}_${Math.random()}`,
        title:         job.title || 'Open Position',
        company:       (job.company && job.company.display_name) || 'Company',
        location:      job.location && job.location.display_name ? job.location.display_name : location,
        type,
        salary,
        desc,
        url:           job.redirect_url || job.adref || null,
        posted,
        employer_logo: null,
        logo,
        bg,
        source:        'Adzuna',
        match:         null,
        category,
      };
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ results, source: 'adzuna' }),
    };
  } catch (err) {
    console.error('jobs.js: caught error:', err.message);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ results: [], source: 'fetch_error', error: err.message }),
    };
  }
};

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  }
  return h;
}
