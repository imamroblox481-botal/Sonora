/* Vercel serverless function: SoundCloud search / resolve / stream, no key needed from you.
   Grabs SoundCloud's public client_id server-side and caches it. Free on Vercel. */
let CID = { id: null, at: 0 };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function getClientId(force) {
  if (!force && CID.id && Date.now() - CID.at < 6 * 3600e3) return CID.id;
  const home = await (await fetch('https://soundcloud.com/', { headers: { 'user-agent': UA } })).text();
  const scripts = [...home.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map(m => m[1]);
  for (const src of scripts.reverse()) {
    const js = await (await fetch(src, { headers: { 'user-agent': UA } })).text();
    const m = js.match(/client_id\s*:\s*"([a-zA-Z0-9]{20,40})"/);
    if (m) { CID = { id: m[1], at: Date.now() }; return CID.id; }
  }
  throw new Error('no client id');
}
async function scJson(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA } });
  if (!r.ok) throw new Error('sc ' + r.status);
  return r.json();
}
async function withCid(fn) {
  try { return await fn(await getClientId(false)); }
  catch (e) { return await fn(await getClientId(true)); }   // key may have rotated: refresh once
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
  const { op, q, limit, url, id } = req.query || {};
  try {
    if (op === 'search') {
      const j = await withCid(cid => scJson('https://api-v2.soundcloud.com/search/tracks?q=' + encodeURIComponent(q || '') +
        '&limit=' + Math.min(+limit || 30, 50) + '&client_id=' + cid));
      return res.status(200).json({ collection: j.collection || [] });
    }
    if (op === 'resolve') {
      const j = await withCid(cid => scJson('https://api-v2.soundcloud.com/resolve?url=' + encodeURIComponent(url) + '&client_id=' + cid));
      return res.status(200).json(j);
    }
    if (op === 'stream') {
      /* returns a playable audio URL for a track (progressive mp3 preferred, HLS otherwise) */
      const info = await withCid(async cid => {
        const j = id
          ? await scJson('https://api-v2.soundcloud.com/tracks/' + id + '?client_id=' + cid)
          : await scJson('https://api-v2.soundcloud.com/resolve?url=' + encodeURIComponent(url) + '&client_id=' + cid);
        return { j, cid };
      });
      const j = info.j;
      const tx = (j.media && j.media.transcodings) || [];
      const pick = tx.find(x => x.format && x.format.protocol === 'progressive' && x.format.mime_type === 'audio/mpeg')
        || tx.find(x => x.format && x.format.mime_type === 'audio/mpeg')
        || tx.find(x => x.format && x.format.protocol === 'hls');
      if (!pick) return res.status(404).json({ error: 'no stream' });
      const auth = j.track_authorization ? '&track_authorization=' + encodeURIComponent(j.track_authorization) : '';
      const st = await scJson(pick.url + (pick.url.includes('?') ? '&' : '?') + 'client_id=' + info.cid + auth);
      return res.status(200).json({ url: st.url, protocol: pick.format.protocol, title: j.title, artist: j.user && j.user.username });
    }
    return res.status(400).json({ error: 'bad op' });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
};
