// ==UserScript==
// @name         오늘의집 판매량 추적기
// @namespace    ohouse-stock-tracker
// @version      1.5
// @description  오늘의집 상품 옵션별 재고를 매시간 읽어서 판매추정을 깃허브 ohouse 폴더에 기록 (네이버용 추적기와 따로 동작)
// @match        https://store.ohou.se/*
// @match        https://ds4eqm-lgtm.github.io/competitor-stock/ohouse/*
// @grant        GM_xmlhttpRequest
// @grant        window.close
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @connect      api.github.com
// @connect      store.ohou.se
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // ---------------- 여기 세줄만 본인 값으로 바꾸기 (토큰은 네이버용 스크립트와 같은 값) ----------------
  const GITHUB_TOKEN = "";
  const GITHUB_OWNER = "ds4eqm-lgtm";
  const GITHUB_REPO = "competitor-stock";
  // ---------------------------------------------------------------
  const DIR = 'ohouse/'; // 오늘의집 파일은 저장소 ohouse 폴더에만 씀 (네이버 데이터는 안 건드림)

  const DAY_START_HOUR = 7;
  const SPLIT_HOUR = 16;
  const LONG_GAP_HOURS = 16;
  const HISTORY_KEEP_DAYS = 14;
  const REQ_GAP_MS = 1500;   // 상품 하나 읽고 다음 상품까지 쉬는 시간 (+0~1초 랜덤)
  const FINE_STORES = ['도든']; // 10분 조회할 브랜드 (오늘의집 브랜드명 그대로, 여러 개면 ['도든', '룸스토어'])

  const isDashboard = window.location.hostname === `${GITHUB_OWNER}.github.io`;
  const isStore = window.location.hostname === 'store.ohou.se';

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------------- 판매량 계산 (네이버용 스크립트와 같은 방식) ----------------
  function toDate(key) {
    const [d, t = '00:00'] = key.split('T');
    const [y, m, day] = d.split('-').map(Number);
    const [hh, mm] = t.split(':').map(Number);
    return new Date(y, m - 1, day, hh || 0, mm || 0);
  }
  function bizDayOf(dt) {
    const d = new Date(dt);
    if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() - 1);
    return ymd(d);
  }
  function dayWindow(day) {
    const start = toDate(day);
    start.setHours(DAY_START_HOUR, 0, 0, 0);
    const split = new Date(start);
    split.setHours(SPLIT_HOUR, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, split, end };
  }

  const DETECT = { BIG_DROP: 200, BIG_RISE: 200 };
  let unitMap = {}; // { 상품번호: 몇 개가 1박스(또는 1m)인지 } products.txt, units.json 으로 매번 새로 계산
  let optUnitMap = {}; // { 옵션키: 몇 개가 1박스(또는 1m)인지 } 대시보드에서 옵션별로 정한 단위 (링크보다 우선)
  const unitDivOf = (key) => Number(optUnitMap[key]) || Number(unitMap[String(key).split('_')[1]]) || 1;
  const isBig = (key, n, lim) => n / unitDivOf(key) >= lim;

  function computeDay(rec, day, flags, now, key) {
    flags = flags || {};
    const { start, split, end } = dayWindow(day);
    const es = Object.keys(rec).map((t) => ({ t, dt: toDate(t), v: rec[t] })).sort((a, b) => a.dt - b.dt);
    const mk = () => ({ s: 0, u: 0, x: 0, ev: [], up: 0, upEv: [], uEv: [] });
    const all = mk();
    const t1 = mk();
    const t2 = mk();
    let k = null;
    let any = false;
    let base = false;
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (e.dt < start) { base = true; continue; }
      if (e.dt >= end || (now && e.dt > now)) break;
      any = true;
      k = e.v;
      const nx = es[i + 1];
      if (!nx || (now && nx.dt > now)) continue;
      const d = e.v - nx.v;
      const per = e.dt < split ? t2 : t1;
      if (d < 0) {
        if (isBig(key, -d, DETECT.BIG_RISE)) [per, all].forEach((p) => { p.up += -d; p.upEv.push([nx.t, -d, e.v, nx.v]); });
        continue;
      }
      if (d === 0) continue;
      const f = flags[nx.t];
      const gapH = (nx.dt - e.dt) / 3600000;
      [per, all].forEach((p) => {
        if (f) { p.x += d; p.ev.push([nx.t, d, f.why.join(', ')]); }
        else if (gapH > LONG_GAP_HOURS) { p.u += d; p.uEv.push([e.t, nx.t, d]); }
        else p.s += d;
      });
    }
    if (!any) return null;
    return Object.assign(all, { k, base, t1, t2 });
  }

  function detectSuspicious(history) {
    const out = {};
    Object.keys(history).forEach((key) => {
      const rec = history[key] || {};
      const ts = Object.keys(rec).sort();
      for (let i = 1; i < ts.length; i++) {
        const d = rec[ts[i - 1]] - rec[ts[i]];
        if (d > 0 && isBig(key, d, DETECT.BIG_DROP)) {
          (out[key] = out[key] || {})[ts[i]] = {
            d,
            why: [`${rec[ts[i - 1]].toLocaleString()}개에서 ${rec[ts[i]].toLocaleString()}개로 한 번에 ${d.toLocaleString()}개 줄어듦 (${DETECT.BIG_DROP}박스 또는 m 이상)`],
          };
        }
      }
    });
    return out;
  }

  function computeFinishedDays(rec, now, flags, key) {
    const keys = Object.keys(rec).sort();
    if (!keys.length) return {};
    const out = {};
    const today = bizDayOf(now);
    const d = toDate(bizDayOf(toDate(keys[0])));
    for (let guard = 0; guard < 400; guard++) {
      const day = ymd(d);
      if (day >= today) break;
      const r = computeDay(rec, day, flags, now, key);
      if (r) out[day] = r;
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  // ---------------- 깃허브 읽기/쓰기 ----------------
  function ghRequest(method, path, body, accept) {
    const bust = method === 'GET' ? `?t=${Date.now()}${Math.random().toString(36).slice(2, 6)}` : '';
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url: `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}${bust}`,
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          Accept: accept || 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
        nocache: true,
        data: body ? JSON.stringify(body) : undefined,
        timeout: 180000,
        onload: (res) => resolve(res),
        onerror: (err) => reject(err),
        ontimeout: () => reject(new Error('timeout')),
      });
    });
  }

  async function getText(path) {
    const res = await ghRequest('GET', path, null, 'application/vnd.github.raw+json');
    if (res.status === 200) return res.responseText;
    if (res.status === 404) return null;
    const err = new Error(`GET ${path} 실패 status ${res.status}`);
    err.status = res.status;
    throw err;
  }

  async function getJsonFile(path) {
    const res = await ghRequest('GET', path);
    if (res.status === 200) {
      const json = JSON.parse(res.responseText);
      let text;
      if (json.encoding === 'base64' && json.content) {
        text = decodeURIComponent(escape(atob(json.content.replace(/\n/g, ''))));
      } else {
        const raw = await ghRequest('GET', path, null, 'application/vnd.github.raw+json');
        if (raw.status !== 200) throw new Error(`GET raw ${path} 실패 status ${raw.status}`);
        text = raw.responseText;
      }
      return { content: JSON.parse(text || '{}'), sha: json.sha };
    }
    if (res.status === 404) return { content: {}, sha: null };
    const err = new Error(`GET ${path} 실패 status ${res.status}`);
    err.status = res.status;
    throw err;
  }

  function encodeContent(obj) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
  }

  function compactDay(r) {
    const out = {};
    ['s', 'u', 'k', 'x', 'up'].forEach((f) => { if (r[f]) out[f] = r[f]; });
    if (r.k === 0) out.k = 0;
    if (r.ev && r.ev.length) out.ev = r.ev;
    if (r.upEv && r.upEv.length) out.upEv = r.upEv;
    if (r.t1) out.t1 = compactDay(r.t1);
    if (r.t2) out.t2 = compactDay(r.t2);
    return out;
  }

  async function updateJsonFile(path, mutateFn, message) {
    const MAX_ATTEMPTS = 20;
    let lastError = '';
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const { content, sha } = await getJsonFile(path);
        const updated = mutateFn(content);
        const res = await ghRequest('PUT', path, { message, content: encodeContent(updated), sha: sha || undefined });
        if (res.status === 200 || res.status === 201) return;
        lastError = `status ${res.status} ${String(res.responseText).slice(0, 200)}`;
        if (res.status === 401 || res.status === 403) throw new Error(`PUT ${path} 권한 오류 ${lastError}`);
      } catch (e) {
        if (String(e.message || '').includes('권한 오류')) throw e;
        if (e.status === 401 || e.status === 403) throw e;
        lastError = e.message || String(e);
      }
      console.log(`[오늘의집추적] ${path} 저장 재시도 ${attempt + 1} (${lastError})`);
      await sleep(Math.min(6000, 500 * 2 ** attempt) + Math.random() * 1500);
    }
    throw new Error(`PUT ${path} 재시도 초과 (${lastError})`);
  }

  // entry = { channelId, productNo, storeName, productName, nowKey, today, options: [{id, name, stock, price}] }
  async function uploadEntries(entries, couponInfo) {
    if (!entries.length) return;
    const runStart = {}; // { 상품번호: 지금 걸린 쿠폰이 처음 보인 시각 } 새 쿠폰 시작일 채우기용
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - HISTORY_KEEP_DAYS);
    const cutoffStr = ymd(cutoff);
    const dailyMap = {};
    const keyOf = (en, opt) => `${en.channelId}_${en.productNo}_${opt.id}`;
    const label = `${entries.length}개 상품`;
    const stamp = entries[entries.length - 1].nowKey;

    await updateJsonFile(`${DIR}data/history.json`, (history) => {
      entries.forEach((en) => en.options.forEach((opt) => {
        const key = keyOf(en, opt);
        const rec = history[key] || {};
        rec[en.nowKey] = opt.stock;
        history[key] = rec;
      }));
      const flags = detectSuspicious(history);
      const keys = new Set();
      entries.forEach((en) => en.options.forEach((opt) => keys.add(keyOf(en, opt))));
      keys.forEach((key) => {
        const rec = history[key];
        dailyMap[key] = computeFinishedDays(rec, now, flags[key] || {}, key);
        Object.keys(rec).forEach((t) => { if (t < cutoffStr) delete rec[t]; });
      });
      return history;
    }, `오늘의집 판매량 업데이트 ${label} ${stamp}`);

    await updateJsonFile(`${DIR}data/latest.json`, (latest) => {
      entries.slice().sort((x, y) => (x.nowKey < y.nowKey ? -1 : x.nowKey > y.nowKey ? 1 : 0)).forEach((en) => en.options.forEach((opt) => {
        const key = keyOf(en, opt);
        const old = latest[key] || {};
        const daily = Object.assign({}, old.daily || {});
        const prices = Object.assign({}, old.prices || {});
        const np = Number(opt.price);
        if (np > 0) {
          const lastDay = Object.keys(prices).sort().pop();
          if (!lastDay || prices[lastDay] !== np) prices[en.today] = np;
        }
        Object.entries(dailyMap[key] || {}).forEach(([day, r]) => {
          if (r.base || !daily[day] || !daily[day].t1) daily[day] = compactDay(r);
        });
        // 가격 상태(정가, 판매가, 쿠폰)가 바뀐 시각만 기록 → 대시보드가 할인 기간을 그림
        const pm = Object.assign({}, old.pm || {});
        if (Array.isArray(opt.pr)) {
          const lk = Object.keys(pm).sort().pop();
          if (!lk || JSON.stringify(pm[lk]) !== JSON.stringify(opt.pr)) pm[en.nowKey] = opt.pr;
          if (opt.pr[2] > 0) {
            const ts = Object.keys(pm).sort();
            let st = en.nowKey;
            for (let i = ts.length - 1; i >= 0 && Number(pm[ts[i]][2]) > 0; i--) st = ts[i];
            if (!runStart[en.productNo] || st < runStart[en.productNo]) runStart[en.productNo] = st;
          }
        }
        latest[key] = {
          store: en.storeName,
          product: en.productNo,
          productName: en.productName,
          optionName: opt.name,
          date: en.today,
          stock: opt.stock,
          price: np > 0 ? np : old.price,
          prices,
          pm,
          daily,
        };
      }));
      return latest;
    }, `오늘의집 판매량 업데이트 ${label} ${stamp.slice(0, 10)}`);

    // 쿠폰 기록 (영구 보관, 지우지 않음): ohouse/data/promos.json
    // coupons { 쿠폰번호: { t 이름, r 할인율, max 최대할인, min 최소주문, dt 할인방식, end 종료시각(한국시간), first 처음 본 시각, last 마지막 본 시각, stores {스토어:1}, pids {상품번호:1} } }
    await updateJsonFile(`${DIR}data/promos.json`, (pr) => {
      pr.coupons = pr.coupons || {};
      entries.forEach((en) => en.options.forEach((opt) => (opt.plans || []).forEach(([id, amt]) => {
        const m = pr.coupons[id] || (pr.coupons[id] = { first: runStart[en.productNo] || en.nowKey, stores: {}, pids: {} });
        if (!m.last || en.nowKey > m.last) m.last = en.nowKey;
        if (runStart[en.productNo] && runStart[en.productNo] < m.first) m.first = runStart[en.productNo];
        m.stores[en.storeName] = 1;
        m.pids[en.productNo] = 1;
        if (!m.r && opt.price > 0 && amt > 0) m.r = Math.round((amt / opt.price) * 100);
      })));
      Object.entries(couponInfo || {}).forEach(([id, c]) => {
        const m = pr.coupons[id] || (pr.coupons[id] = { first: stamp, stores: {}, pids: {} });
        if (!m.last || stamp > m.last) m.last = stamp;
        Object.assign(m.stores, c.stores || {});
        Object.assign(m.pids, c.pids || {});
        // 종료일이 늦춰지면 연장 기록
        if (m.end && c.end && c.end > m.end) (m.ext = m.ext || []).push({ at: stamp, from: m.end, to: c.end });
        const { pids: _p, stores: _s, ...rest } = c;
        Object.assign(m, rest);
      });
      pr._meta = { last: stamp };
      return pr;
    }, `오늘의집 쿠폰 기록 ${stamp}`);
  }

  // 쿠폰 전부 읽기 (오늘의집 로그인 필요)
  // 오늘의집은 받은 쿠폰만 이름, 종료일이 보여서, 받을 수 있는 쿠폰이 있으면 '쿠폰 받기'를 대신 눌러서 받은 다음 목록을 읽음 (무료, 결제 없음)
  const toKst = (iso) => { const d = new Date(iso); if (isNaN(d)) return null; return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  async function readCouponInfo(entries, say) {
    const info = {};
    const nowIso = new Date().toISOString();
    const prods = [];
    const seen = new Set();
    entries.forEach((en) => { if (!seen.has(en.productNo)) { seen.add(en.productNo); prods.push({ pid: en.productNo, store: en.storeName, price: (en.options[0] && en.options[0].price) || 0 }); } });
    let login = true, got = 0;
    for (let i = 0; i < prods.length; i++) {
      const p = prods[i];
      if (say) say(`쿠폰 확인 중 ${i + 1}/${prods.length}`);
      try {
        const base = window.location.origin;
        const ap = await fetch(`${base}/api/goods/${p.pid}/applicable-coupons`, { credentials: 'include', cache: 'no-store' });
        if (ap.ok) {
          const aj = await ap.json();
          if (aj && aj.downloadButtonStatus === 'DOWNLOADABLE') {
            const pr = await fetch(`${base}/api/goods/publish-coupons`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ goodsId: Number(p.pid) }) });
            if (pr.status === 401) { login = false; break; }
            await sleep(400);
          }
        }
        const r = await fetch(`${base}/api/goods/${p.pid}/coupons${p.price ? `?price=${p.price}` : ''}`, { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } });
        if (r.status === 401) { login = false; break; }
        if (r.ok) {
          const j = await r.json();
          (j.sections || []).forEach((sec) => (sec.coupons || []).forEach((c) => {
            const id = String(c.couponMoldId || '');
            if (!id) return;
            if (c.endAt && c.endAt < nowIso) return; // 이미 끝난 쿠폰
            const x = info[id] || (info[id] = { pids: {}, stores: {} });
            x.pids[p.pid] = 1;
            x.stores[p.store] = 1;
            Object.assign(x, {
              t: c.title || '',
              amt: c.discountAmount || '',
              dt: c.discountType || '',
              max: Number(c.maximumDiscountAmount) || 0,
              min: Number(c.minimumPayment) || 0,
              end: c.endAt ? toKst(c.endAt) : null,
              kind: c.couponType || sec.couponType || '',
            });
            if (Number(c.discountRatio)) x.r = Number(c.discountRatio);
            got++;
          }));
        }
      } catch (e) { /* 다음 상품 */ }
      await sleep(500 + Math.random() * 600);
    }
    return { info, login, got };
  }

  // ---------------- 상품 목록, 단위 읽기 (products.txt, units.json) ----------------
  // 대시보드와 같은 규칙: 링크 뒤 '9장' → 9개 = 1박스, '20cm' → 5개 = 1m, '1m' → 1개 = 1m, [장판] 아래 기본 10개 = 1m
  const CAT_UNITS = { 장판: 10 };
  function parseProducts(text, override) {
    const list = [];
    const seen = new Set();
    let current = null;
    let firstCat = null;
    String(text || '').replace(/^﻿/, '').split(/\r?\n/).forEach((raw) => {
      const l = raw.trim();
      const h = l.match(/^\[(.+)\]$/);
      if (h) {
        current = h[1].trim();
        if (current !== '휴무일' && current !== '근무일' && !firstCat) firstCat = current;
        return;
      }
      if (current === '휴무일' || current === '근무일') return;
      const m = l.match(/(?:goods|productions)\/(\d+)/);
      if (!m || seen.has(m[1])) return;
      seen.add(m[1]);
      const tail = l.slice(l.indexOf(m[0]) + m[0].length);
      const uj = tail.match(/(\d+)\s*장/);
      const ucm = tail.match(/(\d+(?:\.\d+)?)\s*cm/i);
      const um = tail.match(/(\d+(?:\.\d+)?)\s*m(?![a-z])/i);
      let div = null;
      if (uj && Number(uj[1]) > 1) div = Number(uj[1]);
      else if (ucm && Number(ucm[1]) > 0) div = 100 / Number(ucm[1]);
      else if (um && !ucm && Number(um[1]) > 0) div = 1 / Number(um[1]);
      list.push({ pid: m[1], div, cat: current || null });
    });
    list.forEach((p) => {
      const o = override && override[p.pid];
      const cat = p.cat || firstCat || '데코타일';
      p.div = (o && Number(o.div)) || p.div || CAT_UNITS[cat] || 1;
    });
    return list;
  }

  // ---------------- 오늘의집 옵션 재고 읽기 ----------------
  // 상품 페이지가 쓰는 주소와 같은 곳: store.ohou.se/api/goods/options?id=상품번호
  // stock 이 -1 이면 판매자가 재고 무제한으로 설정한 옵션이라 판매량을 알 수 없어서 뺌
  function fetchOptionsGM(pid) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: `https://store.ohou.se/api/goods/options?id=${pid}`,
        headers: { Accept: 'application/json' },
        anonymous: true,
        timeout: 20000,
        onload: (res) => {
          if (res.status !== 200) { reject(new Error('status ' + res.status)); return; }
          try { resolve(JSON.parse(res.responseText)); } catch (e) { reject(e); }
        },
        onerror: () => reject(new Error('network')),
        ontimeout: () => reject(new Error('timeout')),
      });
    });
  }
  async function fetchOptions(pid) {
    try {
      const r = await fetch(`${window.location.origin}/api/goods/options?id=${pid}`, { credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json' } });
      if (r.ok) return await r.json();
      throw new Error('status ' + r.status);
    } catch (e) {
      return fetchOptionsGM(pid); // 페이지 방식이 안 되면 탬퍼몽키 방식으로 한 번 더
    }
  }

  function toEntry(pid, data, nowKey, today) {
    const pr = (data && data.production) || {};
    const opts = Array.isArray(pr.options) ? pr.options : [];
    let unlimited = 0;
    const options = [];
    opts.forEach((o) => {
      const st = Number(o.stock);
      if (o.stock == null || isNaN(st)) return;
      if (st < 0) { unlimited++; return; }
      const name = [o.explain, o.explain2].filter((x) => x && String(x).trim()).join(' / ') || String(o.id);
      const price = Number((o.price && (o.price.sellingPrice || o.price.salePrice)) || o.sellingCost) || null;
      // 프로모션 확인용 [정가, 판매가, 상품쿠폰 할인액]
      const plans0 = (o.price && Array.isArray(o.price.discountPlans)) ? o.price.discountPlans : [];
      const coupon = plans0.reduce((n, d) => n + (Number(d && d.discountAmount) || 0), 0);
      const pr = [Number(o.price && o.price.regularPrice) || 0, price || 0, coupon];
      const plans = plans0.filter((d) => d && d.planId).map((d) => [String(d.planId), Number(d.discountAmount) || 0, String(d.planType || '')]);
      options.push({ id: String(o.id), name, stock: st, price, pr, plans });
    });
    const brand = pr.brand || {};
    return {
      entry: {
        channelId: 'oh' + (brand.id || 0),
        productNo: String(pid),
        storeName: String(brand.name || '오늘의집').trim(),
        productName: pr.name || `상품 ${pid}`,
        nowKey,
        today,
        options,
      },
      unlimited,
      total: opts.length,
    };
  }

  // ---------------- 매시간 자동 조회 (store.ohou.se/#ohcollect 탭) ----------------
  async function runCollect() {
    if (document.readyState === 'loading') await new Promise((r) => document.addEventListener('DOMContentLoaded', r));
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;background:#0f766e;color:#fff;padding:12px 16px;border-radius:8px;font:14px sans-serif;max-width:420px;line-height:1.5;white-space:pre-line;';
    document.body.appendChild(box);
    const say = (t) => { box.textContent = '[오늘의집 추적] ' + t; console.log('[오늘의집 추적] ' + t); };
    const closeLater = (ms) => setTimeout(() => window.close(), ms);

    // 같은 시간에 두 번 열려도 한 번만 돌게 잠금 (15분)
    const lock = GM_getValue('oh_lock', 0) || 0;
    if (lock > Date.now()) { say('이미 다른 탭에서 조회 중이라 닫아요'); closeLater(3000); return; }
    GM_setValue('oh_lock', Date.now() + 15 * 60000);

    try {
      if (!GITHUB_TOKEN) throw new Error('스크립트 23번째 줄에 깃허브 토큰이 비어 있어요');
      say('상품 목록 읽는 중...');
      const [ptext, utext] = await Promise.all([getText(`${DIR}products.txt`), getText(`${DIR}data/units.json`).catch(() => null)]);
      let override = {};
      try { override = utext ? JSON.parse(utext) || {} : {}; } catch (e) { override = {}; }
      const list = parseProducts(ptext, override);
      unitMap = {};
      list.forEach((p) => { unitMap[p.pid] = p.div; });
      optUnitMap = {};
      Object.keys(override).forEach((k) => { if (k.includes('_') && Number(override[k] && override[k].div) > 0) optUnitMap[k] = Number(override[k].div); });
      if (!list.length) throw new Error('ohouse/products.txt 에 상품 링크가 없어요');

      const now = new Date();
      const today = ymd(now);
      const nowKey = `${today}T${pad(now.getHours())}:00`;
      let fail = 0, failRow = 0, unlimited = 0, skippedAll = 0;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        say(`재고 읽는 중 ${i + 1}/${list.length}`);
        let data = null;
        for (let tr = 0; tr < 2 && !data; tr++) {
          try { data = await fetchOptions(p.pid); } catch (e) { if (tr === 0) await sleep(5000); }
        }
        if (!data) {
          fail++; failRow++;
          if (failRow >= 5) { say('5개 연속 실패, 오늘의집이 막은 것 같아서 이번 조회는 멈춰요'); break; }
        } else {
          failRow = 0;
          const r = toEntry(p.pid, data, nowKey, today);
          unlimited += r.unlimited;
          if (r.entry.options.length) GM_setValue(`ohp_${p.pid}_${nowKey}`, r.entry);
          else skippedAll++;
        }
        await sleep(REQ_GAP_MS + Math.random() * 1000);
      }

      // 이번 결과 + 예전에 못 올리고 남은 결과를 한꺼번에 올림
      const keys = GM_listValues().filter((k) => k.startsWith('ohp_'));
      const entries = keys.map((k) => GM_getValue(k)).filter(Boolean);
      const note = `${unlimited ? `\n재고 무제한(-1) 옵션 ${unlimited}개는 제외` : ''}${skippedAll ? `\n전 옵션 무제한이라 뺀 상품 ${skippedAll}개` : ''}${fail ? `\n못 읽은 상품 ${fail}개` : ''}`;
      if (!entries.length) {
        say('올릴 결과 없음' + note);
      } else {
        let ci = { info: {}, login: true };
        try { ci = await readCouponInfo(entries, (t) => say(t + note)); } catch (e) { /* 쿠폰 정보 없이 계속 */ }
        const note2 = note + (ci.login ? '' : '\n쿠폰 종료일은 오늘의집 로그인이 돼 있어야 읽혀요 (이 크롬에서 오늘의집 로그인 필요)');
        say(`${entries.length}개 상품 깃허브에 올리는 중...` + note2);
        let ok = false, lastErr = '';
        for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
          try { await uploadEntries(entries, ci.info); ok = true; } catch (e) {
            lastErr = (e && e.message) || String(e);
            say(`업로드 실패 ${attempt}/3: ${lastErr}`);
            if (attempt < 3) await sleep(30000);
          }
        }
        if (!ok) {
          box.style.background = '#b91c1c';
          say(`업로드 실패. 결과는 보관했다가 다음 조회 때 같이 올려요. 이 화면을 캡처해서 보내주세요.\n${lastErr}`);
          GM_setValue('oh_lock', 0);
          closeLater(600000);
          return;
        }
        keys.forEach((k) => GM_deleteValue(k));
        say(`${entries.length}개 상품 업로드 완료` + note2);
      }
      GM_setValue('oh_lock', 0);
      closeLater(fail ? 60000 : 6000);
    } catch (e) {
      box.style.background = '#b91c1c';
      say(`오류: ${(e && e.message) || e}\n이 화면을 캡처해서 보내주세요.`);
      GM_setValue('oh_lock', 0);
      closeLater(600000);
    }
  }

  // ---------------- 10분 조회 (store.ohou.se/#ohcollect-fine 탭) ----------------
  // FINE_STORES 브랜드 링크만 읽어서 재고가 바뀐 때만 ohouse/data/history_fine.json 에 기록 (네이버 10분 조회와 같은 방식)
  // 어떤 링크가 도든인지는 매시 조회 결과(latest.json)의 브랜드명으로 찾음 → 새 도든 링크는 다음 매시 조회 뒤부터 10분 조회에 들어감
  async function runFine() {
    if (document.readyState === 'loading') await new Promise((r) => document.addEventListener('DOMContentLoaded', r));
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;background:#1e3a8a;color:#fff;padding:12px 16px;border-radius:8px;font:14px sans-serif;max-width:420px;line-height:1.5;white-space:pre-line;';
    document.body.appendChild(box);
    const say = (t) => { box.textContent = '[오늘의집 10분] ' + t; console.log('[오늘의집 10분] ' + t); };
    const closeLater = (ms) => setTimeout(() => window.close(), ms);
    const lock = GM_getValue('oh_fine_lock', 0) || 0;
    if (lock > Date.now()) { say('이미 다른 탭에서 조회 중이라 닫아요'); closeLater(3000); return; }
    GM_setValue('oh_fine_lock', Date.now() + 5 * 60000);
    try {
      if (!GITHUB_TOKEN) throw new Error('스크립트 23번째 줄에 깃허브 토큰이 비어 있어요');
      say('대상 링크 찾는 중...');
      const [ptext, latestF] = await Promise.all([getText(`${DIR}products.txt`), getJsonFile(`${DIR}data/latest.json`)]);
      const active = new Set(parseProducts(ptext, {}).map((p) => p.pid));
      const pids = [];
      Object.values(latestF.content || {}).forEach((it) => {
        const pid = String(it.product);
        if (FINE_STORES.includes(String(it.store).trim()) && active.has(pid) && !pids.includes(pid)) pids.push(pid);
      });
      const now = new Date();
      const today = ymd(now);
      const nowKey = `${today}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
      let fail = 0;
      for (let i = 0; i < pids.length; i++) {
        say(`재고 읽는 중 ${i + 1}/${pids.length}`);
        let data = null;
        for (let tr = 0; tr < 2 && !data; tr++) {
          try { data = await fetchOptions(pids[i]); } catch (e) { if (tr === 0) await sleep(3000); }
        }
        if (!data) fail++;
        else {
          const r = toEntry(pids[i], data, nowKey, today);
          if (r.entry.options.length) GM_setValue(`ohf_${pids[i]}_${nowKey}`, r.entry);
        }
        if (i < pids.length - 1) await sleep(REQ_GAP_MS + Math.random() * 1000);
      }
      const keys = GM_listValues().filter((k) => k.startsWith('ohf_'));
      const entries = keys.map((k) => GM_getValue(k)).filter(Boolean).sort((a, b) => (a.nowKey < b.nowKey ? -1 : a.nowKey > b.nowKey ? 1 : 0));
      if (!entries.length) {
        say(pids.length ? '올릴 결과 없음' : `${FINE_STORES.join(', ')} 링크가 아직 없음 (매시 조회가 한 번 돈 뒤부터 잡혀요)`);
      } else {
        const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - HISTORY_KEEP_DAYS);
        const cutoffStr = ymd(cutoff);
        say(`${entries.length}개 결과 올리는 중...`);
        await updateJsonFile(`${DIR}data/history_fine.json`, (fine) => {
          entries.forEach((en) => en.options.forEach((opt) => {
            const key = `${en.channelId}_${en.productNo}_${opt.id}`;
            const rec = fine[key] || {};
            const ts = Object.keys(rec).sort();
            const prev = ts.length ? rec[ts[ts.length - 1]] : null;
            if (prev !== opt.stock) rec[en.nowKey] = opt.stock; // 바뀐 때만 기록
            Object.keys(rec).forEach((t) => { if (t < cutoffStr) delete rec[t]; });
            fine[key] = rec;
          }));
          // 마지막으로 10분 조회한 시각 (재고가 안 바뀌어도 대시보드에 최근 확인 시각을 보여주려고)
          fine._meta = { last: entries[entries.length - 1].nowKey, store: FINE_STORES.join(', ') };
          return fine;
        }, `오늘의집 10분 조회 ${FINE_STORES.join(', ')} ${entries[entries.length - 1].nowKey}`);
        keys.forEach((k) => GM_deleteValue(k));
        say(`${pids.length}개 링크 업로드 완료${fail ? `\n못 읽은 링크 ${fail}개` : ''}`);
      }
      GM_setValue('oh_fine_lock', 0);
      closeLater(fail ? 30000 : 4000);
    } catch (e) {
      box.style.background = '#b91c1c';
      say(`오류: ${(e && e.message) || e}\n결과는 보관했다가 다음 10분 조회 때 같이 올려요.`);
      GM_setValue('oh_fine_lock', 0);
      closeLater(120000);
    }
  }

  if (isStore) {
    // bat 이 store.ohou.se/#ohcollect(매시) 또는 #ohcollect-fine(10분) 으로 연 탭에서만 동작. 직접 둘러보는 오늘의집 탭에서는 아무것도 안 함
    let mode = '';
    try {
      if (window.location.hash === '#ohcollect') sessionStorage.setItem('ohcollect', '1');
      if (window.location.hash === '#ohcollect-fine') sessionStorage.setItem('ohcollect', 'fine');
      mode = sessionStorage.getItem('ohcollect') || ''; // 탭이 닫히면 자동으로 지워짐
    } catch (e) {
      mode = window.location.hash === '#ohcollect' ? '1' : window.location.hash === '#ohcollect-fine' ? 'fine' : '';
    }
    if (mode === '1') runCollect();
    else if (mode === 'fine') runFine();
    return;
  }

  // ---------------- 오늘의집 대시보드 연결 (판매 인정 내역을 ohouse/data/approved.json 에 저장) ----------------
  if (isDashboard) {
    const reply = (msg) => window.postMessage(Object.assign({ from: 'oh-tracker' }, msg), '*');
    window.addEventListener('message', async (ev) => {
      const m = ev.data;
      if (!m || m.from !== 'oh-dashboard') return;
      if (m.type === 'ping') { reply({ type: 'pong', token: GITHUB_TOKEN }); return; }
      if (m.type === 'approve') {
        try {
          let result = {};
          const ids = m.ids || [];
          await updateJsonFile(`${DIR}data/approved.json`, (obj) => {
            ids.forEach((id) => { if (m.on) obj[id] = ymd(new Date()); else delete obj[id]; });
            result = obj;
            return obj;
          }, `오늘의집 판매 인정 ${m.on ? '추가' : '취소'} ${ids.length}건`);
          reply({ type: 'approved', ok: true, approved: result });
        } catch (e) {
          reply({ type: 'approved', ok: false, error: String((e && e.message) || e) });
        }
      }
    });
    reply({ type: 'pong' });
  }
})();
