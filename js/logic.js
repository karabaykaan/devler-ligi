/* Devler Ligi Kuponu: oyun mantığı (DOM yok, saf fonksiyonlar) */
var L = (function () {
  'use strict';

  var MARKETS = [
    { k: 'MS', name: 'Maç Sonucu', short: 'MS', outs: [['1', '1'], ['X', 'X'], ['2', '2']] },
    { k: 'CS', name: 'Çifte Şans', short: 'ÇŞ', outs: [['1X', '1-X'], ['12', '1-2'], ['X2', 'X-2']] },
    { k: 'IY', name: 'İlk Yarı Sonucu', short: 'İY', outs: [['1', '1'], ['X', 'X'], ['2', '2']] },
    { k: 'HND', name: 'Handikaplı Maç Sonucu', short: 'H', outs: [['1', '1'], ['X', 'X'], ['2', '2']] },
    { k: 'AU15', name: 'Alt/Üst 1,5', short: '1,5', outs: [['A', 'Alt'], ['U', 'Üst']] },
    { k: 'AU25', name: 'Alt/Üst 2,5', short: '2,5', outs: [['A', 'Alt'], ['U', 'Üst']] },
    { k: 'AU35', name: 'Alt/Üst 3,5', short: '3,5', outs: [['A', 'Alt'], ['U', 'Üst']] },
    { k: 'IYAU15', name: 'İlk Yarı Alt/Üst 1,5', short: 'İY 1,5', outs: [['A', 'Alt'], ['U', 'Üst']] },
    { k: 'KG', name: 'Karşılıklı Gol', short: 'KG', outs: [['V', 'Var'], ['Y', 'Yok']] },
    { k: 'TG', name: 'Toplam Gol', short: 'TG', outs: [['0-1', '0-1'], ['2-3', '2-3'], ['4-5', '4-5'], ['6+', '6+']] },
    { k: 'IYMS', name: 'İlk Yarı / Maç Sonucu', short: 'İY/MS', outs: [['1/1', '1/1'], ['1/X', '1/X'], ['1/2', '1/2'], ['X/1', 'X/1'], ['X/X', 'X/X'], ['X/2', 'X/2'], ['2/1', '2/1'], ['2/X', '2/X'], ['2/2', '2/2']] }
  ];
  var MK = {};
  MARKETS.forEach(function (m) { MK[m.k] = m; });

  var DEFAULT_CFG = { start: 100, bonus: 50, ratio: 0.5, minStake: 1 };
  var SETTLE_FALLBACK = 2 * 3600 * 1000;

  function num(v, d) {
    if (v === null || v === undefined || v === '') return d;
    var n = Number(v);
    return isFinite(n) ? n : d;
  }
  function r2(x) { return Math.round(x * 100 + (x >= 0 ? 1e-6 : -1e-6)) / 100; }
  function res(h, a) { return h > a ? '1' : (h < a ? '2' : 'X'); }
  function parseHcp(hs) {
    var mm = /^(\d+)\s*:\s*(\d+)$/.exec(String(hs || '').trim());
    return mm ? [Number(mm[1]), Number(mm[2])] : null;
  }
  function isSettledStatus(st) { return st === 'ft' || st === 'post' || st === 'canc'; }

  /* Tek bir seçimin sonucu: won | lost | void | pending (90 dk sonucu) */
  function selOutcome(m, s) {
    if (!m) return 'void';
    var st = m.status || 'sched';
    if (st === 'post' || st === 'canc') return 'void';
    if (st !== 'ft' || !Array.isArray(m.ft)) return 'pending';
    var h = num(m.ft[0], 0), a = num(m.ft[1], 0), tot = h + a;
    var hasHt = Array.isArray(m.ht);
    var hh = hasHt ? num(m.ht[0], 0) : 0, ha = hasHt ? num(m.ht[1], 0) : 0;
    var k = String(s.k), r;
    switch (s.mk) {
      case 'MS': r = res(h, a) === k; break;
      case 'CS': r = k.indexOf(res(h, a)) >= 0; break;
      case 'IY': if (!hasHt) return 'pending'; r = res(hh, ha) === k; break;
      case 'IYMS': if (!hasHt) return 'pending'; r = (res(hh, ha) + '/' + res(h, a)) === k; break;
      case 'AU15': case 'AU25': case 'AU35':
        r = (tot < { AU15: 1.5, AU25: 2.5, AU35: 3.5 }[s.mk] ? 'A' : 'U') === k; break;
      case 'IYAU15': if (!hasHt) return 'pending'; r = ((hh + ha) < 1.5 ? 'A' : 'U') === k; break;
      case 'KG': r = ((h > 0 && a > 0) ? 'V' : 'Y') === k; break;
      case 'TG': r = (tot <= 1 ? '0-1' : tot <= 3 ? '2-3' : tot <= 5 ? '4-5' : '6+') === k; break;
      case 'HND':
        var p = parseHcp(s.hcp);
        if (!p) return 'void';
        r = res(h + p[0], a + p[1]) === k; break;
      default: return 'void';
    }
    return r ? 'won' : 'lost';
  }

  /* Kupondaki oran bültenin o anki ya da önceki bir sürümüyle aynı mı? */
  function oddsOk(m, s) {
    var cands = [m.odds].concat((Array.isArray(m.hist) ? m.hist : []).map(function (h) { return h && h.odds; }));
    for (var i = 0; i < cands.length; i++) {
      var o = cands[i] && cands[i][s.mk];
      if (!o) continue;
      var v = num(o[s.k], null);
      if (v === null) continue;
      if (Math.abs(v - num(s.odd, -1)) < 0.005 && (s.mk !== 'HND' || String(o.h) === String(s.hcp))) return true;
    }
    return false;
  }

  function prepare(d, now) {
    var cfg = {};
    Object.keys(DEFAULT_CFG).forEach(function (k) { cfg[k] = num(d.cfg && d.cfg[k], DEFAULT_CFG[k]); });
    var M = {}, byRound = {};
    (d.matches || []).forEach(function (m) {
      M[m.id] = m;
      (byRound[m.round] = byRound[m.round] || []).push(m);
    });
    Object.keys(byRound).forEach(function (k) {
      byRound[k].sort(function (x, y) {
        return (num(x.kickoff, 0) - num(y.kickoff, 0)) || String(x.home || '').localeCompare(String(y.home || ''), 'tr');
      });
    });
    var roundMap = {};
    var rounds = (d.rounds || []).slice().sort(function (a, b) { return num(a.order, 0) - num(b.order, 0); }).map(function (r) {
      var ms = byRound[r.id] || [];
      var close = num(r.closesAt, null);
      if (close === null && ms.length) close = Math.max.apply(null, ms.map(function (m) { return num(m.kickoff, 0); }));
      var opens = num(r.opensAt, null);
      var state = (opens === null || opens > now) ? 'soon' : (close !== null && now >= close ? 'closed' : 'open');
      var settled = ms.length > 0 && ms.every(function (m) { return isSettledStatus(m.status); });
      if (state === 'closed' && settled) state = 'done';
      var o = {};
      Object.keys(r).forEach(function (k) { o[k] = r[k]; });
      o._open = opens; o._close = close; o._state = state; o._matches = ms;
      roundMap[r.id] = o;
      return o;
    });
    var couponsBy = {};
    (d.coupons || []).forEach(function (c) {
      if (!c || !c.uid) return;
      (couponsBy[c.uid] = couponsBy[c.uid] || []).push(c);
    });
    return { now: now, cfg: cfg, M: M, byRound: byRound, rounds: rounds, roundMap: roundMap, adjust: d.adjust || [], couponsBy: couponsBy };
  }

  /* Bülten dosyası (feed) + yöneticinin elle yaptığı değişiklikler (overrides) */
  function mergeData(feed, ov) {
    feed = feed || {}; ov = ov || {};
    var orv = ov.rounds || {}, omv = ov.matches || {};
    function assign(base, patch) {
      var o = {};
      Object.keys(base || {}).forEach(function (k) { o[k] = base[k]; });
      Object.keys(patch || {}).forEach(function (k) { if (k !== 'hist') o[k] = patch[k]; });
      return o;
    }
    var rounds = {}, matches = {};
    (feed.rounds || []).forEach(function (r) { if (r && r.id) rounds[r.id] = assign(r, null); });
    Object.keys(orv).forEach(function (id) { rounds[id] = assign(rounds[id] || { id: id }, orv[id]); rounds[id].id = id; });
    (feed.matches || []).forEach(function (m) { if (m && m.id) matches[m.id] = assign(m, null); });
    Object.keys(omv).forEach(function (id) {
      var base = matches[id] || { id: id }, p = omv[id] || {};
      var m = assign(base, p);
      m.id = id;
      var hist = (Array.isArray(base.hist) ? base.hist : []).slice();
      if (p.odds && base.odds && Object.keys(base.odds).length) hist.push({ odds: base.odds });
      if (Array.isArray(p.hist)) hist = hist.concat(p.hist);
      m.hist = hist;
      matches[id] = m;
    });
    return {
      cfg: assign(feed.cfg, ov.cfg),
      rounds: Object.keys(rounds).map(function (k) { return rounds[k]; }).filter(function (r) { return !r.deleted; }),
      matches: Object.keys(matches).map(function (k) { return matches[k]; }).filter(function (m) { return !m.deleted; })
    };
  }

  /* Kuponun bakiyeden bağımsız kural kontrolü; sorun varsa nedenini döndürür */
  function staticCheck(c, ctx) {
    if (c.cancelled) return 'Yönetici iptal etti';
    if (!Array.isArray(c.sel) || !c.sel.length) return 'Boş kupon';
    var stake = num(c.stake, NaN), at = num(c.at, NaN);
    if (!(stake >= ctx.cfg.minStake)) return 'Miktar en az ' + ctx.cfg.minStake + ' olmalı';
    if (!isFinite(at)) return 'Kupon zamanı yok';
    var r = ctx.roundMap[c.round];
    if (!r) return 'Hafta bulunamadı';
    if (r._open === null || at < r._open) return 'Bülten açılmadan oynanmış';
    if (r._close !== null && at >= r._close) return 'Hafta kapandıktan sonra oynanmış';
    var seen = {}, mbs = 1;
    for (var i = 0; i < c.sel.length; i++) {
      var s = c.sel[i], m = ctx.M[s.m];
      if (!m) return 'Maç bültende yok';
      if (m.round !== c.round) return 'Maç bu haftaya ait değil';
      if (seen[s.m]) return 'Aynı maçtan iki seçim';
      seen[s.m] = true;
      if (!(num(m.kickoff, 0) > at)) return 'Maç başladıktan sonra oynanmış';
      if (!MK[s.mk]) return 'Bilinmeyen bahis türü';
      if (!oddsOk(m, s)) return 'Oran bültenle uyuşmuyor';
      mbs = Math.max(mbs, num(m.mbs, 1));
    }
    if (c.sel.length < mbs) return 'MBS ' + mbs + ': en az ' + mbs + ' maç gerekli';
    return null;
  }

  function evalCoupon(c, ctx) {
    var lostAt = Infinity, doneAt = 0, pending = false, eff = 1, anyWon = false, marks = [];
    var stake = num(c.stake, 0);
    c.sel.forEach(function (s) {
      var m = ctx.M[s.m];
      var o = selOutcome(m, s);
      var t = m ? Math.min(num(m.doneAt, num(m.kickoff, 0) + SETTLE_FALLBACK), ctx.now) : ctx.now;
      marks.push(o);
      if (o === 'lost') lostAt = Math.min(lostAt, t);
      else if (o === 'pending') pending = true;
      else {
        doneAt = Math.max(doneAt, t);
        if (o === 'won') { eff *= num(s.odd, 1); anyWon = true; }
      }
    });
    var total = r2(c.sel.reduce(function (p, s) { return p * num(s.odd, 1); }, 1));
    var potential = r2(stake * total);
    if (lostAt < Infinity) return { status: 'lost', at: lostAt, payout: 0, total: total, eff: 0, marks: marks, potential: potential };
    if (pending) return { status: 'pending', total: total, marks: marks, potential: potential };
    if (!anyWon) return { status: 'refund', at: doneAt, payout: r2(stake), total: total, eff: 1, marks: marks, potential: potential };
    var effR = r2(eff);
    return { status: 'won', at: doneAt, payout: r2(stake * effR), total: total, eff: effR, marks: marks, potential: potential };
  }

  var PRI = { start: 0, open: 1, adj: 2, bet: 3, pay: 4, close: 5 };
  function cmpEv(a, b) { return (a.t - b.t) || (PRI[a.ty] - PRI[b.ty]); }

  /* Bir oyuncunun tüm hesap hareketlerini zaman sırasıyla işler */
  function ledger(p, ctx) {
    var now = ctx.now, cfg = ctx.cfg;
    var joined = num(p.joinedAt, 0);
    var ev = [{ t: joined, ty: 'start' }];
    ctx.rounds.forEach(function (r) {
      if (r._open === null || r._open > now) return;
      if (r._close !== null && r._close <= joined) return;
      ev.push({ t: Math.max(r._open, joined), ty: 'open', r: r });
      if (r._close !== null && r._close <= now) ev.push({ t: r._close, ty: 'close', r: r });
    });
    ctx.adjust.forEach(function (a) {
      if (a.player === p.id) ev.push({ t: num(a.at, 0), ty: 'adj', a: a });
    });
    var coupons = [];
    (ctx.couponsBy[p.id] || []).forEach(function (c) {
      var cc = { id: c.id, at: num(c.at, 0), round: c.round, stake: num(c.stake, 0), sel: Array.isArray(c.sel) ? c.sel : [], cancelled: !!c.cancelled };
      coupons.push(cc);
      ev.push({ t: cc.at, ty: 'bet', c: cc });
    });
    ev.sort(cmpEv);

    var bal = 0, rinfo = {}, cs = {}, bestWin = 0, nWon = 0, nLost = 0, nPend = 0, staked = 0, returned = 0, pens = 0;
    for (var i = 0; i < ev.length; i++) {
      var e = ev[i];
      if (e.ty === 'start') {
        bal = r2(bal + cfg.start);
      } else if (e.ty === 'open') {
        var before = bal;
        bal = r2(bal + cfg.bonus);
        rinfo[e.r.id] = { before: before, bonus: cfg.bonus, req: r2(bal * cfg.ratio), staked: 0, pen: 0, won: 0, closed: false, n: 0 };
      } else if (e.ty === 'adj') {
        bal = r2(bal + num(e.a.amount, 0));
      } else if (e.ty === 'bet') {
        var c = e.c, ri = rinfo[c.round];
        var reason = staticCheck(c, ctx);
        if (!reason && !ri) reason = 'Bu hafta senin için açık değildi';
        if (!reason && ri.closed) reason = 'Hafta kapanmıştı';
        if (!reason && c.stake > bal + 1e-9) reason = 'Kasa yetersizdi';
        if (reason) { cs[c.id] = { status: 'invalid', reason: reason, total: r2(c.sel.reduce(function (pp, s) { return pp * num(s.odd, 1); }, 1)), marks: c.sel.map(function () { return 'void'; }) }; continue; }
        bal = r2(bal - c.stake);
        ri.staked = r2(ri.staked + c.stake);
        ri.n++;
        staked = r2(staked + c.stake);
        var ec = evalCoupon(c, ctx);
        cs[c.id] = ec;
        if (ec.status === 'won') { nWon++; bestWin = Math.max(bestWin, ec.eff); }
        else if (ec.status === 'lost') nLost++;
        else if (ec.status === 'pending') nPend++;
        if ((ec.status === 'won' || ec.status === 'refund') && ec.at <= now) {
          var pe = { t: Math.max(ec.at, c.at), ty: 'pay', c: c, amt: ec.payout };
          var j = i + 1;
          while (j < ev.length && cmpEv(ev[j], pe) <= 0) j++;
          ev.splice(j, 0, pe);
        }
      } else if (e.ty === 'pay') {
        bal = r2(bal + e.amt);
        returned = r2(returned + e.amt);
        var rw = rinfo[e.c.round];
        if (rw) rw.won = r2(rw.won + e.amt);
      } else if (e.ty === 'close') {
        var rc = rinfo[e.r.id];
        if (rc) {
          rc.closed = true;
          var short = Math.max(0, r2(rc.req - rc.staked));
          var pen = Math.min(short, Math.max(0, bal));
          rc.pen = pen;
          pens = r2(pens + pen);
          bal = r2(bal - pen);
        }
      }
    }
    return { bal: bal, rinfo: rinfo, cs: cs, coupons: coupons, bestWin: bestWin, nWon: nWon, nLost: nLost, nPend: nPend, staked: staked, returned: returned, pens: pens };
  }

  function standings(players, ctx) {
    var rows = players.filter(function (p) { return !p.removed; }).map(function (p) { return { id: p.id, p: p, lg: ledger(p, ctx) }; });
    rows.sort(function (a, b) {
      return (b.lg.bal - a.lg.bal) || (b.lg.bestWin - a.lg.bestWin) || (num(a.p.joinedAt, 0) - num(b.p.joinedAt, 0));
    });
    return rows;
  }

  /* Final sonuçlandı ve bekleyen kupon kalmadıysa oyun bitmiştir */
  function finished(rows, ctx) {
    var fin = ctx.rounds.filter(function (r) { return r.final; });
    if (!fin.length) return false;
    if (!fin.every(function (r) { return r._state === 'done'; })) return false;
    return rows.every(function (row) { return row.lg.nPend === 0; });
  }

  function outLabel(mk, k) {
    var m = MK[mk];
    if (!m) return String(k);
    for (var i = 0; i < m.outs.length; i++) if (m.outs[i][0] === k) return m.outs[i][1];
    return String(k);
  }
  function selLabel(s) {
    var m = MK[s.mk];
    if (!m) return s.mk + ' ' + s.k;
    if (s.mk === 'HND') return 'H(' + s.hcp + ') ' + outLabel(s.mk, s.k);
    return m.short + ' ' + outLabel(s.mk, s.k);
  }

  return {
    MARKETS: MARKETS, MK: MK, DEFAULT_CFG: DEFAULT_CFG,
    num: num, r2: r2, res: res, selOutcome: selOutcome, oddsOk: oddsOk,
    prepare: prepare, mergeData: mergeData, staticCheck: staticCheck, evalCoupon: evalCoupon,
    ledger: ledger, standings: standings, finished: finished,
    selLabel: selLabel, outLabel: outLabel, isSettledStatus: isSettledStatus
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = L;
