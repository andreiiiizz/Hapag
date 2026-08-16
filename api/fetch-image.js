const https = require('https');

const USER_AGENT = 'HapagFilipinoFoodKiosk/2.0 (educational/open-source; contact@hapag.local)';

function searchWebImage(query) {
  return new Promise((resolve) => {
    if (!query) return resolve(null);
    const clean = query.replace(/special|recipe|with|and|at|sa|\([^)]*\)/gi, ' ').replace(/\s+/g, ' ').trim();

    // 1. Try Wikipedia search first
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

        // 2. Fallback: Search Wikimedia Commons
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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const queryName = req.method === 'POST'
    ? (req.body?.fname || req.body?.name)
    : req.query.q;

  if (!queryName) {
    return res.status(200).json({ url: null });
  }

  try {
    const url = await searchWebImage(queryName);
    return res.status(200).json({ url });
  } catch (err) {
    return res.status(200).json({ url: null });
  }
};
