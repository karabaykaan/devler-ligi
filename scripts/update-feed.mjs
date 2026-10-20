// GitHub Actions'ta saatte bir çalışır: data/feed.json'u günceller.
//  - Oranlar: iddaa programı (sportsbookv2.iddaa.com). "wodd" değerleri Nesine'deki oranlarla aynıdır.
//  - Sonuçlar: ESPN (devre ve normal süre skoru; uzatma ve penaltı sayılmaz).
//  - Hafta açılışı: bir haftanın oranları gelince bülten açılır (opensAt), sonra oranlar sabitlenir.
// Değişiklik yoksa dosyaya dokunmaz. Uyarıları data/update-status.json'a yazar.
import { readFileSync, writeFileSync } from 'node:fs';

const FEED = new URL('../data/feed.json', import.meta.url);
const STATUS = new URL('../data/update-status.json', import.meta.url);
const NOW = Number(process.env.NOW_MS) || Date.now();
const H = 3600e3;
const UA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36', Accept: 'application/json', 'Accept-Language': 'tr-TR,tr;q=0.9' };
const IDDAA_H = Object.assign({ Origin: 'https://www.iddaa.com', Referer: 'https://www.iddaa.com/' }, UA);
const UCL_CI = new Set([126, 46194]);
const NOT_MEN_SENIOR = /\((K|Kadın|Kadin)\)|\bU\s?1\d\b|\bU\s?2\d\b|Kadınlar/i;

// 2026/27 Şampiyonlar Ligi takvimi (Türkiye saatiyle maç günleri)
const CAL = [
  ['2026-10-20', '2026-10-21', '3. Hafta', 'Lig Aşaması'],
  ['2026-11-03', '2026-11-04', '4. Hafta', 'Lig Aşaması'],
  ['2026-11-24', '2026-11-25', '5. Hafta', 'Lig Aşaması'],
  ['2026-12-08', '2026-12-09', '6. Hafta', 'Lig Aşaması'],
  ['2027-01-19', '2027-01-20', '7. Hafta', 'Lig Aşaması'],
  ['2027-01-27', '2027-01-28', '8. Hafta', 'Lig Aşaması'],
  ['2027-02-16', '2027-02-17', 'Play-off 1. Maç', 'Eleme Turu Play-off'],
  ['2027-02-23', '2027-02-24', 'Play-off 2. Maç', 'Eleme Turu Play-off'],
  ['2027-03-09', '2027-03-10', 'Son 16 1. Maç', 'Son 16'],
  ['2027-03-16', '2027-03-17', 'Son 16 2. Maç', 'Son 16'],
  ['2027-04-06', '2027-04-07', 'Çeyrek Final 1. Maç', 'Çeyrek Final'],
  ['2027-04-13', '2027-04-14', 'Çeyrek Final 2. Maç', 'Çeyrek Final'],
  ['2027-04-27', '2027-04-28', 'Yarı Final 1. Maç', 'Yarı Final'],
  ['2027-05-04', '2027-05-05', 'Yarı Final 2. Maç', 'Yarı Final'],
  ['2027-06-05', '2027-06-05', 'Final', 'Final', true]
].map(([a, b, name, stage, final], i) => ({
  id: 'r' + String(i + 1).padStart(2, '0'), order: i + 1, name, stage, final: !!final,
  from: Date.parse(a + 'T00:00:00+03:00') - 2 * 24 * H, to: Date.parse(b + 'T23:59:59+03:00') + 2 * 24 * H
}));

const warnings = [];
const changes = [];
const warn = (s) => { warnings.push(s); console.log('UYARI:', s); };

async function getJson(url, headers) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: headers || UA });
      if (r.ok) return await r.json();
      if (r.status === 404 || r.status === 400) return null;
    } catch (e) { /* tekrar dene */ }
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
  throw new Error('Ulaşılamadı: ' + url);
}

