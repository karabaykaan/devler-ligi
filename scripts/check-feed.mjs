// data/feed.json doğrulayıcı: node scripts/check-feed.mjs
// Sorun yoksa "feed OK" yazar ve 0 ile çıkar; varsa her sorunu yazar ve 1 ile çıkar.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const L = require('../js/logic.js');
const file = new URL('../data/feed.json', import.meta.url);
const errs = [];
let f;
try { f = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error('JSON okunamadı:', e.message); process.exit(1); }

const isNum = (x) => typeof x === 'number' && isFinite(x);
if (!Array.isArray(f.rounds)) errs.push('rounds dizi değil');
if (!Array.isArray(f.matches)) errs.push('matches dizi değil');
const rids = new Set(), mids = new Set();
(f.rounds || []).forEach((r, i) => {
  if (!r.id || rids.has(r.id)) errs.push('round #' + i + ' id eksik ya da tekrar: ' + r.id);
  rids.add(r.id);
  if (!r.name) errs.push(r.id + ': name eksik');
  if (!isNum(r.order)) errs.push(r.id + ': order sayı değil');
  if (r.opensAt !== null && r.opensAt !== undefined && !isNum(r.opensAt)) errs.push(r.id + ': opensAt sayı ya da null olmalı');
});
(f.matches || []).forEach((m, i) => {
  const t = m.id || ('#' + i);
  if (!m.id || mids.has(m.id)) errs.push('match ' + t + ' id eksik ya da tekrar');
  mids.add(m.id);
  if (!rids.has(m.round)) errs.push(t + ': round yok: ' + m.round);
  if (!m.home || !m.away) errs.push(t + ': takım adı eksik');
  if (!isNum(m.kickoff) || m.kickoff < 1.7e12 || m.kickoff > 1.9e12) errs.push(t + ': kickoff epoch ms değil');
  if (!['sched', 'ft', 'post', 'canc'].includes(m.status || 'sched')) errs.push(t + ': status geçersiz');
  if (m.status === 'ft' && !(Array.isArray(m.ft) && m.ft.length === 2 && m.ft.every((x) => Number.isInteger(x) && x >= 0))) errs.push(t + ': ft skoru eksik');
  if (m.ht != null && !(Array.isArray(m.ht) && m.ht.length === 2 && m.ht.every((x) => Number.isInteger(x) && x >= 0))) errs.push(t + ': ht geçersiz');
  if (Array.isArray(m.ht) && Array.isArray(m.ft) && (m.ht[0] > m.ft[0] || m.ht[1] > m.ft[1])) errs.push(t + ': ilk yarı skoru maç sonundan büyük');
  const odds = m.odds || {};
  Object.keys(odds).forEach((mk) => {
    const def = L.MK[mk];
    if (!def) { errs.push(t + ': bilinmeyen bahis türü ' + mk); return; }
    def.outs.forEach(([k]) => {
      if (odds[mk][k] !== undefined && !(isNum(odds[mk][k]) && odds[mk][k] > 1)) errs.push(t + ': ' + mk + '.' + k + ' oranı geçersiz');
    });
    Object.keys(odds[mk]).forEach((k) => { if (k !== 'h' && !def.outs.some(([o]) => o === k)) errs.push(t + ': ' + mk + ' içinde bilinmeyen seçenek ' + k); });
    if (mk === 'HND' && !/^\d+:\d+$/.test(String(odds[mk].h || ''))) errs.push(t + ': HND.h "0:1" biçiminde olmalı');
  });
  if (m.odds && Object.keys(m.odds).length && !m.odds.MS) errs.push(t + ': MS oranı olmadan başka oran var');
});
if (errs.length) { errs.forEach((e) => console.error('- ' + e)); process.exit(1); }
console.log('feed OK: ' + f.rounds.length + ' hafta, ' + f.matches.length + ' maç, oranlı ' + f.matches.filter((m) => m.odds && m.odds.MS).length);
