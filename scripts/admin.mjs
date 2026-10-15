// GitHub Actions'ta çalışır: Firestore kurallarını yayınlar ve şifre sıfırlama isteklerini uygular.
// Gerekli gizli değer: FIREBASE_SERVICE_ACCOUNT (Firebase konsolundan indirilen hizmet hesabı JSON'u)
// Sonucu data/admin-status.json dosyasına yazar (gizli bilgi içermez).
import { readFileSync, writeFileSync } from 'node:fs';

const STATUS = new URL('../data/admin-status.json', import.meta.url);
let status = {};
try { status = JSON.parse(readFileSync(STATUS, 'utf8')); } catch (e) { status = {}; }
const now = new Date().toISOString();
const save = () => writeFileSync(STATUS, JSON.stringify(status, null, 1) + '\n');
let failed = false;

function fail(part, e) {
  failed = true;
  const msg = String((e && (e.errorInfo && e.errorInfo.message)) || (e && e.message) || e).slice(0, 600);
  console.error(part + ':', msg);
  return msg;
}

let sa = null;
try {
  sa = JSON.parse(process.env.SA || 'null');
  if (!sa || !sa.project_id || !sa.private_key || !sa.client_email) throw new Error('JSON içinde project_id / private_key / client_email yok.');
} catch (e) {
  status.serviceAccount = { ok: false, at: now, error: fail('Hizmet hesabı', e) };
  save();
  process.exit(0);
}
status.serviceAccount = { ok: true, project: sa.project_id, email: sa.client_email };

const { initializeApp, cert } = await import('firebase-admin/app');
const { getAuth } = await import('firebase-admin/auth');
const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
const { getSecurityRules } = await import('firebase-admin/security-rules');
initializeApp({ credential: cert(sa), projectId: sa.project_id });

if (process.env.DEPLOY_RULES === 'true') {
  try {
    const src = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
    const rs = await getSecurityRules().releaseFirestoreRulesetFromSource(src);
    status.rules = { ok: true, at: now, ruleset: rs.name };
    console.log('Firestore kuralları yayınlandı:', rs.name);
  } catch (e) {
    status.rules = { ok: false, at: now, error: fail('Kurallar yayınlanamadı', e) };
  }
}

try {
  const auth = getAuth();
  const db = getFirestore();
  const snap = await db.collection('resets').get();
  let done = 0;
  for (const d of snap.docs) {
    const { password } = d.data() || {};
    try {
      if (typeof password !== 'string' || password.length < 6) throw new Error('Şifre en az 6 karakter olmalı.');
      await auth.updateUser(d.id, { password });
      await d.ref.delete();
      done++;
      console.log('Şifre sıfırlandı:', d.id);
    } catch (e) {
      const msg = fail('Sıfırlanamadı ' + d.id, e);
      await d.ref.update({ error: msg, password: FieldValue.delete() });
    }
  }
  if (done || (status.resets && !status.resets.ok)) status.resets = { ok: true, at: now, done };
  if (!snap.size) console.log('Bekleyen şifre sıfırlama yok.');
} catch (e) {
  status.resets = { ok: false, at: now, error: fail('Şifre sıfırlama kontrolü', e) };
}

save();
// Hata olsa da iş akışı başarılı biter; sorunlar admin-status.json'da ve yönetim panelinde görünür.
if (failed) console.log('Bazı adımlar başarısız oldu; ayrıntılar data/admin-status.json içinde.');