/* ---------- isim eşleştirme ---------- */
const STOP = new Set(['fc', 'cf', 'ac', 'as', 'sc', 'sk', 'fk', 'afc', 'ssc', 'cd', 'rc', 'rcd', 'sv', 'vfb', 'vfl', 'tsg', 'bv', 'club', 'de', 'la', 'the', 'k', 'cp', 'calcio', 'osc', 'fsv', 'ud', 'sl', 'gnk', 'hnk', 'nk', 'pfc', 'jk', 'if', 'bk', 'aik']);
const FOLD = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'ø': 'o', 'å': 'a', 'æ': 'ae', 'ß': 'ss', 'ł': 'l', 'đ': 'd' };
const ALIAS = { psg: 'paris saint germain', inter: 'internazionale inter', 'man city': 'manchester city', 'man utd': 'manchester united', 'man united': 'manchester united', munih: 'munich', prag: 'prague', kopenhag: 'copenhagen', 'atl madrid': 'atletico madrid', 'atl.madrid': 'atletico madrid' };
function toks(name) {
  let s = String(name || '').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[çğıöşüøåæßłđ]/g, (c) => FOLD[c] || c);
  Object.keys(ALIAS).forEach((k) => { if (new RegExp('(^|\\W)' + k.replace('.', '\\.') + '(\\W|$)').test(s)) s += ' ' + ALIAS[k]; });
  return [...new Set(s.replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((t) => t && !STOP.has(t)))];
}
function sim(namesA, namesB) {
  let best = 0;
  for (const a of namesA) for (const b of namesB) {
    if (!a || !b) continue;
    if (String(a).toLowerCase() === String(b).toLowerCase()) return 1;
    const A = toks(a), B = toks(b);
    if (!A.length || !B.length) continue;
    const hit = A.filter((x) => B.some((y) => x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x))))).length;
    const hitB = B.filter((y) => A.some((x) => x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x))))).length;
    best = Math.max(best, Math.min(hit, hitB) / Math.min(A.length, B.length));
  }
  return best;
}
// Aynı saatte başlayan maçları iki listeden eşleştirir (en iyi eşleşme önce)
function pair(list, cands, namesOfL, namesOfC) {
  const pairs = [];
  list.forEach((m, i) => cands.forEach((c, j) => {
    if (Math.abs(m.ko - c.ko) > 20 * 60e3) return;
    const sh = sim(namesOfL(m).home, namesOfC(c).home), sa = sim(namesOfL(m).away, namesOfC(c).away);
    if (sh >= 0.5 && sa >= 0.5) pairs.push({ i, j, s: sh + sa });
  }));
  pairs.sort((a, b) => b.s - a.s);
  const usedI = new Set(), usedJ = new Set(), out = [];
  for (const p of pairs) {
    if (usedI.has(p.i) || usedJ.has(p.j)) continue;
    usedI.add(p.i); usedJ.add(p.j); out.push(p);
  }
  return out;
}

