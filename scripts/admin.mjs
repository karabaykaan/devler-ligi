// GitHub Actions'ta çalışır: Firestore kurallarını yayınlar ve şifre sıfırlama isteklerini uygular.
// Gerekli gizli değer: FIREBASE_SERVICE_ACCOUNT (Firebase konsolundan indirilen hizmet hesabı JSON'u)
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getSecurityRules } from 'firebase-admin/security-rules';

const sa = JSON.parse(process.env.SA || '{}');
if (!sa.project_id) {
  console.log('FIREBASE_SERVICE_ACCOUNT tanımlı değil; atlanıyor.');
  process.exit(0);
}
initializeApp({ credential: cert(sa), projectId: sa.project_id });

let failed = false;

if (process.env.DEPLOY_RULES === 'true') {
  try {
    const src = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
    await getSecurityRules().releaseFirestoreRulesetFromSource(src);
    console.log('Firestore kuralları yayınlandı.');
  } catch (e) {
    failed = true;
    console.error('Kurallar yayınlanamadı:', e.message);
  }
}

const auth = getAuth();
const db = getFirestore();
const snap = await db.collection('resets').get();
for (const d of snap.docs) {
  const { password } = d.data() || {};
  try {
    if (typeof password !== 'string' || password.length < 6) throw new Error('Şifre en az 6 karakter olmalı.');
    await auth.updateUser(d.id, { password });
    await d.ref.delete();
    console.log('Şifre sıfırlandı:', d.id);
  } catch (e) {
    console.error('Sıfırlanamadı:', d.id, e.message);
    await d.ref.update({ error: e.message, password: FieldValue.delete() });
  }
}
if (!snap.size) console.log('Bekleyen şifre sıfırlama yok.');
if (failed) process.exit(1);
