import { createBackend } from './backend.js';
import { ADMIN_UNAME, RESERVED, normUser, cleanName, errText } from './common.js';

const L = window.L;
const num = L.num, r2 = L.r2;
const FEED_URL = 'data/feed.json';
const FEED_EVERY = 120000;

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* özel pencere */ } }
};
const ICON = {
  bulten: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  kuponlar: '<svg viewBox="0 0 24 24"><path d="M5 4h14v16l-2.3-1.5L14.3 20 12 18.5 9.7 20l-2.4-1.5L5 20z"/><path d="M9 9h6M9 13h4"/></svg>',
  siralama: '<svg viewBox="0 0 24 24"><path d="M9 20V10h6v10M3 20v-6h6M15 20v-8h6v8M2 20h20"/></svg>',
  kurallar: '<svg viewBox="0 0 24 24"><path d="M5 4h10l4 4v12H5z"/><path d="M9 12h6M9 16h6M9 8h3"/></svg>',
  yonetim: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>'
};
const TABS = [
  { id: 'bulten', label: 'Bülten' },
  { id: 'kuponlar', label: 'Kuponlar' },
  { id: 'siralama', label: 'Sıralama' },
  { id: 'kurallar', label: 'Kurallar' },
  { id: 'yonetim', label: 'Yönetim', admin: true }
];
const VIEWS = TABS.map((t) => t.id).concat(['hesap']);