/* ---------- iddaa oranları ---------- */
const r2 = (x) => Math.round(x * 100) / 100;
function oddsFrom(ev) {
  const out = {};
  const val = (o) => { const v = Number(o.wodd != null ? o.wodd : o.odd); return isFinite(v) && v > 1.0 ? r2(v) : null; };
  const put = (mk, k, o) => { const v = val(o); if (v !== null) { out[mk] = out[mk] || {}; out[mk][k] = v; } };
  const X = (n) => String(n).replace(/0/g, 'X');
  let hnd = null;
  for (const m of ev.m || []) {
    if (m.s !== undefined && m.s !== 1) continue;
    const os = m.o || [];
    const sov = m.sov != null ? String(m.sov) : '';
    switch (m.st) {
      case 1: os.forEach((o) => { if (['1', '0', '2'].includes(o.n)) put('MS', X(o.n), o); }); break;
      case 92: os.forEach((o) => { const k = { '1 ve 0': '1X', '1 ve 2': '12', '0 ve 2': 'X2' }[o.n]; if (k) put('CS', k, o); }); break;
      case 88: os.forEach((o) => { if (['1', '0', '2'].includes(o.n)) put('IY', X(o.n), o); }); break;
      case 101: {
        const mk = { '1.5': 'AU15', '2.5': 'AU25', '3.5': 'AU35' }[sov];
        if (mk) os.forEach((o) => { const k = { Alt: 'A', 'Üst': 'U' }[o.n]; if (k) put(mk, k, o); });
        break;
      }
      case 60: if (sov === '1.5') os.forEach((o) => { const k = { Alt: 'A', 'Üst': 'U' }[o.n]; if (k) put('IYAU15', k, o); }); break;
      case 89: os.forEach((o) => { const k = { Var: 'V', Yok: 'Y' }[o.n]; if (k) put('KG', k, o); }); break;
      case 4: os.forEach((o) => { const k = { 1: '0-1', 2: '2-3', 3: '4-5', 4: '6+' }[o.no]; if (k) put('TG', k, o); }); break;
      case 90: os.forEach((o) => { if (/^[102]\/[102]$/.test(o.n)) put('IYMS', X(o.n), o); }); break;
      case 100: {
        const n = Number(sov);
        if (!isFinite(n) || n === 0 || !Number.isInteger(n)) break;
        if (hnd && Math.abs(hnd.n) <= Math.abs(n)) break;
        const o3 = {};
        os.forEach((o) => { if (['1', '0', '2'].includes(o.n)) { const v = val(o); if (v !== null) o3[X(o.n)] = v; } });
        if (Object.keys(o3).length) hnd = { n, o: o3 };
        break;
      }
    }
  }
  if (hnd) out.HND = Object.assign({ h: hnd.n > 0 ? hnd.n + ':0' : '0:' + (-hnd.n) }, hnd.o);
  if (!out.MS || Object.keys(out.MS).length < 3) return null;
  return out;
}

/* ---------- ana akış ---------- */
const feed = JSON.parse(readFileSync(FEED, 'utf8'));
const before = JSON.stringify(feed);
feed.rounds = feed.rounds || [];
feed.matches = feed.matches || [];
const roundById = () => Object.fromEntries(feed.rounds.map((r) => [r.id, r]));
const roundMatches = (rid) => feed.matches.filter((m) => m.round === rid);

function ensureRound(ko) {
  const c = CAL.find((x) => ko >= x.from && ko <= x.to);
  if (!c) return null;
  let r = feed.rounds.find((x) => x.id === c.id);
  if (!r) {
    r = { id: c.id, name: c.name, stage: c.stage, order: c.order, final: c.final, opensAt: null };
    feed.rounds.push(r);
    feed.rounds.sort((a, b) => a.order - b.order);
    changes.push('Yeni hafta: ' + c.name);
  }
  return r;
}

