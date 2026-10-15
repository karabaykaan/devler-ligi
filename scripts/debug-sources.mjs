// Geçici: oran ve sonuç kaynaklarının yapısını incelemek için örnek kaydeder (data/debug/).
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = new URL('../data/debug/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const save = (n, o) => writeFileSync(new URL(n, OUT), JSON.stringify(o, null, 1));
const H = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36', Accept: 'application/json', 'Accept-Language': 'tr-TR,tr;q=0.9' };
async function get(url, extra) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: Object.assign({}, H, extra || {}) });
    const txt = await r.text();
    let json = null; try { json = JSON.parse(txt); } catch (e) {}
    return { url, status: r.status, ms: Date.now() - t0, bytes: txt.length, json, head: json ? undefined : txt.slice(0, 400) };
  } catch (e) { return { url, error: String(e) }; }
}
const summary = {};

// 1) iddaa yarışmalar
const comp = await get('https://sportsbookv2.iddaa.com/sportsbook/competitions?st=1', { Origin: 'https://www.iddaa.com', Referer: 'https://www.iddaa.com/' });
summary.iddaaComp = { status: comp.status, bytes: comp.bytes, error: comp.error, head: comp.head };
const comps = (comp.json && comp.json.data) || [];
const ucl = comps.filter((c) => /şampiyonlar|champions/i.test(c.n || '') );
save('iddaa-competitions-ucl.json', ucl);

// 2) iddaa futbol etkinlikleri
const ev = await get('https://sportsbookv2.iddaa.com/sportsbook/events?st=1&type=0&version=0', { Origin: 'https://www.iddaa.com', Referer: 'https://www.iddaa.com/' });
summary.iddaaEvents = { status: ev.status, bytes: ev.bytes, error: ev.error, head: ev.head, topKeys: ev.json ? Object.keys(ev.json) : null };
const evData = ev.json && ev.json.data;
const events = (evData && (evData.events || evData)) || [];
summary.iddaaEventCount = Array.isArray(events) ? events.length : typeof events;
if (Array.isArray(events)) {
  summary.iddaaEventKeys = events[0] ? Object.keys(events[0]) : null;
  const uclIds = new Set(ucl.map((c) => c.i));
  const uclEv = events.filter((e) => uclIds.has(e.ci));
  save('iddaa-ucl-events.json', uclEv);
  save('iddaa-sample-events.json', events.slice(0, 3));
  // pazar tiplerinin özeti
  const mt = {};
  events.forEach((e) => (e.m || []).forEach((m) => {
    const k = 't' + m.t + '_st' + m.st;
    if (!mt[k]) mt[k] = { n: 0, sov: new Set(), outs: new Set(), sample: null };
    mt[k].n++; if (m.sov !== undefined) mt[k].sov.add(m.sov);
    (m.o || []).forEach((o) => mt[k].outs.add(String(o.no) + ':' + (o.n || '')));
    if (!mt[k].sample) mt[k].sample = { event: e.hn + ' - ' + e.an, m };
  }));
  Object.keys(mt).forEach((k) => { mt[k].sov = [...mt[k].sov].slice(0, 12); mt[k].outs = [...mt[k].outs].slice(0, 20); });
  save('iddaa-market-types.json', mt);
  summary.iddaaUclEvents = uclEv.length;
} else if (evData) {
  save('iddaa-events-raw-head.json', JSON.stringify(evData).slice(0, 20000));
}

// 3) iddaa pazar tanımları (varsa)
for (const u of ['https://sportsbookv2.iddaa.com/sportsbook/get_markets?st=1', 'https://sportsbookv2.iddaa.com/sportsbook/market-config', 'https://contentv2.iddaa.com/sportsbook/market-groups?sportType=1']) {
  const r = await get(u, { Origin: 'https://www.iddaa.com', Referer: 'https://www.iddaa.com/' });
  summary[u] = { status: r.status, bytes: r.bytes, error: r.error };
  if (r.json) save('iddaa-' + u.split('/').pop().replace(/[^a-z0-9-]/gi, '_') + '.json', r.json);
}

// 4) Nesine bülteni
const nes = await get('https://cdnbulten.nesine.com/api/bulten/getprebultenfull', { Origin: 'https://www.nesine.com', Referer: 'https://www.nesine.com/' });
summary.nesine = { status: nes.status, bytes: nes.bytes, error: nes.error, head: nes.head };
const ea = nes.json && nes.json.sg && nes.json.sg.EA;
if (Array.isArray(ea)) {
  summary.nesineEvents = ea.length;
  summary.nesineKeys = ea[0] ? Object.keys(ea[0]) : null;
  const fb = ea.filter((e) => e.HN && e.AN);
  save('nesine-sample.json', fb.slice(0, 3));
  const uclTeams = /Liverpool|Barcelona|Arsenal|Bayern|Real Madrid|Inter|Psg|Paris|Galatasaray|Fenerbah/i;
  save('nesine-candidates.json', fb.filter((e) => uclTeams.test(e.HN + ' ' + e.AN)).slice(0, 40));
  const lc = {};
  fb.forEach((e) => { const k = String(e.LC); lc[k] = lc[k] || []; if (lc[k].length < 2) lc[k].push(e.HN + ' - ' + e.AN + ' ' + e.D); });
  save('nesine-leagues.json', lc);
}

// 5) ESPN sonuçları
const espn = await get('https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard?dates=20261014');
summary.espn = { status: espn.status, bytes: espn.bytes, error: espn.error };
if (espn.json) {
  const evs = espn.json.events || [];
  summary.espnEvents = evs.length;
  save('espn-sample.json', evs.slice(0, 2));
}
const espn2 = await get('https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard?dates=20261020-20261021');
summary.espnNext = { status: espn2.status, events: espn2.json && (espn2.json.events || []).map((e) => e.date + ' ' + e.name) };

const sumR = await get('https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/summary?event=401915416');
summary.espnSummary = { status: sumR.status, keys: sumR.json ? Object.keys(sumR.json) : null };
if (sumR.json && sumR.json.header) {
  const comp = (sumR.json.header.competitions || [])[0] || {};
  save('espn-summary-header.json', { status: comp.status, competitors: (comp.competitors || []).map((c) => ({ homeAway: c.homeAway, team: c.team && c.team.displayName, score: c.score, linescores: c.linescores })) });
}
const sc2 = await get('https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard?dates=20261020');
summary.espnOct20 = { status: sc2.status, events: sc2.json && (sc2.json.events || []).map((e) => e.id + ' ' + e.date + ' ' + e.name) };
// iddaa sonuç uç noktaları (varsa)
for (const u of ['https://sportsbookv2.iddaa.com/sportsbook/results?st=1', 'https://statisticsv2.iddaa.com/statistics/results/1']) {
  const r = await get(u, { Origin: 'https://www.iddaa.com', Referer: 'https://www.iddaa.com/' });
  summary[u] = { status: r.status, bytes: r.bytes };
}
save('summary.json', summary);
console.log(JSON.stringify(summary, null, 1));
