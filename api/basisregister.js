/**
 * api/basisregister.js
 * Vercel serverless function — replicates the Python script's basisregister logic.
 *
 * On every request it:
 *  1. Scrapes linked.toerismevlaanderen.be/datasets to find the current CSV URL
 *     (the UUID in the URL changes with each release — same strategy as the Python script)
 *  2. Downloads the full CSV (~10 MB)
 *  3. Parses, filters on Leuven postcodes + product_type BASE, normalises coords
 *  4. Returns a clean JSON array to the frontend
 *
 * Vercel CDN caches the response for 1 hour so most page loads are instant.
 * The full scrape + download only runs once per hour per region.
 */

const DATASETS_PAGE    = 'https://linked.toerismevlaanderen.be/datasets';
const CSV_LABEL        = 'Basisregister Vlaams Logiesaanbod';
const LEUVEN_POSTCODES = new Set([3000, 3001, 3010, 3012, 3018]);

const DISC_MAP = {
  HOTEL:               'Hotel',
  BED_AND_BREAKFAST:   'B&B',
  HOLIDAY_COTTAGE:     'Vakantiewoning',
  HOSTEL:              'Hostel',
  CAMPER_TERRAIN:      'Camping',
  GENERIC_ROOMS:       'Kamergerelateerde logies',
  YOUTH_ACCOMMODATION: 'Jeugdverblijf',
};

/**
 * Replicates Python's _coord_normaliseer — handles the shifted coordinate
 * format that sometimes appears in the register (divide by 10 until in range).
 */
function coordNorm(val, lo, hi) {
  const v0 = parseFloat(val);
  if (!val || isNaN(v0) || v0 === 0) return null;
  let v = v0;
  while (Math.abs(v) > hi * 10) v /= 10;
  return v >= lo && v <= hi ? Math.round(v * 1e7) / 1e7 : null;
}

/**
 * Simple semicolon-delimited CSV parser.
 * The basisregister fields do not contain semicolons, so no quoting logic needed.
 */
function parseCsv(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(';').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const vals = line.split(';').map(v => v.replace(/^"|"$/g, ''));
    if (vals.length < headers.length) continue;
    const row = {};
    headers.forEach((h, j) => { row[h] = vals[j] ?? ''; });
    rows.push(row);
  }
  return rows;
}

/**
 * Scrapes the datasets page for the heading containing CSV_LABEL + "CSV",
 * then returns the href of the first <a> that follows it.
 * Mirrors the Python beautifulsoup scraping strategy exactly.
 */
async function findCsvUrl(html) {
  const headingRe = /<h[1-5][^>]*>([\s\S]*?)<\/h[1-5]>/gi;
  let match;
  while ((match = headingRe.exec(html)) !== null) {
    const text = match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.includes(CSV_LABEL) && text.toUpperCase().includes('CSV')) {
      const rest = html.slice(headingRe.lastIndex);
      const linkMatch = rest.match(/<a[^>]+href="([^"]+)"/i);
      if (linkMatch) {
        const href = linkMatch[1];
        return href.startsWith('http') ? href : new URL(href, DATASETS_PAGE).href;
      }
    }
  }
  throw new Error(`CSV download link not found on ${DATASETS_PAGE}`);
}

module.exports = async (req, res) => {
  // Serve fresh for 1 h; CDN may serve stale for up to 6 h while revalidating.
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=21600');

  try {
    // 1. Scrape datasets page for the current CSV download URL.
    const pageRes = await fetch(DATASETS_PAGE, { signal: AbortSignal.timeout(15000) });
    if (!pageRes.ok) throw new Error(`Datasets pagina: HTTP ${pageRes.status}`);
    const html = await pageRes.text();
    const csvUrl = await findCsvUrl(html);

    // 2. Download the full CSV (~10 MB).
    const csvRes = await fetch(csvUrl, { signal: AbortSignal.timeout(45000) });
    if (!csvRes.ok) throw new Error(`CSV download: HTTP ${csvRes.status}`);
    const csvText = await csvRes.text();

    // 3. Parse, filter on Leuven postcodes + BASE, normalise coordinates.
    const rows   = parseCsv(csvText);
    const result = [];

    for (const row of rows) {
      if (row.product_type !== 'BASE') continue;
      if (!LEUVEN_POSTCODES.has(parseInt(row.postal_code, 10))) continue;

      // Coordinates are optional — entries without them still appear in the
      // analysis engine's register lookup (to avoid false nk flags).
      // The map simply skips entries where lat/lon are null.
      const lat = coordNorm(row.lat,  49, 52);
      const lon = coordNorm(row.long,  2,  7);

      const raw  = (row.name_or_number || row.name || '—').trim().replace(/^'+|'+$/g, '');
      const box  = row.box_number?.trim().replace(/^bus\s*/i, '');
      const adres = `${row.street} ${row.house_number}${box ? ` bus ${box}` : ''}, ${row.postal_code} ${row.city_name}`.trim();

      result.push({
        id:     parseInt(row.business_product_id, 10),
        naam:   raw || '—',
        adres,
        disc:   DISC_MAP[row.discriminator] || row.discriminator || '—',
        units:  parseInt(row.number_of_units,   10) || null,
        cap:    parseInt(row.maximum_capacity,   10) || null,
        lat:    lat ?? null,
        lon:    lon ?? null,
        status: row.status || '',
      });
    }

    res.status(200).json(result);

  } catch (err) {
    console.error('[basisregister]', err.message);
    res.status(500).json({ error: err.message });
  }
};
