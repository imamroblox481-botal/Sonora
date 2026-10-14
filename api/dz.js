/* Vercel serverless function: proxies Deezer's public artist data (photos, top tracks). No key needed. */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  const p = String((req.query && req.query.path) || '');
  if (!/^\/(search\/artist|artist\/\d+\/top|search\/track)/.test(p)) return res.status(400).json({ error: 'bad path' });
  try {
    const r = await fetch('https://api.deezer.com' + p);
    if (!r.ok) return res.status(r.status).json({ error: 'deezer ' + r.status });
    return res.status(200).json(await r.json());
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
};
