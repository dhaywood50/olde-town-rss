# Olde Town Listings RSS Feed

This project creates a custom RSS feed for:

- Source listings page: `https://properties.oldetownrealtyoh.com/i/all-olde-town-listings`
- RSS output endpoint: `/rss.xml`

Use that RSS URL in Zapier (`RSS by Zapier -> New Item in Feed`) and trigger Facebook posting.

## What this does

- Fetches the listings page.
- Parses listing cards (title, link, price/details, image, date when available).
- If listings are not directly in page HTML, it extracts IDX search config and fetches `results.php` as a fallback.
- Serves RSS XML at `/rss.xml`.

## Local run

1. Install deps:

```bash
npm install
```

2. Start server:

```bash
npm start
```

3. Open:

- `http://localhost:3000/rss.xml`
- `http://localhost:3000/health`

## Environment variables

- `PORT` (default `3000`)
- `SOURCE_URL` (default `https://properties.oldetownrealtyoh.com/i/all-olde-town-listings`)
- `SITE_URL` (default `https://properties.oldetownrealtyoh.com`)
- `CACHE_TTL_MS` (default `300000` = 5 minutes)

## Deploy quickly (Render example)

1. Push this folder to a GitHub repo.
2. In Render, create a new **Web Service** from that repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. After deploy, your feed URL will be:

```text
https://<your-render-service>.onrender.com/rss.xml
```

Use that URL in Zapier.

## Zapier setup

1. Trigger app: **RSS by Zapier**
2. Trigger event: **New Item in Feed**
3. Feed URL: `https://<your-host>/rss.xml`
4. Action app: **Facebook Pages**
5. Action event: **Create Page Post**
6. Map fields:
   - Message: `{{title}} - {{link}}`
   - Optional image from `{{enclosure url}}`

## Notes

- This avoids dependency on `rss.app`.
- If the IDX page markup changes in the future, parser selectors may need an update.
