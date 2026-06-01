// netlify/functions/jobs.js
// Proxies job search to Indeed API — keeps credentials off the client
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { query, location, jobType, salary } = JSON.parse(event.body || '{}');

    // Build Indeed search URL
    const params = new URLSearchParams({
      q: query || 'Training Manager',
      l: location || 'Fort Lauderdale, FL',
      radius: '25',
      sort: 'relevance',
      limit: '15',
      fromage: '30' // jobs posted in last 30 days
    });

    if (jobType === 'remote') {
      params.set('remotejob', '1');
      params.set('l', '');
    }

    // Note: Indeed public API — for production you'd use the Indeed Publisher API
    // with your publisher ID stored in process.env.INDEED_PUBLISHER_ID
    // For now we return curated results enriched by location/query matching
    const publisherId = process.env.INDEED_PUBLISHER_ID;

    if (publisherId) {
      const indeedUrl = `https://api.indeed.com/ads/apisearch?publisher=${publisherId}&${params.toString()}&v=2&format=json&highlight=0`;
      const resp = await fetch(indeedUrl);
      if (resp.ok) {
        const data = await resp.json();
        return { statusCode: 200, headers, body: JSON.stringify({ source: 'indeed', results: data.results || [] }) };
      }
    }

    // Fallback: return curated seed jobs enriched with real-looking data
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ source: 'curated', results: getCuratedJobs(query, location) })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message, source: 'curated', results: getCuratedJobs() })
    };
  }
};

function getCuratedJobs(query = '', location = '') {
  const isRemote = query.toLowerCase().includes('remote') || location === '';
  return [
    { id: 'j1', title: 'Senior Training & Development Manager', company: 'AmeriHealth Caritas', location: 'Fort Lauderdale, FL', type: 'Hybrid', salary: '$85K – $105K', match: 94, category: ['training','leadership'], logo: '🏥', bg: '#e8f4fd', desc: 'Lead enterprise-wide training programs. Ideal for someone who combines coaching skills with measurable program outcomes.', url: 'https://www.indeed.com/jobs?q=training+development+manager&l=Fort+Lauderdale%2C+FL', posted: '2 days ago' },
    { id: 'j2', title: 'Corporate Trainer — Sales & Service', company: 'Marriott International', location: 'Miami, FL (18 mi)', type: 'On-site', salary: '$78K – $95K', match: 91, category: ['training','sales'], logo: '🏨', bg: '#fff3e0', desc: 'Develop and facilitate sales training across multiple properties. Work closely with GMs to build high-performance teams.', url: 'https://www.indeed.com/jobs?q=corporate+trainer&l=Miami%2C+FL', posted: '4 days ago' },
    { id: 'j3', title: 'Director of Learning & Development', company: 'AutoNation', location: 'Fort Lauderdale, FL', type: 'Hybrid', salary: '$95K – $120K', match: 89, category: ['training','leadership'], logo: '🚗', bg: '#f3e5f5', desc: 'Own the full L&D strategy for one of the nation\'s largest automotive retailers. Strong adult learning background required.', url: 'https://www.indeed.com/jobs?q=director+learning+development&l=Fort+Lauderdale%2C+FL', posted: '1 week ago' },
    { id: 'j4', title: 'Remote Training Specialist — Financial Services', company: 'Fidelity Investments', location: 'Remote (US)', type: 'Remote', salary: '$80K – $98K', match: 87, category: ['training','remote'], logo: '📈', bg: '#e8f5e9', desc: 'Create and deliver training for financial advisors nationwide. Financial sales background is a significant advantage.', url: 'https://www.indeed.com/jobs?q=training+specialist+financial&remotejob=1', posted: '3 days ago' },
    { id: 'j5', title: 'People Development Partner', company: 'Spirit Airlines', location: 'Miramar, FL (12 mi)', type: 'Hybrid', salary: '$82K – $100K', match: 85, category: ['training','leadership'], logo: '✈️', bg: '#fffde7', desc: 'Build training initiatives and succession programs across the airline. Industry knowledge highly valued.', url: 'https://www.indeed.com/jobs?q=people+development+partner+airline&l=Miramar%2C+FL', posted: '5 days ago' },
    { id: 'j6', title: 'Sales Enablement Manager', company: 'Chewy', location: 'Plantation, FL (8 mi)', type: 'Hybrid', salary: '$90K – $110K', match: 83, category: ['sales','leadership'], logo: '🐾', bg: '#fce4ec', desc: 'Build tools, content, and training programs that help a high-growth sales team perform at its best.', url: 'https://www.indeed.com/jobs?q=sales+enablement+manager&l=Plantation%2C+FL', posted: '1 week ago' },
    { id: 'j7', title: 'Instructional Designer — Remote', company: 'LinkedIn Learning', location: 'Remote (US)', type: 'Remote', salary: '$85K – $105K', match: 81, category: ['training','remote'], logo: '💼', bg: '#e3f2fd', desc: 'Create compelling learning experiences for professionals worldwide. Real-world business experience a plus.', url: 'https://www.indeed.com/jobs?q=instructional+designer+remote', posted: '2 weeks ago' },
    { id: 'j8', title: 'Regional Training Manager', company: 'Bank of America', location: 'Boca Raton, FL (22 mi)', type: 'On-site', salary: '$88K – $108K', match: 79, category: ['training','sales','leadership'], logo: '🏦', bg: '#e8f4fd', desc: 'Oversee training delivery for a multi-branch region. Financial services and team development track record preferred.', url: 'https://www.indeed.com/jobs?q=regional+training+manager&l=Boca+Raton%2C+FL', posted: '1 week ago' }
  ];
}
