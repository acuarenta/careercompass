// netlify/functions/parse-resume.js
// Accepts a base64-encoded PDF or DOCX file, returns extracted plain text.
// Called by the CareerCompass upload handler in index.html.

const pdfParse  = require('pdf-parse');
const mammoth   = require('mammoth');

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

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { fileData, fileType, fileName } = JSON.parse(event.body || '{}');

    if (!fileData) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No file data provided' }) };
    }

    // Decode base64 → Buffer
    const buffer = Buffer.from(fileData, 'base64');
    let text = '';

    const type = (fileType || '').toLowerCase();
    const name = (fileName || '').toLowerCase();

    if (type.includes('pdf') || name.endsWith('.pdf')) {
      // ── PDF ──────────────────────────────────────────────────────
      const result = await pdfParse(buffer);
      text = result.text || '';

    } else if (
      type.includes('wordprocessingml') ||
      type.includes('msword') ||
      name.endsWith('.docx') ||
      name.endsWith('.doc')
    ) {
      // ── DOCX / DOC ───────────────────────────────────────────────
      const result = await mammoth.extractRawText({ buffer });
      text = result.value || '';

    } else if (type.includes('text') || name.endsWith('.txt')) {
      // ── Plain text ───────────────────────────────────────────────
      text = buffer.toString('utf-8');

    } else {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Unsupported file type. Please upload a PDF, Word document, or .txt file.' })
      };
    }

    // Clean up extracted text
    text = text
      .replace(/\r\n/g, '\n')        // normalize line endings
      .replace(/\n{3,}/g, '\n\n')    // collapse excess blank lines
      .replace(/[ \t]{2,}/g, ' ')    // collapse excess spaces
      .trim();

    if (!text || text.length < 50) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          text: '',
          warning: 'Could not extract readable text from this file. It may be a scanned image or protected PDF. Try copying and pasting your resume text into the manual entry tab instead.'
        })
      };
    }

    // Cap at 4000 chars — plenty for Claude, avoids token bloat
    const truncated = text.length > 4000;
    const finalText = truncated ? text.substring(0, 4000) + '\n[truncated for length]' : text;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ text: finalText, truncated, charCount: text.length })
    };

  } catch (err) {
    console.error('parse-resume error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to parse file: ' + err.message })
    };
  }
};