// 1) iddaa: Şampiyonlar Ligi maçları ve oranları
let iddaaOk = false;
try {
  const j = await getJson('https://sportsbookv2.iddaa.com/sportsbook/events?st=1&type=0&version=0', IDDAA_H);
  const all = (j && j.data && (j.data.events || j.data)) || [];
  const evs = all.filter((e) => UCL_CI.has(e.ci) && e.hn && e.an && !NOT_MEN_SENIOR.test(e.hn + ' ' + e.an) && (e.m || []).some((m) => m.st === 1))
    .map((e) => ({ e, ko: e.d * 1000, odds: oddsFrom(e) }))
    .filter((x) => x.odds && x.ko > NOW);
  iddaaOk = true;
  const known = new Map(feed.matches.filter((m) => m.code).map((m) => [String(m.code), m]));
  const unknownEv = evs.filter((x) => !known.has(String(x.e.i)));
  const unlinked = feed.matches.filter((m) => !m.code && (m.status || 'sched') === 'sched').map((m) => ({ m, ko: m.kickoff }));
  pair(unlinked, unknownEv, (x) => ({ home: [x.m.home], away: [x.m.away] }), (x) => ({ home: [x.e.hn], away: [x.e.an] }))
    .forEach((p) => { unlinked[p.i].m.code = unknownEv[p.j].e.i; known.set(String(unknownEv[p.j].e.i), unlinked[p.i].m); });

  for (const x of evs) {
    let m = known.get(String(x.e.i));
    if (!m) {
      const r = ensureRound(x.ko);
      if (!r) { warn('Takvim dışında maç atlandı: ' + x.e.hn + ' - ' + x.e.an); continue; }
      m = { id: 'i' + x.e.i, round: r.id, home: x.e.hn, away: x.e.an, kickoff: x.ko, mbs: Number(x.e.mbc) || 1, status: 'sched', odds: {}, code: x.e.i };
      feed.matches.push(m);
      known.set(String(x.e.i), m);
      changes.push('Yeni maç: ' + m.home + ' - ' + m.away);
    }
    const r = roundById()[m.round];
    const opened = r && r.opensAt != null && r.opensAt <= NOW;
    const hadOdds = m.odds && m.odds.MS;
    if (!opened) {
      // Bülten açılmadan önce oranlar ve saat güncel tutulur
      if (JSON.stringify(m.odds || {}) !== JSON.stringify(x.odds)) { m.odds = x.odds; changes.push('Oran: ' + m.home + ' - ' + m.away); }
      if (m.kickoff !== x.ko) { m.kickoff = x.ko; changes.push('Saat: ' + m.home + ' - ' + m.away); }
      const mbs = Number(x.e.mbc) || 1;
      if (m.mbs !== mbs) m.mbs = mbs;
    } else if (!hadOdds && m.kickoff > NOW) {
      // Bülten açıldıktan sonra yalnız oranı olmayan maçlar doldurulur; mevcut oranlar sabit kalır
      m.odds = x.odds; m.mbs = Number(x.e.mbc) || 1;
      changes.push('Geç gelen oran: ' + m.home + ' - ' + m.away);
    }
  }
} catch (e) {
  warn('iddaa okunamadı: ' + e.message);
}

// 2) Bülten açılışı
const rmap = roundById();
const ordered = feed.rounds.slice().sort((a, b) => a.order - b.order);
ordered.forEach((r, idx) => {
  if (r.opensAt != null) return;
  const ms = roundMatches(r.id);
  if (!ms.length) return;
  const first = Math.min(...ms.map((m) => m.kickoff));
  if (NOW >= first) return;
  const prev = ordered.slice(0, idx).filter((x) => roundMatches(x.id).length).pop();
  if (prev) {
    const prevClose = Math.max(...roundMatches(prev.id).map((m) => m.kickoff));
    if (NOW < prevClose) return; // önceki hafta bitmeden yenisi açılmaz
  }
  const withOdds = ms.filter((m) => m.odds && m.odds.MS).length;
  if (withOdds === ms.length || (first - NOW < 36 * H && withOdds >= Math.ceil(ms.length * 0.75))) {
    r.opensAt = NOW;
    changes.push(r.name + ' bülteni açıldı (' + withOdds + '/' + ms.length + ' maç oranlı)');
  } else if (first - NOW < 30 * H) {
    warn(r.name + ': ilk maça ' + Math.round((first - NOW) / H) + ' saat var ama ' + ms.length + ' maçtan ' + withOdds + ' tanesinin oranı var. Gerekirse Yönetim\'den elle aç.');
  }
});

