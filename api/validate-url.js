const urlValidationCache = new Map();

async function validatePanlasangPinoyUrl(payload) {
  const url = typeof payload === 'string' ? payload : (payload?.url || '');
  const name = typeof payload === 'object' ? (payload?.name || '') : '';
  const fname = typeof payload === 'object' ? (payload?.fname || '') : '';
  const query = typeof payload === 'object' ? (payload?.query || '') : '';
  const dishName = name || fname || query || '';

  const cacheKey = `${url}::${name}::${fname}::${query}`.trim().toLowerCase();
  if (urlValidationCache.has(cacheKey)) {
    return urlValidationCache.get(cacheKey);
  }

  // Helper to fetch and inspect HTML
  const checkUrl = async (targetUrl) => {
    try {
      const res = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(6000),
      });

      if (!res.ok) {
        return { valid: false, status: res.status, url: targetUrl };
      }

      const text = await res.text();
      const isNotFound = text.includes('no-results') ||
                         text.includes('Sorry, no content matched your criteria') ||
                         text.includes('Apologies, but no results were found') ||
                         text.includes('class="error404"') ||
                         text.includes('Page Not Found') ||
                         text.includes('404 Not Found');

      if (isNotFound) {
        return { valid: false, status: 404, url: targetUrl };
      }

      // If it's a search page, verify whether actual recipe articles exist and extract the top matching article link
      if (targetUrl.includes('?s=')) {
        const articleMatches = [...text.matchAll(/<h2 class="entry-title"[^>]*><a\s+(?:[^>]*?\s+)?href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/gi)];
        if (articleMatches.length > 0) {
          const firstArticleUrl = articleMatches[0][1];
          return { valid: true, status: 200, url: firstArticleUrl };
        }
        // Also check entry-image-link if entry-title didn't match
        const imgLinkMatch = text.match(/<a class="entry-image-link" href="([^"]+)"/i);
        if (imgLinkMatch) {
          return { valid: true, status: 200, url: imgLinkMatch[1] };
        }
        return { valid: false, status: 404, url: targetUrl };
      }

      return { valid: true, status: 200, url: res.url || targetUrl };
    } catch (err) {
      return { valid: false, error: err.message, url: targetUrl };
    }
  };

  let result = { valid: false, url: null };

  // 1. If a direct URL was provided (and it is not a raw search URL), validate it first
  if (url && url.startsWith('http') && !url.includes('?s=')) {
    const directCheck = await checkUrl(url);
    if (directCheck.valid) {
      result = { valid: true, url: directCheck.url };
    }
  }

  // 2. Search candidates on Panlasang Pinoy
  const searchTerms = [name, fname, query, dishName]
    .map((t) => (t || '').replace(/special|recipe|with|and|at|sa|\([^)]*\)/gi, ' ').replace(/\s+/g, ' ').trim())
    .filter((t, i, arr) => t.length > 0 && arr.indexOf(t) === i);

  if (!result.valid) {
    for (const term of searchTerms) {
      const searchUrl = `https://panlasangpinoy.com/?s=${encodeURIComponent(term)}`;
      const searchCheck = await checkUrl(searchUrl);
      if (searchCheck.valid && searchCheck.url) {
        result = { valid: true, url: searchCheck.url };
        break;
      }
    }
  }

  // Cache up to 200 results
  if (urlValidationCache.size > 200) {
    const first = urlValidationCache.keys().next().value;
    urlValidationCache.delete(first);
  }
  urlValidationCache.set(cacheKey, result);

  return result;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const payload = req.method === 'POST' ? req.body : req.query;
  try {
    const data = await validatePanlasangPinoyUrl(payload || {});
    return res.status(200).json(data);
  } catch (err) {
    return res.status(200).json({ valid: false, url: null, error: err.message });
  }
};
