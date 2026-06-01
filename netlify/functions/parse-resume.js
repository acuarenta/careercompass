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
      .replace(/\r\n/g, '\n')                          // normalize line endings
      .replace(/\r/g, '\n')
      .replace(/[^\S\n]+/g, ' ')                       // collapse spaces/tabs (preserve newlines)
      .replace(/P R O F E S S I O N A ?L/gi, 'PROFESSIONAL')  // fix spaced-out headers
      .replace(/E X P E R I E N C E/gi, 'EXPERIENCE')
      .replace(/E D U C A ?T I O N/gi, 'EDUCATION')
      .replace(/C E R T I F I C A ?T I O N S?/gi, 'CERTIFICATIONS')
      .replace(/S U M M A R Y/gi, 'SUMMARY')
      .replace(/C O M P E T E N C I E S/gi, 'COMPETENCIES')
      .replace(/S K I L L S/gi, 'SKILLS')
      .replace(/([A-Z]) ([A-Z]) ([A-Z])/g, '$1$2$3')  // collapse remaining spaced capitals
      .replace(/([A-Z]) ([A-Z])/g, '$1$2')
      .replace(/•/g, '\n•')                            // ensure bullets start on new lines
      .replace(/\n{3,}/g, '\n\n')                      // collapse excess blank lines
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

    // Cap at 10000 chars — covers even heavily formatted long resumes
    const truncated = text.length > 10000;
    const finalText = truncated ? text.substring(0, 10000) + '\n[truncated for length]' : text;

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
