require('dotenv').config();
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const API_KEY = process.env.GOOGLE_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

function createWindow() {
  const win = new BrowserWindow({
    width: 540,
    height: 960,
    minWidth: 420,
    minHeight: 700,
    title: 'Hapag — Filipino Ulam Kiosk',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// In-memory cache for fast repeat searches and zero-latency instant responses
const aiCache = new Map();

// Handles every AI call from the renderer with speed optimizations:
// - Native JSON mode when structured data is requested
// - Fast response generation without heavy search grounding latency
// - In-memory LRU cache for instant results on repeated requests
ipcMain.handle('ai-call', async (_event, payload) => {
  if (!API_KEY) {
    return { error: { message: 'No GOOGLE_API_KEY found. Add one to your .env file (see .env.example) and restart the app.' } };
  }

  const prompt = typeof payload === 'string' ? payload : (payload.prompt || '');
  const isJson = typeof payload === 'object' ? payload.isJson : (prompt.includes('JSON') || prompt.includes('[') || prompt.includes('{'));
  const useSearch = typeof payload === 'object' ? Boolean(payload.useSearch) : false;

  // Check cache
  const cacheKey = `${isJson}:${prompt.trim()}`;
  if (aiCache.has(cacheKey)) {
    return aiCache.get(cacheKey);
  }

  try {
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
      return { error: { message: (data && data.error && data.error.message) || `API request failed: ${response.status}` } };
    }

    // Cache successful response (keep max 100 entries)
    if (aiCache.size > 100) {
      const firstKey = aiCache.keys().next().value;
      aiCache.delete(firstKey);
    }
    aiCache.set(cacheKey, data);

    return data;
  } catch (err) {
    return { error: { message: err.message || 'Network error calling the Gemini API' } };
  }
});

/* ================================================= DYNAMIC DISH IMAGE FETCHER */

const https = require('https');
const fs = require('fs');

const USER_AGENT = 'HapagFilipinoFoodKiosk/2.0 (educational/open-source; contact@hapag.local)';
const dynamicCacheDir = path.join(__dirname, 'renderer', 'images', 'cache');

if (!fs.existsSync(dynamicCacheDir)) {
  fs.mkdirSync(dynamicCacheDir, { recursive: true });
}

function searchWebImage(query) {
  return new Promise((resolve) => {
    if (!query) return resolve(null);
    const clean = query.replace(/special|recipe|with|and|at|sa|\([^)]*\)/gi, ' ').replace(/\s+/g, ' ').trim();
    
    // 1. Try Wikipedia search first (high relevance for named Filipino dishes)
    const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(clean + ' Filipino')}&gsrlimit=1&prop=pageimages&piprop=thumbnail|original&pithumbsize=600&format=json`;

    const req = https.get(wikiUrl, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.query && json.query.pages) {
            const page = Object.values(json.query.pages)[0];
            if (page && (page.thumbnail || page.original)) {
              const url = (page.thumbnail && page.thumbnail.source) || (page.original && page.original.source);
              return resolve(url);
            }
          }
        } catch (e) {}

        // 2. Fallback: Search Wikimedia Commons directly for image files
        const commonsUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(clean + ' Filipino food')}&gsrnamespace=6&gsrlimit=1&prop=imageinfo&iiprop=url&iiurlwidth=600&format=json`;
        const req2 = https.get(commonsUrl, { headers: { 'User-Agent': USER_AGENT } }, (res2) => {
          let data2 = '';
          res2.on('data', chunk => data2 += chunk);
          res2.on('end', () => {
            try {
              const json2 = JSON.parse(data2);
              if (json2.query && json2.query.pages) {
                const page2 = Object.values(json2.query.pages)[0];
                if (page2 && page2.imageinfo && page2.imageinfo[0]) {
                  const url = page2.imageinfo[0].thumburl || page2.imageinfo[0].url;
                  return resolve(url);
                }
              }
            } catch (e) {}
            resolve(null);
          });
        });
        req2.on('error', () => resolve(null));
        req2.setTimeout(5000, () => { req2.destroy(); resolve(null); });
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
  });
}

function downloadImageFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadImageFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Status ${res.statusCode}`));
      }
      const ws = fs.createWriteStream(destPath);
      res.pipe(ws);
      ws.on('finish', () => ws.close(() => resolve(destPath)));
    });
    req.on('error', reject);
    req.setTimeout(7000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function getOrFetchDishImage(dishName, dishFname) {
  const slug = (dishFname || dishName || 'dish').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const localFileName = `dynamic-${slug}.jpg`;
  const localFilePath = path.join(dynamicCacheDir, localFileName);
  const relativePath = `./images/cache/${localFileName}`;

  // If already downloaded and valid, return local path instantly
  if (fs.existsSync(localFilePath) && fs.statSync(localFilePath).size > 1000) {
    return relativePath;
  }

  // Fetch authentic photo from web
  let webUrl = await searchWebImage(dishFname || dishName);
  if (!webUrl && dishName && dishName !== dishFname) {
    webUrl = await searchWebImage(dishName);
  }

  if (webUrl) {
    try {
      await downloadImageFile(webUrl, localFilePath);
      return relativePath;
    } catch (e) {
      return webUrl;
    }
  }

  return null;
}

// Dynamically fetch and cache exact web photo for any dish query
ipcMain.handle('fetch-dish-image', async (_event, dish) => {
  if (!dish) return null;
  try {
    return await getOrFetchDishImage(dish.name, dish.fname);
  } catch (err) {
    console.warn('Error in fetch-dish-image:', err.message);
    return null;
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
