// netlify/functions/parse-resume.js
// Sends the uploaded resume directly to Claude as a native document.
// Claude reads PDF/DOCX natively — no third-party parsing libraries needed.
// Returns structured JSON with all resume fields extracted.

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured' }) };

  try {
    const { fileData, fileType, fileName, personalityContext } = JSON.parse(event.body || '{}');

    if (!fileData) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No file data provided' }) };

    const type = (fileType || '').toLowerCase();
    const name = (fileName || '').toLowerCase();

    // Determine media type for Claude's document API
    let mediaType = null;
    if (type.includes('pdf') || name.endsWith('.pdf')) {
      mediaType = 'application/pdf';
    } else if (type.includes('text') || name.endsWith('.txt')) {
      // For plain text, extract directly without Claude
      const text = Buffer.from(fileData, 'base64').toString('utf-8').trim();
      return { statusCode: 200, headers, body: JSON.stringify({ text, truncated: false }) };
    } else if (
      type.includes('wordprocessingml') || type.includes('msword') ||
      name.endsWith('.docx') || name.endsWith('.doc')
    ) {
      // Word docs: Claude doesn't natively support these yet, return helpful message
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          text: '',
          warning: 'Word documents are not yet supported for direct reading. Please save your resume as a PDF and re-upload, or use the manual entry tab.'
        })
      };
    } else {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Please upload a PDF or .txt file.' }) };
    }

    // Send PDF directly to Claude as a native document
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 3000,
        system: 'You are a resume parser. Extract all information from the resume document provided and return it as clean plain text, preserving all sections: contact info, summary, every work experience entry with company/title/dates/bullets, all education, certifications, and skills. Return ONLY the extracted text, no commentary.',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: fileData
              }
            },
            {
              type: 'text',
              text: 'Extract all text from this resume exactly as written. Preserve all names, dates, companies, job titles, bullet points, education, and certifications. Return clean plain text only.'
            }
          ]
        }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Claude API error');
    }

    const text = (data.content || []).map(b => b.text || '').join('').trim();

    if (!text || text.length < 50) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          text: '',
          warning: 'Could not extract text from this file. Try saving as a PDF with selectable text, or use the manual entry tab.'
        })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ text, truncated: false, charCount: text.length })
    };

  } catch (err) {
    console.error('parse-resume error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to read resume: ' + err.message })
    };
  }
};
