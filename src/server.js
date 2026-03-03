const express = require('express');
const cheerio = require('cheerio');

const app = express();

const SOURCE_URL = process.env.SOURCE_URL || 'https://properties.oldetownrealtyoh.com/i/all-olde-town-listings';
const SITE_URL = process.env.SITE_URL || 'https://properties.oldetownrealtyoh.com';
const PORT = Number(process.env.PORT || 3000);
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 5 * 60 * 1000);

let cache = {
  ts: 0,
  xml: null,
  itemCount: 0,
};

function xmlEscape(input) {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function asAbsoluteUrl(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('//')) return `https:${url}`;
  return new URL(url, SITE_URL).toString();
}

function pickText($card, selectors) {
  for (const sel of selectors) {
    const text = $card.find(sel).first().text().trim();
    if (text) return text;
  }
  return '';
}

function pickAttr($card, selectors, attr) {
  for (const sel of selectors) {
    const value = $card.find(sel).first().attr(attr);
    if (value && String(value).trim()) return String(value).trim();
  }
  return '';
}

function extractConfigFromPage(html) {
  const jsonMatch = html.match(/\{\s*"page"\s*:\s*"listings"[\s\S]*?\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed || !parsed.idxID) return null;
    return parsed;
  } catch {
    return null;
  }
}

function textDateToIso(text) {
  if (!text) return null;
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const d = new Date(cleaned);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  return null;
}

function parseListingsFromHtml(html) {
  const $ = cheerio.load(html);
  const cards = [
    '.idx-results-cell',
    '.idx-listing',
    '.idx-property',
    '.idx-result',
    '[class*="idx-results-cell"]',
    '[class*="listing-card"]',
  ];

  let $items = $();
  for (const sel of cards) {
    const found = $(sel);
    if (found.length) {
      $items = found;
      break;
    }
  }

  const parsed = [];
  const seen = new Set();

  $items.each((_, el) => {
    const $card = $(el);

    const relLink = pickAttr($card, [
      'a[href*="/idx/details"]',
      'a[href*="/details"]',
      'a[href*="/listing"]',
      'a[href]'
    ], 'href');

    if (!relLink) return;

    const link = asAbsoluteUrl(relLink);
    if (seen.has(link)) return;

    const title = pickText($card, [
      '.idx-address',
      '.idx-address-wrapper',
      '.idx-prop-address',
      '.address',
      'h3',
      'h2',
      'a[href*="/idx/details"]',
      'a[href]'
    ]) || 'New Listing';

    const price = pickText($card, [
      '.idx-price',
      '.idx-prop-price',
      '.price',
      '[class*="price"]'
    ]);

    const beds = pickText($card, [
      '.idx-beds',
      '.beds',
      '[class*="bed"]'
    ]);

    const baths = pickText($card, [
      '.idx-baths',
      '.baths',
      '[class*="bath"]'
    ]);

    const sqft = pickText($card, [
      '.idx-sqft',
      '.sqft',
      '[class*="sqft"]',
      '[class*="square"]'
    ]);

    const status = pickText($card, [
      '.idx-status',
      '.status',
      '[class*="status"]'
    ]);

    const listedDateText = pickText($card, [
      '.idx-listed',
      '.idx-field-added',
      '.listed-date',
      '[class*="date"]'
    ]);

    const dateIso = textDateToIso(listedDateText);

    const image = asAbsoluteUrl(pickAttr($card, [
      'img[src]',
      'img[data-src]',
      'img[data-lazy-src]'
    ], 'src') || pickAttr($card, ['img[data-src]', 'img[data-lazy-src]'], 'data-src'));

    const descriptionParts = [price, beds, baths, sqft, status].filter(Boolean);
    const description = descriptionParts.join(' | ');

    parsed.push({
      title,
      link,
      description,
      pubDate: dateIso ? new Date(dateIso).toUTCString() : new Date().toUTCString(),
      image,
      guid: link,
    });

    seen.add(link);
  });

  return parsed;
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; OldeTownRSS/1.0; +https://properties.oldetownrealtyoh.com)',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Fetch failed (${response.status}) for ${url}`);
  }

  return response.text();
}

function buildResultsUrl(config) {
  const url = new URL('/results.php', SITE_URL);
  const params = new URLSearchParams();

  Object.entries(config).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((v, i) => params.append(`${key}[${i}]`, String(v)));
      return;
    }

    if (value !== null && value !== undefined && value !== '') {
      params.append(key, String(value));
    }
  });

  params.set('start', '1');
  url.search = params.toString();
  return url.toString();
}

function buildRssXml(items) {
  const now = new Date().toUTCString();

  const entries = items.map((item) => {
    const media = item.image
      ? `\n      <enclosure url="${xmlEscape(item.image)}" type="image/jpeg" />`
      : '';

    return `    <item>
      <title>${xmlEscape(item.title)}</title>
      <link>${xmlEscape(item.link)}</link>
      <guid isPermaLink="true">${xmlEscape(item.guid)}</guid>
      <description>${xmlEscape(item.description || item.title)}</description>
      <pubDate>${xmlEscape(item.pubDate || now)}</pubDate>${media}
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Olde Town Realty Listings</title>
    <link>${xmlEscape(SOURCE_URL)}</link>
    <description>Latest Olde Town Realty property listings</description>
    <language>en-us</language>
    <lastBuildDate>${xmlEscape(now)}</lastBuildDate>
${entries}
  </channel>
</rss>`;
}

async function generateFeed() {
  const sourceHtml = await fetchHtml(SOURCE_URL);
  let items = parseListingsFromHtml(sourceHtml);

  if (!items.length) {
    const config = extractConfigFromPage(sourceHtml);
    if (config) {
      const resultsUrl = buildResultsUrl(config);
      const resultsHtml = await fetchHtml(resultsUrl);
      items = parseListingsFromHtml(resultsHtml);
    }
  }


  return buildRssXml(items);
}

app.get('/', (_, res) => {
  res.type('text/plain').send('Olde Town RSS feed service is running. Use /rss.xml');
});

app.get('/health', (_, res) => {
  res.json({
    ok: true,
    cachedItems: cache.itemCount,
    lastRefresh: cache.ts || null,
  });
});

app.get('/rss.xml', async (_, res) => {
  try {
    const isFresh = cache.xml && (Date.now() - cache.ts < CACHE_TTL_MS);
    if (!isFresh) {
      const xml = await generateFeed();
      const itemCount = (xml.match(/<item>/g) || []).length;
      cache = { ts: Date.now(), xml, itemCount };
    }

    res.set('Cache-Control', 'public, max-age=300');
    res.type('application/rss+xml; charset=utf-8').send(cache.xml);
  } catch (error) {
    const now = new Date().toUTCString();
    const fallbackXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Olde Town Realty Listings</title>
    <link>${xmlEscape(SOURCE_URL)}</link>
    <description>Feed temporarily unavailable; retrying automatically.</description>
    <language>en-us</language>
    <lastBuildDate>${xmlEscape(now)}</lastBuildDate>
  </channel>
</rss>`;

    res.set('Cache-Control', 'public, max-age=120');
    res.type('application/rss+xml; charset=utf-8').send(fallbackXml);
  }
});

    }

    res.set('Cache-Control', 'public, max-age=300');
    res.type('application/rss+xml; charset=utf-8').send(cache.xml);
  } catch (error) {
    res.status(502).json({
      error: 'Failed to build RSS feed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

app.listen(PORT, () => {
  console.log(`RSS service listening on :${PORT}`);
});