// 3) Sonuçlar (ESPN)
const due = feed.matches.filter((m) => (m.status || 'sched') === 'sched' && m.kickoff + 100 * 60e3 < NOW && m.kickoff > NOW - 10 * 24 * H);
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
const days = [...new Set(due.map((m) => dayKey(m.kickoff)))];
const espnEvents = [];
for (const d of days) {
  try {
    const j = await getJson('https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard?dates=' + d);
    (j && j.events || []).forEach((e) => {
      const c = (e.competitions || [])[0] || {};
      const home = (c.competitors || []).find((t) => t.homeAway === 'home');
      const away = (c.competitors || []).find((t) => t.homeAway === 'away');
      if (!home || !away) return;
      const nm = (t) => [t.team.displayName, t.team.shortDisplayName, t.team.name, t.team.abbreviation].filter(Boolean);
      espnEvents.push({ id: e.id, ko: Date.parse(e.date), home: nm(home), away: nm(away), st: (c.status || e.status || {}).type || {}, score: [Number(home.score), Number(away.score)] });
    });
  } catch (e) { warn('ESPN okunamadı (' + d + '): ' + e.message); }
}
const dueList = due.map((m) => ({ m, ko: m.kickoff }));
for (const p of pair(dueList, espnEvents, (x) => ({ home: [x.m.home], away: [x.m.away] }), (x) => ({ home: x.home, away: x.away }))) {
  const m = dueList[p.i].m, ev = espnEvents[p.j];
  m.espn = ev.id;
  const name = ev.st.name || '';
  if (/POSTPONED|CANCELED|CANCELLED|ABANDONED|SUSPENDED/.test(name)) {
    if (NOW > m.kickoff + 24 * H) {
      m.status = /CANCEL|ABANDON/.test(name) ? 'canc' : 'post';
      m.doneAt = NOW;
      changes.push('Ertelendi/iptal (1,00): ' + m.home + ' - ' + m.away);
    }
    continue;
  }
  if (!ev.st.completed) continue;
  try {
    const s = await getJson('https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/summary?event=' + ev.id);
    const comp = s && s.header && (s.header.competitions || [])[0];
    const ch = comp && comp.competitors.find((t) => t.homeAway === 'home');
    const ca = comp && comp.competitors.find((t) => t.homeAway === 'away');
    const ls = (t) => (t && t.linescores || []).map((x) => Number(x.displayValue != null ? x.displayValue : x.value));
    const lh = ls(ch), la = ls(ca);
    if (lh.length < 2 || la.length < 2 || [...lh, ...la].some((x) => !Number.isInteger(x) || x < 0)) {
      warn('Devre skoru bulunamadı: ' + m.home + ' - ' + m.away + ' (Yönetim\'den gir)');
      continue;
    }
    const ht = [lh[0], la[0]], ft = [lh[0] + lh[1], la[0] + la[1]];
    const regular = /FULL_TIME|STATUS_FINAL$/.test(name) && lh.length === 2 && la.length === 2;
    if (regular && (ft[0] !== ev.score[0] || ft[1] !== ev.score[1])) {
      warn('Skor tutarsız, işlenmedi: ' + m.home + ' - ' + m.away + ' (' + ft.join('-') + ' / ' + ev.score.join('-') + ')');
      continue;
    }
    if (!regular && !/AET|PEN|EXTRA|SHOOTOUT/.test(name) && !/FULL_TIME|FINAL/.test(name)) continue;
    m.ht = ht; m.ft = ft; m.status = 'ft'; m.doneAt = NOW;
    changes.push('Sonuç: ' + m.home + ' ' + ft[0] + '-' + ft[1] + ' ' + m.away + ' (İY ' + ht.join('-') + ')' + (regular ? '' : ' [uzatmasız]'));
  } catch (e) { warn('Sonuç okunamadı: ' + m.home + ' - ' + m.away + ': ' + e.message); }
}
due.filter((m) => m.status === 'sched' && NOW > m.kickoff + 6 * H)
  .forEach((m) => warn('Sonuç hâlâ yok: ' + m.home + ' - ' + m.away + '. Gerekirse Yönetim\'den gir.'));

// 4) Kaydet
if (JSON.stringify(feed) !== before) {
  feed.updatedAt = new Date(NOW).toISOString();
  writeFileSync(FEED, JSON.stringify(feed, null, 1) + '\n');
}
let prevStatus = {};
try { prevStatus = JSON.parse(readFileSync(STATUS, 'utf8')); } catch (e) {}
const status = { iddaa: iddaaOk, warnings, lastChange: changes.length ? new Date(NOW).toISOString() : (prevStatus.lastChange || null), lastChanges: changes.length ? changes : (prevStatus.lastChanges || []) };
if (JSON.stringify(status) !== JSON.stringify(prevStatus)) writeFileSync(STATUS, JSON.stringify(status, null, 1) + '\n');
console.log('Değişiklikler:', changes.length ? changes.join(' | ') : 'yok');
