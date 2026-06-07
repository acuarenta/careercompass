// netlify/functions/jobs-indeed.js
// Uses the Anthropic API with the Indeed MCP server to fetch real job listings
// matched to the user's compass type and location.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return {
      statusCode: 200,
      body: JSON.stringify({ results: [], source: 'no_key' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { query = 'Training Manager', location = 'Fort Lauderdale, FL', compassType = 'connector' } = body;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'mcp-client-2025-04-04',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        mcp_servers: [
          {
            type: 'url',
            url: 'https://mcp.indeed.com/claude/mcp',
            name: 'indeed',
          },
        ],
        system: `You are a job search assistant. Use the Indeed search tool to find relevant job listings, then respond ONLY with a valid JSON array. No markdown, no explanation, just the JSON array.

Each item in the array must have these exact fields:
- id: string (use the Indeed job key or a unique string)
- title: string (job title)
- company: string (company name)  
- location: string (city, state or "Remote")
- type: string (one of: "Full-time", "Part-time", "Contract", "Remote", "Hybrid", "On-site")
- salary: string (salary range if available, otherwise "")
- desc: string (2-sentence summary of the role)
- url: string (the apply/job URL from Indeed)
- posted: string (e.g. "Today", "2 days ago", "1 week ago")
- logo: string (a single relevant emoji for the industry)
- category: array of strings from this set: ["training","sales","leadership","remote","finance","tech","healthcare","nonprofit"]

Return between 6 and 10 jobs. Only return jobs that are genuinely relevant to the query and location provided.`,
        messages: [
          {
            role: 'user',
            content: `Search Indeed for "${query}" jobs in "${location}". Return results as a JSON array exactly as described. No other text.`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic API error:', response.status, err);
      return {
        statusCode: 200,
        body: JSON.stringify({ results: [], source: 'api_error' }),
      };
    }

    const data = await response.json();

    // Extract text from response
    const textBlock = (data.content || []).find(b => b.type === 'text');
    if (!textBlock) {
      return {
        statusCode: 200,
        body: JSON.stringify({ results: [], source: 'no_text' }),
      };
    }

    // Parse the JSON array
    let jobs;
    try {
      const clean = textBlock.text.replace(/```json|```/g, '').trim();
      jobs = JSON.parse(clean);
      if (!Array.isArray(jobs)) throw new Error('Not an array');
    } catch (e) {
      console.error('JSON parse error:', e.message, textBlock.text.substring(0, 200));
      return {
        statusCode: 200,
        body: JSON.stringify({ results: [], source: 'parse_error' }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results: jobs, source: 'indeed' }),
    };
  } catch (err) {
    console.error('jobs-indeed error:', err);
    return {
      statusCode: 200,
      body: JSON.stringify({ results: [], source: 'fetch_error' }),
    };
  }
};
