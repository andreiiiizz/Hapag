module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method Not Allowed' } });
  }

  const API_KEY = process.env.GOOGLE_API_KEY;
  const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  if (!API_KEY) {
    return res.status(500).json({
      error: { message: 'No GOOGLE_API_KEY found. Please add GOOGLE_API_KEY in your Vercel Project Settings (Environment Variables).' }
    });
  }

  try {
    const payload = req.body || {};
    const prompt = typeof payload === 'string' ? payload : (payload.prompt || '');
    const isJson = typeof payload === 'object' ? Boolean(payload.isJson) : (prompt.includes('JSON') || prompt.includes('[') || prompt.includes('{'));
    const useSearch = typeof payload === 'object' ? Boolean(payload.useSearch) : false;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

    const requestBody = {
      systemInstruction: {
        parts: [{ text: "You are the specialized culinary AI engine for Hapag Kiosk referencing Panlasang Pinoy. When asked to provide JSON data, return ONLY valid JSON without any markdown formatting or preambles." }]
      },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2
      }
    };

    if (isJson) {
      requestBody.generationConfig.responseMimeType = "application/json";
    }

    if (useSearch) {
      requestBody.tools = [{ google_search: {} }];
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': API_KEY
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: { message: (data && data.error && data.error.message) || `API request failed: ${response.status}` }
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: { message: err.message || 'Internal Server Error' } });
  }
};
