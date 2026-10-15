// Kullanıcı adı kuralları ve ortak yardımcılar
export const USER_DOMAIN = 'oyuncu.devlerligi.example.com';
export const ADMIN_UNAME = 'yonetici';
export const RESERVED = ['yonetici', 'admin', 'administrator', 'root', 'sistem'];

const TR = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'i̇': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u' };

// "Şükrü.K" -> "sukru.k"; geçersizse null
export function normUser(raw) {
  let s = String(raw || '').trim().toLocaleLowerCase('tr-TR');
  s = s.replace(/i̇|[çğıöşüâîû]/g, (ch) => TR[ch] || ch);
  if (!/^[a-z0-9][a-z0-9._-]{2,19}$/.test(s)) return null;
  if (/[._-]$/.test(s) || /[._-]{2}/.test(s)) return null;
  return s;
}
export function cleanName(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 20);
}
export const emailOf = (uname) => uname + '@' + USER_DOMAIN;
export const unameOf = (email) => String(email || '').split('@')[0];
export function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  return null;
}

const AUTH_ERR = {
  'auth/invalid-credential': 'Kullanıcı adı ya da şifre yanlış.',
  'auth/invalid-login-credentials': 'Kullanıcı adı ya da şifre yanlış.',
  'auth/wrong-password': 'Kullanıcı adı ya da şifre yanlış.',
  'auth/user-not-found': 'Kullanıcı adı ya da şifre yanlış.',
  'auth/invalid-email': 'Kullanıcı adı geçersiz.',
  'auth/email-already-in-use': 'Bu kullanıcı adı alınmış, başka bir ad seç.',
  'auth/weak-password': 'Şifre en az 6 karakter olmalı.',
  'auth/too-many-requests': 'Çok fazla deneme yapıldı. Birkaç dakika bekleyip tekrar dene.',
  'auth/network-request-failed': 'İnternet bağlantısı yok gibi görünüyor.',
  'auth/operation-not-allowed': 'Firebase\'de Email/Password girişi açık değil.',
  'auth/user-disabled': 'Bu hesap kapatılmış. Yöneticiyle konuş.',
  'auth/requires-recent-login': 'Güvenlik için çıkış yapıp tekrar gir, sonra şifreni değiştir.',
  'permission-denied': 'Bu işlem için iznin yok.',
  'unavailable': 'Sunucuya ulaşılamıyor, bağlantını kontrol et.'
};
export function errText(e, fallback) {
  const code = e && (e.code || '');
  return AUTH_ERR[code] || fallback || ('Bir hata oldu' + (code ? ' (' + code + ')' : '') + '.');
}