const S = {
  be: null, user: null, authReady: false, unsub: null,
  loaded: {}, players: [], coupons: [], overrides: [], adjust: [], resets: [],
  feed: null, feedAt: 0, feedErr: false,
  tab: 'bulten', amode: 'in', setup: false,
  slip: [], stake: '', sheet: false, confirm: false, busy: false,
  cmode: 'me', vround: null, more: {}, prow: {}, aRound: null, aMatch: null, aPlayer: null,
  draft: {}, dirty: false, ask: null
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const money = (x) => Number(x || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const odd = (x) => Number(x || 0).toFixed(2);
const hm = (ms) => new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
const dayName = (ms) => new Date(ms).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
const dt = (ms) => new Date(ms).toLocaleString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
function left(ms) {
  const d = ms - Date.now();
  if (d <= 0) return 'şimdi';
  const m = Math.floor(d / 60000), h = Math.floor(m / 60), g = Math.floor(h / 24);
  if (g > 0) return g + 'g ' + (h % 24) + 'sa';
  if (h > 0) return h + 'sa ' + (m % 60) + 'dk';
  return (m || 1) + 'dk';
}
const parseAmt = (s) => { const n = Number(String(s || '').replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : NaN; };
function toast(msg, err) {
  const t = $('toast');
  t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, err ? 6500 : 3200);
}
const isAdmin = () => !!(S.user && S.user.isAdmin);

/* ---------- veri birleştirme ve hesap ---------- */
function overridesObj() {
  const o = { rounds: {}, matches: {} };
  S.overrides.forEach((x) => {
    if (x.k === 'r' && x.ref) o.rounds[x.ref] = x.d || {};
    else if (x.k === 'm' && x.ref) o.matches[x.ref] = x.d || {};
  });
  return o;
}
function overrideOf(kind, id) {
  const x = S.overrides.find((o) => o.k === kind && o.ref === id);
  return x ? Object.assign({}, x.d || {}) : {};
}
function compute() {
  const merged = L.mergeData(S.feed || {}, overridesObj());
  S.ctx = L.prepare({ cfg: merged.cfg, rounds: merged.rounds, matches: merged.matches, adjust: S.adjust, coupons: S.coupons }, Date.now());
  S.rows = L.standings(S.players, S.ctx);
  S.mePlayer = S.user ? S.players.find((p) => p.id === S.user.uid) || null : null;
  S.me = S.user ? S.rows.find((r) => r.id === S.user.uid) || null : null;
  S.active = S.ctx.rounds.find((r) => r._state === 'open') || null;
  S.over = L.finished(S.rows, S.ctx);
}
const playerById = (id) => S.players.find((p) => p.id === id);
const nameOf = (id) => { const p = playerById(id); return (p && (p.name || p.uname)) || 'Oyuncu'; };
function initials(id) {
  const n = nameOf(id).trim();
  return n.slice(0, 1).toLocaleUpperCase('tr-TR');
}
function hue(id) { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360; return h; }
const av = (id, big) => '<span class="av' + (big ? ' big' : '') + '" style="--h:' + hue(id) + '" aria-hidden="true">' + esc(initials(id)) + '</span>';
function bettable(m) {
  if (isAdmin() || !S.me) return false;
  if (!S.active || m.round !== S.active.id) return false;
  if (m.status && m.status !== 'sched') return false;
  if (!m.odds || !m.odds.MS) return false;
  return num(m.kickoff, 0) > Date.now();
}

/* ---------- çizim ---------- */
function render(force) {
  const ae = document.activeElement;
  if (!force && ae && $('view').contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) { S.dirty = true; compute(); renderChrome(); return; }
  S.dirty = false;
  compute();
  renderChrome();
  let html;
  if (!S.authReady) html = '<div class="empty"><b>Yükleniyor</b>Bağlantı kuruluyor.</div>';
  else if (!S.user) html = authView();
  else if (!['players', 'coupons', 'overrides', 'adjust'].every((k) => S.loaded[k]) || !S.feedAt) html = '<div class="empty"><b>Yükleniyor</b>Bülten ve kasalar getiriliyor.</div>';
  else if (S.tab === 'hesap') html = accountView();
  else if (S.tab === 'kuponlar') html = couponsView();
  else if (S.tab === 'siralama') html = standingsView();
  else if (S.tab === 'kurallar') html = rulesView();
  else if (S.tab === 'yonetim' && isAdmin()) html = adminView();
  else html = bultenView();
  $('view').innerHTML = html;
  Object.keys(S.draft).forEach((id) => { const el = $(id); if (el && el.type !== 'password') el.value = S.draft[id]; });
  renderSheet();
}

function renderChrome() {
  const ready = !!S.user && S.feedAt && S.loaded.players;
  const kasa = $('hdr-kasa');
  if (!S.user) { kasa.innerHTML = ''; kasa.parentElement.hidden = true; }
  else if (isAdmin()) { kasa.parentElement.hidden = false; $('hdr-klbl').textContent = 'Oyuncu'; kasa.textContent = ready ? String(S.rows.length) : '—'; }
  else { kasa.parentElement.hidden = false; $('hdr-klbl').textContent = 'Kasa'; kasa.textContent = S.me ? money(S.me.lg.bal) : '—'; }
  const who = $('hdr-who');
  if (S.user) {
    who.hidden = false;
    who.innerHTML = (isAdmin() ? '<span class="tag">Yönetici</span>' : '@' + esc(S.user.uname)) + ' · Hesap';
  } else who.hidden = true;
  const hw = $('hdr-week'), ae = document.activeElement;
  if (!(ae && hw.contains(ae) && ae.tagName === 'INPUT')) hw.innerHTML = ready ? weekStrip() : '';
  const tabs = TABS.filter((t) => !t.admin || isAdmin());
  if (S.tab !== 'hesap' && !tabs.some((t) => t.id === S.tab)) S.tab = 'bulten';
  $('tabs-nav').hidden = !S.user;
  $('tabs').innerHTML = tabs.map((t) => '<button class="tab" data-act="tab" data-v="' + t.id + '"' + (S.tab === t.id ? ' aria-current="page"' : '') + '>' + ICON[t.id] + '<span>' + t.label + '</span></button>').join('');
  const n = S.slip.length;
  $('slipbar').hidden = !n || S.sheet || !S.me;
  if (n) {
    const tot = r2(S.slip.reduce((p, s) => p * s.odd, 1));
    $('slipbtn').innerHTML = '<span class="sb-count">' + n + '</span><span class="sb-txt">Kupon · Oran <b>' + odd(tot) + '</b></span><span class="sb-cta">Kuponu aç ▲</span>';
  }
}

function weekStrip() {
  const a = S.active;
  if (isAdmin()) {
    if (!a) {
      const next = S.ctx.rounds.find((r) => r._state === 'soon');
      return '<div class="wk"><div class="wk-top"><span class="wk-name">' + (next ? esc(next.name) + ' · bülten bekleniyor' : 'Açık hafta yok') + '</span></div><div class="wk-nums">Oranlar her sabah kontrol edilir. Gerekirse Yönetim sekmesinden bülteni elle açabilirsin.</div></div>';
    }
    let done = 0, tot = 0;
    S.rows.forEach((row) => { const ri = row.lg.rinfo[a.id]; if (!ri) return; tot++; if (ri.staked >= ri.req - 1e-9) done++; });
    const pct = tot ? Math.round(done / tot * 100) : 0;
    return '<div class="wk"><div class="wk-top"><span class="wk-name">' + esc(a.name) + ' açık</span><span class="wk-close">Son kupon: ' + esc(dt(a._close)) + ' · ' + esc(left(a._close)) + '</span></div>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div><div class="wk-nums"><span>Zorunluyu tamamlayan <b>' + done + ' / ' + tot + '</b></span></div></div>';
  }
  if (S.mePlayer && S.mePlayer.removed) return '<div class="wk"><div class="wk-top"><span class="wk-name">Hesabın oyundan çıkarıldı</span></div><div class="wk-nums">Bir yanlışlık varsa yöneticiyle konuş.</div></div>';
  if (!S.mePlayer) {
    return '<div class="wk"><div class="wk-top"><span class="wk-name">Oyuncu kaydın tamamlanmadı</span></div><div class="join-row"><button class="btn-flood" data-act="join">Oyuna katıl · ' + esc(money(S.ctx.cfg.start)) + ' ile başla</button></div></div>';
  }
  if (!a) {
    const next = S.ctx.rounds.find((r) => r._state === 'soon');
    return '<div class="wk"><div class="wk-top"><span class="wk-name">' + (next ? esc(next.name) + ' · bülten bekleniyor' : 'Açık hafta yok') + '</span></div>' +
      '<div class="wk-nums">Bülten açılınca kasana +' + esc(money(S.ctx.cfg.bonus)) + ' eklenir ve kasanın yarısını oynaman gerekir.</div></div>';
  }
  const ri = S.me && S.me.lg.rinfo[a.id];
  if (!ri) return '';
  const pct = ri.req > 0 ? Math.min(100, Math.round(ri.staked / ri.req * 100)) : 100;
  const rem = Math.max(0, r2(ri.req - ri.staked));
  return '<div class="wk"><div class="wk-top"><span class="wk-name">' + esc(a.name) + ' açık</span><span class="wk-close">Son kupon: ' + esc(dt(a._close)) + ' · ' + esc(left(a._close)) + '</span></div>' +
    '<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><i style="width:' + pct + '%"></i></div>' +
    '<div class="wk-nums"><span>Oynanan <b>' + money(ri.staked) + '</b></span><span>Zorunlu <b>' + money(ri.req) + '</b></span>' +
    (rem > 0 ? '<span class="wk-warn">Kalan <b>' + money(rem) + '</b></span>' : '<span class="wk-ok">Zorunlu miktar tamam</span>') + '</div></div>';
}

/* Giriş / kayıt */
function authView() {
  const up = S.amode === 'up';
  return '<section class="auth">' +
    '<div class="auth-pitch"><h1>Şampiyonlar Ligi kupon oyunu</h1><p>100 ile başla, her maç haftası +50 al ve kasanın yarısını oyna. Finalden sonra kasası en dolu olan kazanır.</p></div>' +
    '<div class="card auth-card">' +
    '<div class="seg" role="group" aria-label="Giriş türü"><button data-act="amode" data-v="in" aria-pressed="' + !up + '">Giriş yap</button><button data-act="amode" data-v="up" aria-pressed="' + up + '">Kayıt ol</button></div>' +
    (S.setup && up ? '<p class="note">Kurulum: yönetici hesabını oluşturmak için kullanıcı adına <b>' + ADMIN_UNAME + '</b> yaz.</p>' : '') +
    '<form id="authform" class="auth-form" novalidate>' +
    '<label class="fld">Kullanıcı adı<input id="a-user" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="20" required></label>' +
    '<label class="fld">Şifre<input id="a-pass" name="password" type="password" autocomplete="' + (up ? 'new-password' : 'current-password') + '" required></label>' +
    (up ? '<label class="fld">Şifre (tekrar)<input id="a-pass2" type="password" autocomplete="new-password" required></label>' : '') +
    '<div class="form-msg" id="authmsg" role="alert"></div>' +
    '<button class="btn wide" type="submit" id="authbtn">' + (up ? 'Hesap oluştur' : 'Giriş yap') + '</button>' +
    '</form>' +
    '<p class="small muted">' + (up
      ? 'Kullanıcı adı 3-20 karakter olur: harf, rakam, nokta, tire ya da alt çizgi. Sıralamada bu ad görünür. E-posta gerekmez. Şifre en az 6 karakter olur.'
      : 'Bu cihazda bir kez giriş yapman yeter, tarayıcı seni hatırlar. Şifreni unutursan yöneticiye söyle, o sıfırlar.') + '</p>' +
    '</div></section>';
}
async function submitAuth() {
  if (S.busy) return;
  const up = S.amode === 'up';
  const msg = $('authmsg');
  const raw = $('a-user').value, pw = $('a-pass').value;
  const uname = normUser(raw);
  msg.textContent = '';
  if (!uname) { msg.textContent = 'Kullanıcı adı 3-20 karakter olmalı ve sadece harf, rakam, nokta, tire, alt çizgi içermeli.'; return; }
  if (pw.length < 6) { msg.textContent = 'Şifre en az 6 karakter olmalı.'; return; }
  if (up) {
    if (pw !== $('a-pass2').value) { msg.textContent = 'Şifreler aynı değil.'; return; }
    if (RESERVED.indexOf(uname) >= 0 && !(S.setup && uname === ADMIN_UNAME)) { msg.textContent = 'Bu kullanıcı adı kullanılamaz.'; return; }
  }
  S.busy = true;
  const btn = $('authbtn'); btn.disabled = true; btn.textContent = up ? 'Hesap oluşturuluyor…' : 'Giriş yapılıyor…';
  try {
    if (up) {
      const shown = uname === ADMIN_UNAME ? ADMIN_UNAME : cleanName(raw);
      await S.be.signUp(shown, uname, pw);
      if (S.setup) { S.setup = false; try { history.replaceState(null, '', location.pathname); } catch (e) {} }
      toast(uname === ADMIN_UNAME ? 'Yönetici hesabı hazır.' : 'Hoş geldin ' + shown + '!');
    } else {
      await S.be.signIn(uname, pw);
    }
  } catch (e) {
    msg.textContent = errText(e, up ? 'Hesap oluşturulamadı.' : 'Giriş yapılamadı.');
    btn.disabled = false; btn.textContent = up ? 'Hesap oluştur' : 'Giriş yap';
  } finally { S.busy = false; }
}

/* Hesap */
function accountView() {
  const p = S.mePlayer;
  return '<div class="sec-h"><h2>Hesabın</h2></div>' +
    '<div class="card acc"><div class="acc-who">' + (isAdmin() ? '<span class="tag">Yönetici</span>' : (p ? av(p.id, true) : '')) + '<div><b>' + esc(isAdmin() ? 'Yönetici' : (p ? p.name : S.user.uname)) + '</b><div class="small muted">Kullanıcı adı: ' + esc(S.user.uname) + '</div></div></div></div>' +
    '<div class="card"><h3 class="h3">Şifreni değiştir</h3><form id="pwform" class="auth-form" novalidate>' +
    '<input type="text" name="username" autocomplete="username" value="' + esc(S.user.uname) + '" hidden>' +
    '<label class="fld">Şu anki şifre<input id="p-old" type="password" autocomplete="current-password"></label>' +
    '<label class="fld">Yeni şifre<input id="p-new" type="password" autocomplete="new-password"></label>' +
    '<label class="fld">Yeni şifre (tekrar)<input id="p-new2" type="password" autocomplete="new-password"></label>' +
    '<div class="form-msg" id="pwmsg" role="alert"></div><button class="btn" type="submit" id="pwbtn">Şifreyi değiştir</button></form></div>' +
    '<div class="card"><h3 class="h3">Bu cihazdan çık</h3><p class="small muted" style="margin:6px 0 10px">Çıkınca tekrar girmek için kullanıcı adın ve şifren gerekir.</p>' +
    (S.ask === 'logout' ? '<div class="confirm-row"><button class="btn danger" data-act="logout-yes">Evet, çıkış yap</button><button class="btn ghost" data-act="ask-no">Vazgeç</button></div>' : '<button class="btn ghost" data-act="logout">Çıkış yap</button>') + '</div>';
}
async function submitPw() {
  const msg = $('pwmsg'), o = $('p-old').value, n = $('p-new').value, n2 = $('p-new2').value;
  msg.textContent = ''; msg.classList.remove('ok');
  if (n.length < 6) { msg.textContent = 'Yeni şifre en az 6 karakter olmalı.'; return; }
  if (n !== n2) { msg.textContent = 'Yeni şifreler aynı değil.'; return; }
  const btn = $('pwbtn'); btn.disabled = true;
  try {
    await S.be.changePassword(o, n);
    ['p-old', 'p-new', 'p-new2'].forEach((id) => { $(id).value = ''; });
    msg.textContent = 'Şifren değişti.'; msg.classList.add('ok');
  } catch (e) { msg.textContent = errText(e, 'Şifre değiştirilemedi.'); }
  btn.disabled = false;
}

/* Bülten */
function pickRound() {
  const rs = S.ctx.rounds;
  if (S.vround && S.ctx.roundMap[S.vround]) return S.ctx.roundMap[S.vround];
  if (S.active) return S.active;
  return rs.find((r) => r._state === 'soon') || rs[rs.length - 1] || null;
}
const STATE_TXT = { open: 'Açık', soon: 'Yakında', closed: 'Sonuç bekleniyor', done: 'Tamamlandı' };
function bultenView() {
  const rs = S.ctx.rounds;
  if (S.feedErr && !S.feed) return '<div class="empty"><b>Bülten dosyası okunamadı</b>Sayfayı yenile. Sorun sürerse yöneticiye haber ver.</div>';
  if (!rs.length) return '<div class="empty"><b>Bülten henüz yüklenmedi</b>İlk maç haftasının oranları yayınlanınca burada görünecek.</div>';
  const r = pickRound();
  let h = '<div class="rounds" role="group" aria-label="Haftalar">' + rs.map((x) => '<button class="rchip" data-act="vround" data-v="' + esc(x.id) + '" aria-pressed="' + (x.id === r.id) + '">' + (x._state === 'open' ? '<span class="dot"></span>' : '') + esc(x.name) + '</button>').join('') + '</div>';
  h += '<div class="sec-h"><h2>' + esc(r.name) + '</h2><span class="pill ' + r._state + '">' + STATE_TXT[r._state] + '</span></div>';
  const sub = [];
  if (r.stage) sub.push(esc(r.stage));
  if (r._state === 'soon') sub.push('Oranlar iddaa programına eklenince bülten açılır');
  if (r._state === 'open' && r._close) sub.push('Son kupon ' + esc(dt(r._close)));
  if (isAdmin() && r._state === 'open') sub.push('Yönetici olarak kupon yapamazsın');
  if (sub.length) h += '<p class="muted small" style="margin:-8px 0 0">' + sub.join(' · ') + '</p>';
  const ms = r._matches;
  if (!ms.length) return h + '<div class="empty"><b>Bu haftanın maçları yüklenmedi</b>Maçlar ve oranlar eklendiğinde burada listelenir.</div>';
  let lastDay = '';
  ms.forEach((m) => {
    const d = dayName(num(m.kickoff, 0));
    if (d !== lastDay) { h += '<div class="day">' + esc(d) + '</div>'; lastDay = d; }
    h += matchCard(m);
  });
  return h;
}
const inSlip = (mid, mk, k) => S.slip.some((s) => s.m === mid && s.mk === mk && s.k === k);
function oddBtn(m, mk, k, label, can, hit) {
  const o = m.odds && m.odds[mk];
  const v = o ? num(o[k], null) : null;
  if (v === null) return '<button class="odd" disabled><span class="o-k">' + esc(label) + '</span><span class="o-v">—</span></button>';
  const on = inSlip(m.id, mk, k);
  return '<button class="odd' + (on ? ' on' : '') + (hit ? ' hit' : '') + '" data-act="pick" data-m="' + esc(m.id) + '" data-mk="' + mk + '" data-k="' + esc(k) + '"' + (can ? '' : ' disabled') + ' aria-pressed="' + on + '"><span class="o-k">' + esc(label) + '</span><span class="o-v">' + odd(v) + '</span></button>';
}
function matchCard(m) {
  const can = bettable(m), st = m.status || 'sched', ko = num(m.kickoff, 0);
  let meta = '<span class="m-time">' + esc(hm(ko)) + '</span><span class="chip">MBS ' + esc(num(m.mbs, 1)) + '</span>';
  if (st === 'ft') meta += '<span class="pill done">Bitti</span>';
  else if (st === 'post') meta += '<span class="pill void">Ertelendi · 1,00</span>';
  else if (st === 'canc') meta += '<span class="pill void">İptal · 1,00</span>';
  else if (ko <= Date.now()) meta += '<span class="chip live">Başladı</span>';
  const ft = st === 'ft' && Array.isArray(m.ft);
  const teams = '<div class="m-teams"><div><span>' + esc(m.home) + '</span>' + (ft ? '<span class="sc">' + esc(m.ft[0]) + '</span>' : '') + '</div><div><span>' + esc(m.away) + '</span>' + (ft ? '<span class="sc">' + esc(m.ft[1]) + '</span>' : '') + '</div>' +
    (ft && Array.isArray(m.ht) ? '<span class="m-ht">İlk yarı ' + esc(m.ht[0]) + '-' + esc(m.ht[1]) + '</span>' : '') + '</div>';
  let h = '<article class="match" id="m-' + esc(m.id) + '"><div class="m-meta">' + meta + '</div>' + teams;
  if (!m.odds || !m.odds.MS) return h + '<div class="nodds">Oranlar henüz yayınlanmadı.</div></article>';
  const hitMS = ft ? L.res(num(m.ft[0], 0), num(m.ft[1], 0)) : null;
  h += '<div class="odds">' + L.MK.MS.outs.map((o) => oddBtn(m, 'MS', o[0], o[1], can, hitMS === o[0])).join('') + '</div>';
  const extra = L.MARKETS.filter((mk) => mk.k !== 'MS' && m.odds[mk.k]);
  if (extra.length) {
    const openM = !!S.more[m.id];
    const cnt = extra.reduce((s, mk) => s + mk.outs.filter((o) => num(m.odds[mk.k][o[0]], null) !== null).length, 0);
    h += '<button class="m-more" data-act="more" data-v="' + esc(m.id) + '" aria-expanded="' + openM + '">' + (openM ? 'Diğer bahisleri gizle' : '+' + cnt + ' bahis daha') + '</button>';
    if (openM) {
      h += '<div class="m-markets">' + extra.map((mk) => {
        const cls = mk.outs.length === 2 ? ' c2' : (mk.outs.length === 4 ? ' c4' : '');
        const nm = mk.k === 'HND' ? mk.name + ' (' + esc(m.odds.HND.h) + ')' : mk.name;
        return '<div class="mk-group"><div class="mk-name">' + nm + '</div><div class="odds' + cls + '">' + mk.outs.map((o) => oddBtn(m, mk.k, o[0], o[1], can, false)).join('') + '</div></div>';
      }).join('') + '</div>';
    }
  }
  return h + '</article>';
}

/* Kupon fişi */
function slipCheck() {
  const out = { ok: false, msg: '', tot: 1, stake: parseAmt(S.stake), mbs: 1, gone: [] };
  out.tot = r2(S.slip.reduce((p, s) => p * s.odd, 1));
  S.slip.forEach((s, i) => {
    const m = S.ctx.M[s.m];
    if (!m || !bettable(m)) out.gone.push(i);
    else out.mbs = Math.max(out.mbs, num(m.mbs, 1));
  });
  const me = S.me;
  if (!me) { out.msg = 'Kupon yapmak için oyuncu olman gerekir.'; return out; }
  if (!S.active) { out.msg = 'Şu an açık bir hafta yok.'; return out; }
  if (!S.slip.length) { out.msg = 'Bültenden oran seç.'; return out; }
  if (out.gone.length) { out.msg = 'Başlamış ya da kapanmış maçları kupondan çıkar.'; return out; }
  if (S.slip.length < out.mbs) { out.msg = 'MBS ' + out.mbs + ': bu kupona en az ' + out.mbs + ' maç eklemelisin.'; return out; }
  if (!(out.stake > 0)) { out.msg = 'Miktar gir.'; return out; }
  if (Math.abs(r2(out.stake) - out.stake) > 1e-9) { out.msg = 'Miktar en fazla iki ondalık olabilir.'; return out; }
  if (out.stake < S.ctx.cfg.minStake) { out.msg = 'En az ' + money(S.ctx.cfg.minStake) + ' oynayabilirsin.'; return out; }
  if (out.stake > me.lg.bal + 1e-9) { out.msg = 'Kasanda ' + money(me.lg.bal) + ' var.'; return out; }
  out.ok = true;
  return out;
}
function renderSheet() {
  const sh = $('sheet');
  if (!S.sheet || !S.me) { sh.hidden = true; sh.innerHTML = ''; return; }
  sh.hidden = false;
  const me = S.me, a = S.active;
  const ri = a ? me.lg.rinfo[a.id] : null;
  const rem = ri ? Math.max(0, r2(ri.req - ri.staked)) : 0;
  const ck = slipCheck();
  const lines = S.slip.map((s, i) => {
    const m = S.ctx.M[s.m];
    const gone = ck.gone.indexOf(i) >= 0;
    return '<li><div class="r-match">' + (m ? esc(m.home) + ' – ' + esc(m.away) : 'Maç bulunamadı') + '</div>' +
      '<div class="r-row"><span>' + esc(L.selLabel(s)) + (m ? ' · ' + esc(dt(num(m.kickoff, 0))) : '') + '</span><span class="r-odd">' + odd(s.odd) + '</span></div>' +
      '<div class="r-row">' + (gone ? '<span class="r-warn">Bu maça artık oynanamaz</span>' : '<span></span>') + '<button class="r-rm" data-act="slip-rm" data-v="' + i + '">Çıkar</button></div></li>';
  }).join('');
  const stamp = new Date().toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const focused = document.activeElement && document.activeElement.id === 'stake';
  sh.innerHTML = '<div class="sheet-back" data-act="slip-close"></div><div class="sheet-panel" role="dialog" aria-modal="true" aria-label="Kupon"><div class="zig"></div><div class="receipt">' +
    '<div class="r-head"><div class="r-title">DEVLER LİGİ KUPONU</div><button class="r-x" data-act="slip-close" aria-label="Kuponu kapat">×</button><div class="r-meta">' + (a ? esc(a.name) + ' · ' : '') + '@' + esc(S.user.uname) + ' · ' + esc(stamp) + '</div></div>' +
    '<div class="r-rule"></div>' +
    (S.slip.length ? '<ol class="r-lines">' + lines + '</ol>' : '<div>Kupon boş.</div>') +
    '<div class="r-rule"></div>' +
    '<div class="r-sum"><span>MAÇ SAYISI</span><b>' + S.slip.length + '</b></div>' +
    '<div class="r-sum"><span>TOPLAM ORAN</span><b>' + odd(ck.tot) + '</b></div>' +
    '<label class="r-lbl" for="stake">MİKTAR</label>' +
    '<input class="r-in" id="stake" inputmode="decimal" autocomplete="off" placeholder="0,00" value="' + esc(S.stake) + '">' +
    '<div class="r-quick">' +
    (rem > 0 ? '<button data-act="stake-q" data-v="' + rem + '">Kalan zorunlu ' + money(rem) + '</button>' : '') +
    '<button data-act="stake-q" data-v="' + r2(me.lg.bal / 2) + '">Kasanın yarısı</button><button data-act="stake-q" data-v="' + me.lg.bal + '">Tümü ' + money(me.lg.bal) + '</button>' +
    '</div>' +
    '<div class="r-sum r-big"><span>MAKS. KAZANÇ</span><b id="maxwin">' + money(isFinite(ck.stake) && ck.stake > 0 ? r2(ck.stake * ck.tot) : 0) + '</b></div>' +
    '<div class="r-msg" id="slipmsg">' + esc(ck.msg) + '</div>' +
    (S.confirm && ck.ok
      ? '<button class="r-play confirm" data-act="play-confirm"' + (S.busy ? ' disabled' : '') + '>ONAYLA · ' + money(ck.stake) + ' YATIR</button><button class="r-cancel" data-act="play-cancel">Vazgeç</button>'
      : '<button class="r-play" id="playbtn" data-act="play"' + (ck.ok ? '' : ' disabled') + '>KUPONU OYNA</button>') +
    '<div class="r-foot">Kasa ' + money(me.lg.bal) + ' · Oynanan kupon iptal edilemez' + (S.slip.length ? ' · <button class="r-rm" data-act="slip-clear">Kuponu temizle</button>' : '') + '</div>' +
    '</div></div>';
  if (focused) { const el = $('stake'); el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) {} }
}
function updateSlipLive() {
  const ck = slipCheck();
  const mw = $('maxwin'); if (mw) mw.textContent = money(isFinite(ck.stake) && ck.stake > 0 ? r2(ck.stake * ck.tot) : 0);
  const msg = $('slipmsg'); if (msg) msg.textContent = ck.msg;
  const pb = $('playbtn'); if (pb) pb.disabled = !ck.ok;
  if (S.confirm) { S.confirm = false; renderSheet(); }
}
const slipKey = () => 'dlk-slip-' + (S.user ? S.user.uid : '');
const saveSlip = () => LS.set(slipKey(), S.slip);

/* Kuponlar */
const ST_TXT = { won: 'Kazandı', lost: 'Kaybetti', pending: 'Bekliyor', refund: 'İade', invalid: 'Geçersiz' };
function couponCard(row, c, showWho) {
  const st = row.lg.cs[c.id] || { status: 'pending', marks: [] };
  const mine = S.user && row.id === S.user.uid;
  const firstKo = Math.min.apply(null, c.sel.map((s) => { const m = S.ctx.M[s.m]; return m ? num(m.kickoff, 0) : 0; }));
  const who = showWho ? '<span class="cp-who">' + av(row.id) + '<span>' + esc(nameOf(row.id)) + '</span></span>' : '<span class="cp-who"><span>Kupon</span></span>';
  const r = S.ctx.roundMap[c.round];
  const meta = (r ? esc(r.name) + ' · ' : '') + esc(dt(c.at));
  if (!mine && !isAdmin() && firstKo > Date.now() && st.status !== 'invalid') {
    return '<article class="cp"><div class="cp-h">' + who + '<span class="pill pending">Gizli</span></div><div class="cp-hidden"><span>' + c.sel.length + ' maç · ' + money(c.stake) + '</span><span>İlk maç başlayınca görünür</span></div></article>';
  }
  const sel = c.sel.map((s, i) => {
    const m = S.ctx.M[s.m];
    const mk = st.marks[i] || 'pending';
    const sym = { won: '✓', lost: '✕', pending: '•', void: '1' }[mk] || '•';
    const sc = m && m.status === 'ft' && Array.isArray(m.ft) ? '<span class="sc">' + esc(m.ft[0]) + '-' + esc(m.ft[1]) + '</span>' : (m && (m.status === 'post' || m.status === 'canc') ? '<span class="sc">1,00</span>' : '');
    return '<li><span class="mark ' + mk + '">' + sym + '</span><div><div class="cp-m">' + (m ? esc(m.home) + ' – ' + esc(m.away) : 'Silinmiş maç') + sc + '</div><div class="cp-k">' + esc(L.selLabel(s)) + '</div></div><span class="cp-o">' + odd(s.odd) + '</span></li>';
  }).join('');
  let foot = '<span>Miktar <b>' + money(c.stake) + '</b></span><span>Oran <b>' + odd(st.total) + '</b></span>';
  if (st.status === 'won') foot += '<span>Kazanç <b class="pay">' + money(st.payout) + '</b></span>';
  else if (st.status === 'refund') foot += '<span>İade <b>' + money(st.payout) + '</b></span>';
  else if (st.status === 'pending') foot += '<span>Olası kazanç <b>' + money(st.potential) + '</b></span>';
  let adm = '';
  if (isAdmin()) {
    const key = 'cc:' + c.id;
    adm = S.ask === key
      ? '<div class="confirm-row"><span class="small">' + (c.cancelled ? 'Kupon geri alınsın mı?' : 'Kupon iptal edilsin mi? Miktar kasaya döner.') + '</span><button class="btn sm danger" data-act="a-cpn" data-v="' + esc(c.id) + '">' + (c.cancelled ? 'Geri al' : 'İptal et') + '</button><button class="btn sm ghost" data-act="ask-no">Vazgeç</button></div>'
      : '<div><button class="linkbtn" data-act="ask" data-v="' + esc(key) + '">' + (c.cancelled ? 'İptali geri al' : 'Kuponu iptal et') + '</button></div>';
  }
  return '<article class="cp"><div class="cp-h">' + who + '<span class="pill ' + st.status + '">' + ST_TXT[st.status] + '</span></div><div class="cp-meta">' + meta + '</div>' +
    (st.reason ? '<div class="cp-reason">' + esc(st.reason) + ' · kasadan düşülmedi</div>' : '') +
    '<ul class="cp-sel">' + sel + '</ul><div class="cp-f">' + foot + '</div>' + adm + '</article>';
}
function couponsView() {
  const mode = isAdmin() ? 'all' : S.cmode;
  let h = '<div class="sec-h"><h2>Kuponlar</h2>' + (isAdmin() ? '<span class="muted small">Tüm oyuncular</span>' : '<div class="seg" role="group" aria-label="Kupon filtresi"><button data-act="cmode" data-v="me" aria-pressed="' + (mode === 'me') + '">Benim</button><button data-act="cmode" data-v="all" aria-pressed="' + (mode === 'all') + '">Herkes</button></div>') + '</div>';
  const list = [];
  S.rows.forEach((row) => {
    if (mode === 'me' && row.id !== S.user.uid) return;
    row.lg.coupons.forEach((c) => list.push({ row, c }));
  });
  list.sort((a, b) => b.c.at - a.c.at);
  if (!list.length) return h + '<div class="empty"><b>' + (mode === 'me' ? 'Henüz kuponun yok' : 'Henüz kimse kupon yapmadı') + '</b>' + (isAdmin() ? 'Oyuncular kupon yaptıkça burada görünür.' : 'Bültenden oran seçerek kupon oluştur; kupon alttaki çubukta birikir.') + '</div>';
  return h + '<div class="cps">' + list.map((x) => couponCard(x.row, x.c, mode === 'all')).join('') + '</div>';
}

/* Sıralama */
function standingsView() {
  let h = '';
  if (!S.rows.length) return '<div class="sec-h"><h2>Sıralama</h2></div><div class="empty"><b>Henüz oyuncu yok</b>Arkadaşların siteye girip "Kayıt ol" ile hesap açınca burada görünür.</div>';
  if (S.over) {
    const w = S.rows[0];
    h += '<div class="champ">' + av(w.id, true) + '<div><div class="t">Şampiyon: ' + esc(nameOf(w.id)) + '</div><div class="small" style="color:var(--band-muted)">Final sonrası kasa ' + money(w.lg.bal) + '</div></div></div>';
  }
  const a = S.active;
  h += '<div class="sec-h"><h2>Sıralama</h2><span class="muted small">' + (a ? esc(a.name) + ' zorunlu durumu' : 'Eşitlikte tutan en yüksek oran') + '</span></div>';
  h += '<ol class="lb">' + S.rows.map((row, i) => {
    const lg = row.lg;
    let wk = '';
    if (a && lg.rinfo[a.id]) {
      const ri = lg.rinfo[a.id], rem = Math.max(0, r2(ri.req - ri.staked));
      wk = rem > 0 ? '<span class="lb-wk due">' + money(rem) + ' eksik</span>' : '<span class="lb-wk ok">Zorunlu tamam</span>';
    } else if (lg.bestWin) wk = '<span class="lb-wk">En yüksek tutan ' + odd(lg.bestWin) + '</span>';
    const open = !!S.prow[row.id];
    let li = '<li><button class="lb-row' + (S.user && row.id === S.user.uid ? ' me' : '') + '" data-act="prow" data-v="' + esc(row.id) + '" aria-expanded="' + open + '">' +
      '<span class="lb-rank">' + (i + 1) + '</span>' + av(row.id) +
      '<span class="lb-name"><div>' + esc(nameOf(row.id)) + '</div><small>' + lg.coupons.length + ' kupon · ' + lg.nWon + ' tuttu' + (lg.nPend ? ' · ' + lg.nPend + ' bekliyor' : '') + '</small></span>' +
      '<span><span class="lb-bal">' + money(lg.bal) + '</span>' + wk + '</span></button></li>';
    if (open) li += '<li class="lb-detail">' + ledgerTable(row) + '</li>';
    return li;
  }).join('') + '</ol>';
  h += '<p class="muted small" style="margin:0">Satıra dokununca hafta hafta hesap dökümü açılır.</p>';
  return h;
}
function ledgerTable(row) {
  const lg = row.lg;
  const trs = S.ctx.rounds.filter((r) => lg.rinfo[r.id]).map((r) => {
    const ri = lg.rinfo[r.id];
    return '<tr><td>' + esc(r.name) + '</td><td>' + money(ri.before) + '</td><td class="pos">+' + money(ri.bonus) + '</td><td>' + money(ri.req) + '</td><td>' + money(ri.staked) + '</td><td class="pos">' + (ri.won ? '+' + money(ri.won) : '0,00') + '</td><td class="' + (ri.pen ? 'neg' : '') + '">' + (ri.pen ? '−' + money(ri.pen) : (ri.closed ? '0,00' : '—')) + '</td></tr>';
  }).join('');
  const adj = S.adjust.filter((x) => x.player === row.id);
  const adjTxt = adj.length ? '<p class="small muted" style="margin:8px 0 0">Düzeltmeler: ' + adj.map((x) => (num(x.amount, 0) >= 0 ? '+' : '') + money(x.amount) + (x.note ? ' (' + esc(x.note) + ')' : '')).join(', ') + '</p>' : '';
  if (!trs) return '<p class="small muted" style="margin:8px 0 0">Başlangıç kasası ' + money(S.ctx.cfg.start) + '. Henüz açılmış hafta yok.</p>' + adjTxt;
  return '<div class="tbl-wrap"><table class="led"><thead><tr><th>Hafta</th><th>Açılış</th><th>Bonus</th><th>Zorunlu</th><th>Oynanan</th><th>Dönen</th><th>Ceza</th></tr></thead><tbody>' + trs + '</tbody></table></div>' + adjTxt;
}

/* Kurallar */
function rulesView() {
  const c = S.ctx.cfg;
  return '<div class="sec-h"><h2>Kurallar</h2></div><div class="card rules">' +
    '<div><h3>Kasa</h3><ul><li>Herkes oyuna <b>' + money(c.start) + '</b> ile başlar.</li><li>Her Şampiyonlar Ligi haftasının bülteni açıldığında herkesin kasasına <b>+' + money(c.bonus) + '</b> eklenir.</li><li>Final maçı sonuçlandığında kasası en dolu olan kazanır. Eşitlikte tutan en yüksek oranlı kuponu olan öne geçer.</li></ul></div>' +
    '<div><h3>Haftalık zorunluluk</h3><ul><li>Bülten açıldığı andaki kasanın (bonus dahil) <b>yarısını</b> o hafta oynamak zorundasın.</li><li>Haftanın son maçı başladığında eksik kalan miktar kasandan düşülür. Hiç oynamayan zorunlu miktarın tamamını kaybeder.</li><li>Zorunlu miktarı tek kuponla ya da birkaç kuponla tamamlayabilirsin.</li></ul></div>' +
    '<div><h3>Oranlar ve kuponlar</h3><ul><li>Oranlar iddaa programından (Nesine\'deki oranların aynısı) her hafta bülten açılırken yüklenir. Kupona girdiğin oran sabitlenir.</li><li>Canlı bahis yok: maç başladığı anda o maça kupon yapılamaz.</li><li>Bir kupona aynı maçtan tek seçim eklenir. MBS kuralı geçerlidir: MBS 2 olan bir maç en az 2 maçlık kuponda oynanır.</li><li>En az ' + money(c.minStake) + ' oynanır. Kupon oynandıktan sonra iptal edilmez.</li><li>Kupondaki bütün maçlar tutarsa kazanç, miktar × toplam orandır. Bir maç yatarsa kupon kaybeder.</li></ul></div>' +
    '<div><h3>Sonuçlandırma</h3><ul><li>Bahisler normal süre sonucuna göre sonuçlanır (90 dakika ve hakemin eklediği süre). Uzatmalar ve penaltılar sayılmaz.</li><li>İlk yarı bahisleri ilk yarı skoruna göre sonuçlanır.</li><li>Ertelenen ya da iptal edilen maçın oranı 1,00 sayılır, kupon kalan maçlarla devam eder.</li><li>Sonuçlar maçlardan sonra bu sayfaya işlenir; kasalar kendiliğinden güncellenir.</li></ul></div>' +
    '<div><h3>Görünürlük ve hesaplar</h3><ul><li>Başkalarının kuponları, kupondaki ilk maç başlayınca görünür.</li><li>Oyuna geç katılan, katıldığı andan sonra kapanan haftalardan sorumludur.</li><li>Şifreni unutursan yöneticiye söyle; yeni şifre belirler.</li></ul></div>' +
    '</div>';
}

/* Yönetim */
const STATUS_TXT = { sched: 'Oynanmadı', ft: 'Bitti', post: 'Ertelendi (1,00)', canc: 'İptal (1,00)' };
function localInput(ms) { if (!ms) return ''; const d = new Date(ms); return new Date(ms - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function adminView() {
  const rs = S.ctx.rounds;
  if (!S.aRound || !S.ctx.roundMap[S.aRound]) S.aRound = (S.active || rs.find((r) => r._state === 'soon') || rs[rs.length - 1] || {}).id || null;
  const fu = S.feed && S.feed.updatedAt ? dt(Date.parse(S.feed.updatedAt)) : 'bilinmiyor';
  let h = '<div class="sec-h"><h2>Yönetim</h2><span class="muted small">Bülten dosyası: ' + esc(fu) + '</span></div><div class="adm">';
  h += playersCard();
  h += '<div class="card"><h3 class="h3">Haftalar</h3><div class="adm-list">' + (rs.length ? rs.map((r) => {
    const ask = 'open:' + r.id;
    return '<div class="adm-row"><div><b>' + esc(r.name) + '</b> <span class="pill ' + r._state + '">' + STATE_TXT[r._state] + '</span><div class="small muted">' + r._matches.length + ' maç' + (r._open ? ' · açıldı ' + esc(dt(r._open)) : '') + (r._close ? ' · kapanış ' + esc(dt(r._close)) : '') + (r.final ? ' · final' : '') + '</div></div>' +
      '<div class="btn-row">' + (r._state === 'soon' ? (S.ask === ask ? '<button class="btn sm" data-act="a-open" data-v="' + esc(r.id) + '">Evet, aç (+' + money(S.ctx.cfg.bonus) + ')</button><button class="btn sm ghost" data-act="ask-no">Vazgeç</button>' : '<button class="btn sm" data-act="ask" data-v="' + esc(ask) + '">Bülteni şimdi aç</button>') : '') + '<button class="btn sm ghost" data-act="a-rsel" data-v="' + esc(r.id) + '"' + (S.aRound === r.id ? ' aria-pressed="true"' : '') + '>Maçlar</button></div></div>';
  }).join('') : '<p class="muted small">Henüz hafta yok.</p>') + '</div>' +
    '<details class="adm-more"><summary>Hafta ekle</summary><div class="grid-f" style="margin-top:10px"><label>Hafta adı<input id="a-rname" placeholder="4. Hafta"></label><label>Aşama<input id="a-rstage" placeholder="Lig Aşaması"></label><label>Sıra<input id="a-rorder" inputmode="numeric" placeholder="' + (rs.length + 1) + '"></label><label>Final mi?<select id="a-rfinal"><option value="0">Hayır</option><option value="1">Evet</option></select></label></div>' +
    '<div style="margin-top:8px"><button class="btn sm" data-act="a-rnew">Hafta ekle</button></div></details></div>';
  const r = S.ctx.roundMap[S.aRound];
  if (r) {
    h += '<div class="card"><h3 class="h3">' + esc(r.name) + ' maçları</h3><p class="small muted" style="margin:4px 0 0">Sonuçlar ve oranlar normalde otomatik gelir. Burada yazdığın değer otomatik gelenin önüne geçer.</p><div class="adm-list">' + r._matches.map((m) => {
      const id = esc(m.id), st = m.status || 'sched';
      return '<div class="adm-row"><div style="min-width:0"><b>' + esc(m.home) + ' – ' + esc(m.away) + '</b><div class="small muted">' + esc(dt(num(m.kickoff, 0))) + ' · ' + (m.odds && m.odds.MS ? 'oranlar var' : 'oran yok') + '</div></div>' +
        '<div class="btn-row" style="align-items:end">' +
        '<span class="lbl">İY<span class="score-in"><input id="a-hth-' + id + '" inputmode="numeric" value="' + (Array.isArray(m.ht) ? esc(m.ht[0]) : '') + '" aria-label="İlk yarı ev"><span>-</span><input id="a-hta-' + id + '" inputmode="numeric" value="' + (Array.isArray(m.ht) ? esc(m.ht[1]) : '') + '" aria-label="İlk yarı deplasman"></span></span>' +
        '<span class="lbl">MS<span class="score-in"><input id="a-fth-' + id + '" inputmode="numeric" value="' + (Array.isArray(m.ft) ? esc(m.ft[0]) : '') + '" aria-label="Maç sonu ev"><span>-</span><input id="a-fta-' + id + '" inputmode="numeric" value="' + (Array.isArray(m.ft) ? esc(m.ft[1]) : '') + '" aria-label="Maç sonu deplasman"></span></span>' +
        '<label class="lbl">Durum<select id="a-st-' + id + '">' + Object.keys(STATUS_TXT).map((k) => '<option value="' + k + '"' + (k === st ? ' selected' : '') + '>' + STATUS_TXT[k] + '</option>').join('') + '</select></label>' +
        '<button class="btn sm" data-act="a-res" data-v="' + id + '">Sonucu kaydet</button><button class="btn sm ghost" data-act="a-msel" data-v="' + id + '">Oranlar</button></div></div>';
    }).join('') + '</div><div style="margin-top:8px"><button class="btn sm ghost" data-act="a-mnew">Maç ekle</button></div></div>';
    if (S.aMatch) h += matchEditor();
  }
  h += '<div class="card"><h3 class="h3">Kasa düzeltmesi</h3><p class="small muted" style="margin:4px 0 8px">Anlaşmazlık olursa bir oyuncunun kasasına ekle ya da düş (eksi değer).</p>' +
    '<div class="grid-f"><label>Oyuncu<select id="a-jp">' + S.rows.map((row) => '<option value="' + esc(row.id) + '">' + esc(nameOf(row.id)) + '</option>').join('') + '</select></label><label>Miktar<input id="a-jamt" inputmode="decimal" placeholder="-10"></label><label>Not<input id="a-jnote" maxlength="80"></label></div>' +
    '<div style="margin-top:8px"><button class="btn sm" data-act="a-adj"' + (S.rows.length ? '' : ' disabled') + '>Ekle</button></div>' +
    (S.adjust.length ? '<div class="adm-list" style="margin-top:10px">' + S.adjust.map((x) => '<div class="adm-row"><span>' + esc(nameOf(x.player)) + ' · ' + money(x.amount) + (x.note ? ' · ' + esc(x.note) : '') + '</span><button class="btn sm ghost" data-act="a-adjdel" data-v="' + esc(x.id) + '">Sil</button></div>').join('') + '</div>' : '') +
    '</div></div>';
  return h;
}
function playersCard() {
  const all = S.players.slice().sort((a, b) => (a.removed ? 1 : 0) - (b.removed ? 1 : 0) || String(a.name || '').localeCompare(String(b.name || ''), 'tr'));
  let h = '<div class="card"><h3 class="h3">Oyuncular <span class="muted small">' + S.rows.length + ' aktif</span></h3>';
  if (!all.length) return h + '<p class="small muted" style="margin:6px 0 0">Henüz kayıt olan yok. Site linkini arkadaşlarına gönder; "Kayıt ol" ile kendi hesaplarını açarlar.</p></div>';
  h += '<div class="adm-list">' + all.map((p) => {
    const row = S.rows.find((x) => x.id === p.id);
    const reset = S.resets.find((x) => x.id === p.id);
    const open = S.aPlayer === p.id;
    let x = '<div class="adm-row' + (p.removed ? ' off' : '') + '"><div class="cp-who">' + av(p.id) + '<div style="min-width:0"><b>' + esc(p.name || p.uname) + '</b><div class="small muted">@' + esc(p.uname) + (row ? ' · kasa ' + money(row.lg.bal) : '') + (p.removed ? ' · oyundan çıkarıldı' : '') + (reset ? ' · şifre sıfırlama bekliyor' : '') + '</div></div></div>' +
      '<button class="btn sm ghost" data-act="a-psel" data-v="' + esc(p.id) + '" aria-expanded="' + open + '">' + (open ? 'Kapat' : 'Düzenle') + '</button></div>';
    if (open) {
      const pid = esc(p.id);
      x += '<div class="adm-sub">' +
        '<div class="join-row"><label class="sr" for="a-pn-' + pid + '">Görünen ad</label><input id="a-pn-' + pid + '" maxlength="20" value="' + esc(p.name || '') + '" placeholder="Görünen ad"><button class="btn sm" data-act="a-pname" data-v="' + pid + '">Adı kaydet</button></div>' +
        '<div class="join-row"><label class="sr" for="a-pw-' + pid + '">Yeni şifre</label><input id="a-pw-' + pid + '" autocomplete="off" placeholder="Yeni şifre (en az 6)"><button class="btn sm" data-act="a-reset" data-v="' + pid + '">Şifreyi sıfırla</button>' + (reset ? '<button class="btn sm ghost" data-act="a-resetx" data-v="' + pid + '">Bekleyeni iptal et</button>' : '') + '</div>' +
        '<p class="small muted" style="margin:0">Yeni şifre birkaç dakika içinde (en geç ~15 dk) geçerli olur. Oyuncuya kendin ilet; girdikten sonra Hesap ekranından değiştirebilir.</p>' +
        (S.ask === 'rm:' + p.id
          ? '<div class="confirm-row"><span class="small">' + (p.removed ? 'Oyuncu geri alınsın mı?' : 'Oyuncu sıralamadan çıkarılsın ve kupon yapamasın mı?') + '</span><button class="btn sm danger" data-act="a-premove" data-v="' + pid + '">' + (p.removed ? 'Geri al' : 'Çıkar') + '</button><button class="btn sm ghost" data-act="ask-no">Vazgeç</button></div>'
          : '<div><button class="linkbtn" data-act="ask" data-v="rm:' + pid + '">' + (p.removed ? 'Oyuna geri al' : 'Oyundan çıkar') + '</button></div>') +
        '</div>';
    }
    return x;
  }).join('') + '</div></div>';
  return h;
}
function matchEditor() {
  const isNew = S.aMatch === '__new';
  const m = isNew ? { round: S.aRound, odds: {}, mbs: 1 } : S.ctx.M[S.aMatch];
  if (!m) return '';
  const o = m.odds || {};
  return '<div class="card"><h3 class="h3">' + (isNew ? 'Yeni maç' : esc(m.home) + ' – ' + esc(m.away)) + '</h3><div class="grid-f" style="margin-top:8px">' +
    '<label>Ev sahibi<input id="f-home" value="' + esc(m.home || '') + '"></label><label>Deplasman<input id="f-away" value="' + esc(m.away || '') + '"></label>' +
    '<label>Başlama<input id="f-ko" type="datetime-local" value="' + esc(localInput(num(m.kickoff, 0))) + '"></label><label>MBS<input id="f-mbs" inputmode="numeric" value="' + esc(num(m.mbs, 1)) + '"></label></div>' +
    '<div class="odds-ed" style="margin-top:10px">' + L.MARKETS.map((mk) => {
      const cur = o[mk.k] || {};
      return '<fieldset><legend>' + mk.name + '</legend>' + (mk.k === 'HND' ? '<label>Handikap<input id="f-HND-h" placeholder="0:1" value="' + esc(cur.h || '') + '"></label>' : '') +
        mk.outs.map((out) => '<label>' + esc(out[1]) + '<input id="f-' + mk.k + '-' + esc(out[0]) + '" inputmode="decimal" value="' + (cur[out[0]] != null ? esc(cur[out[0]]) : '') + '"></label>').join('') + '</fieldset>';
    }).join('') + '</div><p class="small muted" style="margin:8px 0">Boş bırakılan bahis türü bültende görünmez. Bülten açıldıktan sonra değişen oranların eski hâli saklanır, eski kuponlar geçerli kalır.</p>' +
    '<div class="btn-row">' + (isNew ? '' : (S.ask === 'mdel' ? '<button class="btn sm danger" data-act="a-mdel">Evet, bültenden kaldır</button><button class="btn sm ghost" data-act="ask-no">Vazgeç</button>' : '<button class="btn sm ghost" data-act="ask" data-v="mdel">Maçı bültenden kaldır</button>')) + '<button class="btn sm" data-act="a-msave">Kaydet</button><button class="btn sm ghost" data-act="a-mclose">Kapat</button></div></div>';
}

/* ---------- yazma işlemleri ---------- */
const wErr = (e) => errText(e, 'Kaydedilemedi, bağlantını kontrol edip tekrar dene.');
async function play() {
  const ck = slipCheck();
  if (!ck.ok || S.busy) { S.confirm = false; renderSheet(); return; }
  let changed = false;
  S.slip.forEach((s) => {
    const m = S.ctx.M[s.m], cur = m && m.odds && m.odds[s.mk];
    const v = cur ? num(cur[s.k], null) : null;
    if (v !== null && Math.abs(v - s.odd) >= 0.005) { s.odd = v; changed = true; }
    if (s.mk === 'HND' && cur && String(cur.h) !== String(s.hcp)) { s.hcp = cur.h; changed = true; }
  });
  if (changed) { saveSlip(); S.confirm = false; renderSheet(); toast('Bazı oranlar değişti, kuponu kontrol edip tekrar oyna.', true); return; }
  const coupon = {
    round: S.active.id, stake: r2(ck.stake),
    sel: S.slip.map((s) => { const o = { m: s.m, mk: s.mk, k: s.k, odd: s.odd }; if (s.mk === 'HND') o.hcp = s.hcp; return o; })
  };
  S.busy = true; renderSheet();
  try {
    await S.be.placeCoupon(coupon);
    S.slip = []; S.stake = ''; S.confirm = false; S.sheet = false; saveSlip();
    S.tab = 'kuponlar'; S.cmode = 'me';
    toast('Kupon oynandı: ' + money(coupon.stake) + ' · oran ' + odd(ck.tot));
  } catch (e) { toast(wErr(e), true); S.confirm = false; }
  S.busy = false; render(true); window.scrollTo(0, 0);
}
async function adm(promise, okMsg, after) {
  try { await promise; if (after) after(); if (okMsg) toast(okMsg); render(true); }
  catch (e) { toast(wErr(e), true); }
}
const intOrNull = (id) => { const el = $(id); if (!el || el.value.trim() === '') return null; const n = parseInt(el.value, 10); return isFinite(n) && n >= 0 ? n : null; };
const clearDraft = (pred) => Object.keys(S.draft).forEach((k) => { if (pred(k)) delete S.draft[k]; });
function adminSaveResult(mid) {
  const st = ($('a-st-' + mid) || {}).value || 'sched';
  const hth = intOrNull('a-hth-' + mid), hta = intOrNull('a-hta-' + mid), fth = intOrNull('a-fth-' + mid), fta = intOrNull('a-fta-' + mid);
  if (st === 'ft' && (fth === null || fta === null)) { toast('Bitti olarak kaydetmek için maç sonu skorunu gir.', true); return; }
  const d = overrideOf('m', mid);
  d.status = st;
  d.ht = (hth !== null && hta !== null) ? [hth, hta] : null;
  d.ft = (fth !== null && fta !== null) ? [fth, fta] : null;
  d.doneAt = st === 'sched' ? null : (S.ctx.M[mid] && S.ctx.M[mid].doneAt) || Date.now();
  adm(S.be.setOverride('m', mid, d), 'Sonuç kaydedildi.', () => clearDraft((k) => k.endsWith('-' + mid) && k.startsWith('a-')));
}
function adminSaveMatch() {
  const isNew = S.aMatch === '__new';
  const id = isNew ? 'x' + Date.now().toString(36) : S.aMatch;
  const home = ($('f-home').value || '').trim(), away = ($('f-away').value || '').trim();
  const ko = new Date($('f-ko').value).getTime();
  if (!home || !away || !isFinite(ko)) { toast('Takımları ve başlama saatini gir.', true); return; }
  const odds = {}; let bad = false;
  L.MARKETS.forEach((mk) => {
    const o = {}; let n = 0;
    mk.outs.forEach((out) => {
      const el = $('f-' + mk.k + '-' + out[0]); const v = el ? el.value.trim() : '';
      if (!v) return;
      const x = parseAmt(v);
      if (!(x >= 1)) { bad = true; return; }
      o[out[0]] = r2(x); n++;
    });
    if (mk.k === 'HND' && n) { const hv = ($('f-HND-h').value || '').trim(); if (!/^\d+\s*:\s*\d+$/.test(hv)) bad = true; o.h = hv.replace(/\s/g, ''); }
    if (n) odds[mk.k] = o;
  });
  if (bad) { toast('Oranlar 1,00 veya üstü olmalı; handikap 0:1 biçiminde yazılmalı.', true); return; }
  const d = overrideOf('m', id);
  const cur = S.ctx.M[id];
  const r = S.ctx.roundMap[isNew ? S.aRound : cur.round];
  if (!isNew && r && r._open !== null && cur.odds && JSON.stringify(cur.odds) !== JSON.stringify(odds)) {
    d.hist = (Array.isArray(d.hist) ? d.hist.slice() : []).concat([{ at: Date.now(), odds: cur.odds }]);
  }
  if (isNew) { d.round = S.aRound; d.status = 'sched'; }
  d.home = home; d.away = away; d.kickoff = ko; d.mbs = Math.max(1, parseInt($('f-mbs').value, 10) || 1); d.odds = odds;
  adm(S.be.setOverride('m', id, d), 'Maç kaydedildi.', () => { clearDraft((k) => k.startsWith('f-')); S.aMatch = null; });
}
function adminNewRound() {
  const name = ($('a-rname').value || '').trim();
  let order = parseInt($('a-rorder').value, 10);
  if (!name) { toast('Hafta adını yaz.', true); return; }
  if (!isFinite(order)) order = S.ctx.rounds.length + 1;
  let id = 'r' + String(order).padStart(2, '0');
  if (S.ctx.roundMap[id]) id += '-' + Date.now().toString(36).slice(-3);
  adm(S.be.setOverride('r', id, { name, stage: ($('a-rstage').value || '').trim(), order, final: $('a-rfinal').value === '1', opensAt: null }), 'Hafta eklendi.', () => { clearDraft((k) => k.startsWith('a-r')); S.aRound = id; });
}
function adminOpen(rid) {
  const r = S.ctx.roundMap[rid];
  S.ask = null;
  if (!r || !r._matches.some((m) => m.odds && m.odds.MS)) { toast('Önce bu haftanın maçlarına oran gir.', true); render(true); return; }
  const d = overrideOf('r', rid); d.opensAt = Date.now();
  adm(S.be.setOverride('r', rid, d), r.name + ' bülteni açıldı. Herkese +' + money(S.ctx.cfg.bonus) + '.');
}
function adminAdj() {
  const p = $('a-jp').value, amt = parseAmt($('a-jamt').value), note = ($('a-jnote').value || '').trim();
  if (!p || !isFinite(amt) || amt === 0) { toast('Oyuncu ve sıfırdan farklı bir miktar gir.', true); return; }
  adm(S.be.addAdjust({ player: p, amount: r2(amt), note }), 'Düzeltme eklendi.', () => clearDraft((k) => k === 'a-jamt' || k === 'a-jnote'));
}

/* ---------- olaylar ---------- */
function setTab(t) {
  S.tab = t; S.confirm = false; S.ask = null;
  try { history.replaceState(null, '', '#' + t); } catch (e) {}
  LS.set('dlk-tab', t);
  render(true); window.scrollTo(0, 0);
}
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const act = b.getAttribute('data-act'), v = b.getAttribute('data-v');
  switch (act) {
    case 'tab': setTab(v); break;
    case 'account': setTab('hesap'); break;
    case 'amode': S.amode = v; render(true); setTimeout(() => { const u = $('a-user'); if (u) u.focus(); }, 0); break;
    case 'logout': S.ask = 'logout'; render(true); break;
    case 'logout-yes': S.ask = null; S.be.signOut(); break;
    case 'ask': S.ask = v; render(true); break;
    case 'ask-no': S.ask = null; render(true); break;
    case 'join': adm(S.be.join(cleanName(S.user.uname)), 'Oyuna katıldın.'); break;
    case 'vround': S.vround = v; render(true); break;
    case 'more': S.more[v] = !S.more[v]; render(true); break;
    case 'pick': {
      const mid = b.getAttribute('data-m'), mk = b.getAttribute('data-mk'), k = b.getAttribute('data-k');
      const m = S.ctx.M[mid]; if (!m || !bettable(m)) return;
      const o = m.odds[mk]; const val = num(o && o[k], null); if (val === null) return;
      const idx = S.slip.findIndex((s) => s.m === mid);
      const same = idx >= 0 && S.slip[idx].mk === mk && S.slip[idx].k === k;
      if (idx >= 0) S.slip.splice(idx, 1);
      if (!same) { const sel = { m: mid, mk, k, odd: val }; if (mk === 'HND') sel.hcp = o.h; S.slip.push(sel); }
      S.confirm = false; saveSlip(); render(true); break;
    }
    case 'slip-open': S.sheet = true; S.confirm = false; renderChrome(); renderSheet(); break;
    case 'slip-close': S.sheet = false; S.confirm = false; renderSheet(); renderChrome(); break;
    case 'slip-rm': S.slip.splice(Number(v), 1); saveSlip(); S.confirm = false; if (!S.slip.length) S.sheet = false; render(true); break;
    case 'slip-clear': S.slip = []; S.sheet = false; S.confirm = false; saveSlip(); render(true); break;
    case 'stake-q': S.stake = String(r2(Number(v))).replace('.', ','); S.confirm = false; renderSheet(); break;
    case 'play': if (slipCheck().ok) { S.confirm = true; renderSheet(); } break;
    case 'play-cancel': S.confirm = false; renderSheet(); break;
    case 'play-confirm': play(); break;
    case 'cmode': S.cmode = v; render(true); break;
    case 'prow': S.prow[v] = !S.prow[v]; render(true); break;
    case 'a-open': adminOpen(v); break;
    case 'a-rsel': S.aRound = v; S.aMatch = null; render(true); break;
    case 'a-rnew': adminNewRound(); break;
    case 'a-res': adminSaveResult(v); break;
    case 'a-msel': S.aMatch = v; S.ask = null; render(true); break;
    case 'a-mnew': S.aMatch = '__new'; render(true); break;
    case 'a-mclose': S.aMatch = null; clearDraft((k) => k.startsWith('f-')); render(true); break;
    case 'a-msave': adminSaveMatch(); break;
    case 'a-mdel': { const id = S.aMatch, d = overrideOf('m', id); d.deleted = true; S.ask = null; adm(S.be.setOverride('m', id, d), 'Maç bültenden kaldırıldı.', () => { S.aMatch = null; }); break; }
    case 'a-adj': adminAdj(); break;
    case 'a-adjdel': adm(S.be.deleteAdjust(v), 'Düzeltme silindi.'); break;
    case 'a-psel': S.aPlayer = S.aPlayer === v ? null : v; S.ask = null; render(true); break;
    case 'a-pname': {
      const n = cleanName(($('a-pn-' + v) || {}).value);
      if (n.length < 2) { toast('Görünen ad en az 2 karakter olmalı.', true); break; }
      adm(S.be.updatePlayer(v, { name: n }), 'Ad kaydedildi.', () => clearDraft((k) => k === 'a-pn-' + v));
      break;
    }
    case 'a-reset': {
      const pw = (($('a-pw-' + v) || {}).value || '').trim();
      if (pw.length < 6) { toast('Yeni şifre en az 6 karakter olmalı.', true); break; }
      adm(S.be.requestReset(v, pw), 'Şifre sıfırlama sıraya alındı. Birkaç dakika içinde geçerli olur.', () => clearDraft((k) => k === 'a-pw-' + v));
      break;
    }
    case 'a-resetx': adm(S.be.cancelReset(v), 'Bekleyen sıfırlama iptal edildi.'); break;
    case 'a-premove': { const p = playerById(v); S.ask = null; adm(S.be.updatePlayer(v, { removed: !(p && p.removed) }), p && p.removed ? 'Oyuncu geri alındı.' : 'Oyuncu oyundan çıkarıldı.'); break; }
    case 'a-cpn': { const c = S.coupons.find((x) => x.id === v); S.ask = null; adm(S.be.updateCoupon(v, { cancelled: !(c && c.cancelled) }), c && c.cancelled ? 'Kupon geri alındı.' : 'Kupon iptal edildi.'); break; }
  }
});
document.addEventListener('submit', (ev) => {
  ev.preventDefault();
  if (ev.target.id === 'authform') submitAuth();
  else if (ev.target.id === 'pwform') submitPw();
});
document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.id === 'stake') { S.stake = t.value; updateSlipLive(); return; }
  if (t.id && /^(a-|f-)/.test(t.id) && t.type !== 'password' && !/^a-(user|pass)/.test(t.id)) S.draft[t.id] = t.value;
});
document.addEventListener('change', (ev) => { const t = ev.target; if (t.id && /^(a-[jr]|a-st-|f-)/.test(t.id)) S.draft[t.id] = t.value; });
document.addEventListener('focusout', () => { setTimeout(() => { if (S.dirty) render(); }, 0); });
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && S.sheet) { S.sheet = false; S.confirm = false; renderSheet(); renderChrome(); }
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { loadFeed(); render(); } });
setInterval(() => { if (S.user) render(); }, 30000);

