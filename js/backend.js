// Firebase bağlantısı: hesaplar (Authentication) ve oyun verisi (Firestore)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, updatePassword, reauthenticateWithCredential, EmailAuthProvider
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, addDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { ADMIN_UNAME, emailOf, unameOf, toMs } from './common.js';

export function createBackend() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  const who = (u) => u ? { uid: u.uid, uname: unameOf(u.email), isAdmin: unameOf(u.email) === ADMIN_UNAME } : null;
  const docs = (snap) => snap.docs.map((d) => {
    const x = d.data({ serverTimestamps: 'estimate' }) || {};
    return Object.assign({}, x, { id: d.id });
  });

  return {
    kind: 'firebase',
    onAuth(cb) { return onAuthStateChanged(auth, (u) => cb(who(u))); },
    async signIn(uname, pw) { await signInWithEmailAndPassword(auth, emailOf(uname), pw); },
    async signUp(name, uname, pw) {
      const cred = await createUserWithEmailAndPassword(auth, emailOf(uname), pw);
      if (uname !== ADMIN_UNAME) {
        await setDoc(doc(db, 'players', cred.user.uid), { name, uname, joinedAt: serverTimestamp() });
      }
    },
    async join(name) {
      const u = auth.currentUser;
      await setDoc(doc(db, 'players', u.uid), { name, uname: unameOf(u.email), joinedAt: serverTimestamp() });
    },
    signOut() { return signOut(auth); },
    async changePassword(oldPw, newPw) {
      const u = auth.currentUser;
      await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, oldPw));
      await updatePassword(u, newPw);
    },

    // Canlı abonelikler; her biri değişince ilgili callback'i çağırır
    listen(isAdmin, h) {
      const subs = [];
      const sub = (name, ref, map) => subs.push(onSnapshot(ref, (s) => h.data(name, map(docs(s))), (e) => h.error(name, e)));
      sub('players', collection(db, 'players'), (a) => a.map((p) => Object.assign(p, { joinedAt: toMs(p.joinedAt) })));
      sub('coupons', collection(db, 'coupons'), (a) => a.map((c) => Object.assign(c, { at: toMs(c.at) })));
      sub('overrides', collection(db, 'overrides'), (a) => a);
      sub('adjust', collection(db, 'adjust'), (a) => a.map((x) => Object.assign(x, { at: toMs(x.at) })));
      if (isAdmin) sub('resets', collection(db, 'resets'), (a) => a.map((x) => Object.assign(x, { at: toMs(x.at) })));
      return () => subs.forEach((f) => f());
    },

    placeCoupon(c) {
      return setDoc(doc(collection(db, 'coupons')), {
        uid: auth.currentUser.uid, at: serverTimestamp(), round: c.round, stake: c.stake, sel: c.sel
      });
    },

    // Yönetici işlemleri (Firestore kuralları yalnız yöneticiye izin verir)
    setOverride(kind, id, d) { return setDoc(doc(db, 'overrides', kind + '_' + id), { k: kind, ref: id, d }); },
    updatePlayer(uid, patch) { return updateDoc(doc(db, 'players', uid), patch); },
    updateCoupon(id, patch) { return updateDoc(doc(db, 'coupons', id), patch); },
    addAdjust(a) { return addDoc(collection(db, 'adjust'), Object.assign({}, a, { at: serverTimestamp() })); },
    deleteAdjust(id) { return deleteDoc(doc(db, 'adjust', id)); },
    requestReset(uid, password) { return setDoc(doc(db, 'resets', uid), { password, at: serverTimestamp() }); },
    cancelReset(uid) { return deleteDoc(doc(db, 'resets', uid)); }
  };
}
