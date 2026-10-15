// Canlı Firebase'de güvenlik kurallarını dener; geçici test hesapları açar ve sonunda hepsini siler.
// Sonuç: data/rules-test.json
import { writeFileSync, readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const cfgSrc = readFileSync(new URL('../js/firebase-config.js', import.meta.url), 'utf8');
const API_KEY = /apiKey:\s*'([^']+)'/.exec(cfgSrc)[1];
const PROJECT = /projectId:\s*'([^']+)'/.exec(cfgSrc)[1];
const DOMAIN = /USER_DOMAIN = '([^']+)'/.exec(readFileSync(new URL('../js/common.js', import.meta.url), 'utf8'))[1];
const sa = JSON.parse(process.env.SA);
initializeApp({ credential: cert(sa), projectId: sa.project_id });
const adminAuth = getAuth();
const db = getFirestore();

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const results = [];
const created = { users: [], docs: [] };
const tag = 'ztest' + Date.now().toString(36);

async function signUp(local, pw) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${local}@${DOMAIN}`, password: pw, returnSecureToken: true })
  });
  const j = await r.json();
  if (!r.ok) throw new Error('signUp ' + local + ': ' + JSON.stringify(j.error && j.error.message));
  created.users.push(j.localId);
  return { uid: j.localId, token: j.idToken };
}
const v = (x) => {
  if (x === null) return { nullValue: null };
  if (typeof x === 'string') return { stringValue: x };
  if (typeof x === 'number') return Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
  if (typeof x === 'boolean') return { booleanValue: x };
  if (x instanceof Date) return { timestampValue: x.toISOString() };
  if (Array.isArray(x)) return { arrayValue: { values: x.map(v) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(x).map(([k, y]) => [k, v(y)])) } };
};
async function commit(token, path, fields, serverTimeFields, exists) {
  const write = { update: { name: `projects/${PROJECT}/databases/(default)/documents/${path}`, fields: Object.fromEntries(Object.entries(fields).map(([k, y]) => [k, v(y)])) } };
  if (serverTimeFields && serverTimeFields.length) write.updateTransforms = serverTimeFields.map((f) => ({ fieldPath: f, setToServerValue: 'REQUEST_TIME' }));
  if (exists !== undefined) write.currentDocument = { exists };
  const r = await fetch(`${BASE}:commit`, {
    method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: JSON.stringify({ writes: [write] })
  });
  return r.status;
}
async function read(token, path) {
  const r = await fetch(`${BASE}/${path}`, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  return r.status;
}
async function check(name, expectOk, fn) {
  let status;
  try { status = await fn(); } catch (e) { status = 'hata: ' + e.message; }
  const ok = typeof status === 'number' && (expectOk ? status === 200 : status === 403);
  results.push({ test: name, beklenen: expectOk ? 'izin' : 'red', status, sonuc: ok ? 'GEÇTİ' : 'KALDI' });
}

try {
  const a = await signUp(tag + 'a', 'test1234');
  const b = await signUp(tag + 'b', 'test1234');
  created.docs.push('players/' + a.uid, 'players/' + b.uid);

  await check('Giriş yapmamış biri oyuncuları okuyamaz', false, () => read(null, 'players'));
  await check('Oyuncu kendi kaydını açar', true, () => commit(a.token, 'players/' + a.uid, { name: 'Test A', uname: tag + 'a' }, ['joinedAt'], false));
  await check('Başkası adına oyuncu kaydı açılamaz', false, () => commit(a.token, 'players/' + b.uid, { name: 'Sahte', uname: tag + 'b' }, ['joinedAt'], false));
  await check('Başka kullanıcı adıyla kayıt açılamaz', false, () => commit(b.token, 'players/' + b.uid, { name: 'B', uname: 'baskasi' }, ['joinedAt'], false));
  await check('Oyuncu kendi kaydını değiştiremez (ad, kasa vb.)', false, () => commit(a.token, 'players/' + a.uid, { name: 'Hile', uname: tag + 'a' }, ['joinedAt'], true));
  await check('Oyuncular okunabilir', true, () => read(a.token, 'players/' + a.uid));
  const cid = tag + 'c1';
  created.docs.push('coupons/' + cid);
  const sel = [{ m: 'm74165940', mk: 'MS', k: '1', odd: 1.5 }];
  await check('Oyuncu kendi kuponunu sunucu saatiyle yapar', true, () => commit(a.token, 'coupons/' + cid, { uid: a.uid, round: 'r01', stake: 10, sel }, ['at'], false));
  await check('Kupon değiştirilemez', false, () => commit(a.token, 'coupons/' + cid, { uid: a.uid, round: 'r01', stake: 1000, sel }, ['at'], true));
  created.docs.push('coupons/' + tag + 'c2', 'coupons/' + tag + 'c3', 'coupons/' + tag + 'c4');
  await check('Başkası adına kupon yapılamaz', false, () => commit(a.token, 'coupons/' + tag + 'c2', { uid: b.uid, round: 'r01', stake: 10, sel }, ['at'], false));
  await check('Kupon saati elle (geçmişe) yazılamaz', false, () => commit(a.token, 'coupons/' + tag + 'c3', { uid: a.uid, round: 'r01', stake: 10, sel, at: new Date(Date.now() - 86400000) }, [], false));
  await check('Oyuncu kaydı olmayan kupon yapamaz', false, () => commit(b.token, 'coupons/' + tag + 'c4', { uid: b.uid, round: 'r01', stake: 10, sel }, ['at'], false));
  created.docs.push('overrides/m_' + tag, 'adjust/' + tag, 'resets/' + a.uid);
  await check('Oyuncu oran/sonuç değiştiremez', false, () => commit(a.token, 'overrides/m_' + tag, { k: 'm', ref: tag, d: { status: 'ft' } }, [], undefined));
  await check('Oyuncu kasa düzeltmesi ekleyemez', false, () => commit(a.token, 'adjust/' + tag, { player: a.uid, amount: 1000 }, ['at'], undefined));
  await check('Oyuncu şifre sıfırlama isteği yazamaz', false, () => commit(a.token, 'resets/' + a.uid, { password: 'x' }, ['at'], undefined));
  await check('Oyuncu şifre sıfırlama isteklerini okuyamaz', false, () => read(a.token, 'resets/' + a.uid));
} catch (e) {
  results.push({ test: 'kurulum', sonuc: 'KALDI', hata: e.message });
}

// temizlik
for (const p of created.docs) { try { await db.doc(p).delete(); } catch (e) {} }
for (const u of created.users) { try { await adminAuth.deleteUser(u); } catch (e) {} }

const out = { at: new Date().toISOString(), gecti: results.filter((r) => r.sonuc === 'GEÇTİ').length, toplam: results.length, results };
writeFileSync(new URL('../data/rules-test.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out, null, 1));