/* ---------- veri ---------- */
async function loadFeed() {
  try {
    const res = await fetch(FEED_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const f = await res.json();
    S.feed = f; S.feedAt = Date.now(); S.feedErr = false;
  } catch (e) {
    S.feedErr = true; if (!S.feedAt) S.feedAt = Date.now();
  }
  render();
}
function onAuth(u) {
  S.authReady = true;
  if (S.unsub) { S.unsub(); S.unsub = null; }
  S.user = u;
  S.loaded = {}; S.players = []; S.coupons = []; S.overrides = []; S.adjust = []; S.resets = [];
  S.sheet = false; S.confirm = false; S.ask = null; S.draft = {};
  if (u) {
    S.slip = LS.get(slipKey(), []);
    if (!Array.isArray(S.slip)) S.slip = [];
    S.unsub = S.be.listen(u.isAdmin, {
      data(name, arr) { S[name] = arr; S.loaded[name] = true; render(); },
      error(name, e) {
        S.loaded[name] = true;
        if (e && e.code === 'permission-denied') toast('Veriye erişim izni yok. Yönetici Firestore kurallarını kontrol etmeli.', true);
        render();
      }
    });
  } else {
    S.slip = [];
    S.amode = S.setup ? 'up' : 'in';
  }
  render(true);
}

function boot() {
  const h = (location.hash || '').replace('#', '');
  S.setup = h === 'kurulum';
  if (S.setup) S.amode = 'up';
  S.tab = VIEWS.indexOf(h) >= 0 ? h : LS.get('dlk-tab', 'bulten');
  render(true);
  try { S.be = createBackend(); }
  catch (e) {
    $('view').innerHTML = '<div class="empty"><b>Site ayarları eksik</b>Firebase bağlantı bilgileri girilmemiş.</div>';
    return;
  }
  S.be.onAuth(onAuth);
  loadFeed();
  setInterval(loadFeed, FEED_EVERY);
}
boot();
