/* app.js — 晴雨录 主逻辑(城市详情 / 城市对比双视图)
 * 纯前端:浏览器直连 Open-Meteo 公开 API(CORS 全放行,无需 API Key,无需后端)。
 */
'use strict';

/* ================= 常量 ================= */
const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const WEATHER_MIN = '1940-01-01';
const AQ_START = '2021-09-27';
const DAILY_VARS = 'temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum';
const AIR_VARS_FULL = 'pm2_5,pm10,nitrogen_dioxide,sulphur_dioxide,ozone,carbon_monoxide,us_aqi';
const AIR_VARS_LITE = 'pm2_5,pm10,us_aqi';

const PALETTE = ['#2563eb', '#e2574c', '#16a34a', '#f59e0b', '#8b5cf6', '#0ea5e9', '#ec4899', '#14b8a6'];

const PRESETS = [
  ['北京', 39.9042, 116.4074, 'Asia/Shanghai', '中国'],
  ['上海', 31.2304, 121.4737, 'Asia/Shanghai', '中国'],
  ['广州', 23.1291, 113.2644, 'Asia/Shanghai', '中国'],
  ['深圳', 22.5431, 114.0579, 'Asia/Shanghai', '中国'],
  ['成都', 30.5728, 104.0668, 'Asia/Shanghai', '中国'],
  ['杭州', 30.2741, 120.1551, 'Asia/Shanghai', '中国'],
  ['武汉', 30.5928, 114.3055, 'Asia/Shanghai', '中国'],
  ['东京', 35.6762, 139.6503, 'Asia/Tokyo', '日本'],
  ['伦敦', 51.5074, -0.1278, 'Europe/London', '英国'],
  ['纽约', 40.7128, -74.006, 'America/New_York', '美国'],
];

const RANGE_CHIPS = [
  ['近7天', -6, 0], ['近30天', -29, 0], ['近90天', -89, 0], ['近1年', -364, 0],
  ['未来7天', 0, 7], ['未来16天', 1, 16],
];

const POLL = [
  { key: 'pm25', label: 'PM2.5', color: '#f59e0b' },
  { key: 'pm10', label: 'PM10', color: '#8b5cf6' },
  { key: 'no2', label: 'NO₂', color: '#14b8a6' },
  { key: 'so2', label: 'SO₂', color: '#f43f5e' },
  { key: 'o3', label: 'O₃', color: '#22c55e' },
  { key: 'co', label: 'CO', color: '#64748b' },
];

/* 中国 AQI 等级(HJ 633-2012) */
const AQI_LEVELS = [
  { max: 50, label: '优', color: '#00b050' },
  { max: 100, label: '良', color: '#e5b800' },
  { max: 150, label: '轻度污染', color: '#ff7e00' },
  { max: 200, label: '中度污染', color: '#ef4444' },
  { max: 300, label: '重度污染', color: '#99004d' },
  { max: Infinity, label: '严重污染', color: '#7e0023' },
];
const AQI_BANDS = (() => {
  const out = [];
  let prev = 0;
  for (const l of AQI_LEVELS) {
    out.push({ from: prev, to: Math.min(l.max, 500), color: l.color, label: l.label });
    prev = l.max;
  }
  return out;
})();

/* 中国 AQI 计算(HJ 633-2012 分段线性;输入为 24 小时均值浓度,CO 单位为 mg/m³) */
const CN_BPS = [
  ['pm25', [0, 35, 75, 115, 150, 250, 350, 500]],
  ['pm10', [0, 50, 150, 250, 350, 420, 500, 600]],
  ['so2', [0, 50, 150, 475, 800, 1600, 2100, 2620]],
  ['no2', [0, 40, 80, 180, 280, 565, 750, 940]],
  ['o3', [0, 100, 160, 215, 265, 800]],
  ['co', [0, 2, 4, 14, 24, 36, 48, 60]],
];
const CN_ILO = [0, 50, 100, 150, 200, 300, 400, 500];
function computeCnAqi(c) {
  let best = null;
  for (const [k, bp] of CN_BPS) {
    const v = c[k];
    if (v === null || v === undefined || Number.isNaN(v)) continue;
    let i = bp.length - 2;
    for (let j = 0; j < bp.length - 1; j++) { if (v <= bp[j + 1]) { i = j; break; } }
    const iaqi = ((CN_ILO[i + 1] - CN_ILO[i]) / (bp[i + 1] - bp[i])) * (v - bp[i]) + CN_ILO[i];
    if (best === null || iaqi > best) best = iaqi;
  }
  return best === null ? null : Math.round(best);
}
function aqiLevel(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  return AQI_LEVELS.find(l => v <= l.max) || AQI_LEVELS[AQI_LEVELS.length - 1];
}

/* ================= 工具函数 ================= */
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
/* 十六进制颜色 → rgba(用于按城市色生成标题背景) */
function hexToRgba(hex, a) {
  const h = String(hex || '#2563eb').replace('#', '');
  const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const r = parseInt(n.slice(0, 2), 16) || 0;
  const g = parseInt(n.slice(2, 4), 16) || 0;
  const b = parseInt(n.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${a})`;
}
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, k) { const x = new Date(d); x.setDate(x.getDate() + k); return x; }
function fmtYMD(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function parseYMD(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function daySpan(s, e) { return Math.round((parseYMD(e) - parseYMD(s)) / 86400000) + 1; }
function clampDays(v, a, b) { return Math.max(a, Math.min(b, v)); }
const r1 = v => (v == null ? null : Math.round(v * 10) / 10);
function avg(arr) { if (!arr) return null; let s = 0, c = 0; for (const v of arr) if (v != null && !Number.isNaN(v)) { s += v; c++; } return c ? s / c : null; }
function minA(arr) { if (!arr) return null; let m = null; for (const v of arr) if (v != null && !Number.isNaN(v) && (m === null || v < m)) m = v; return m; }
function maxA(arr) { if (!arr) return null; let m = null; for (const v of arr) if (v != null && !Number.isNaN(v) && (m === null || v > m)) m = v; return m; }
function sumA(arr) { if (!arr) return null; let s = 0; for (const v of arr) if (v != null && !Number.isNaN(v)) s += v; return s; }
function fmtOr(v) { return v == null ? '—' : r1(v); }
function safeName(s) { return String(s).replace(/[\\/:*?"<>|]/g, '_'); }

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

let toastTimer = null;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}

/* ================= 状态 ================= */
function defaultState() {
  const today = startOfDay(new Date());
  return { cities: [], start: fmtYMD(addDays(today, -29)), end: fmtYMD(today), view: 'cities', data: {} };
}
let state = defaultState();
(function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem('ws_state_v1') || 'null');
    if (s && Array.isArray(s.cities) && s.start && s.end) {
      state = { ...defaultState(), ...s, data: {} };
      state.cities.forEach(c => { if (c.compare === undefined) c.compare = true; });
      if (state.view !== 'compare') state.view = 'cities';
    }
  } catch (e) { /* 忽略 */ }
})();
function saveState() {
  try {
    localStorage.setItem('ws_state_v1', JSON.stringify({ cities: state.cities, start: state.start, end: state.end, view: state.view }));
  } catch (e) { /* 忽略 */ }
}

/* ================= API 调用 ================= */
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function geocodeCity(q) {
  const j = await fetchJSON(`${GEO_URL}?name=${encodeURIComponent(q)}&count=8&language=zh&format=json`);
  return (j.results || []).map(r => ({
    name: r.name, admin1: r.admin1 || '', country: r.country || '',
    lat: r.latitude, lon: r.longitude, tz: r.timezone || '',
  }));
}

/* 天气:历史(archive)+近期/预报(forecast)拼接,按需附带每小时气温 */
async function fetchWeather(city, start, end) {
  const today = startOfDay(new Date());
  const t92 = addDays(today, -92);
  const s = parseYMD(start), e = parseYMD(end);
  const withHourly = daySpan(start, end) <= 10;
  const parts = [];
  if (s <= addDays(today, -6)) {
    const aEnd = e <= addDays(today, -6) ? e : addDays(today, -6);
    parts.push(await fetchJSON(`${ARCHIVE_URL}?latitude=${city.lat}&longitude=${city.lon}&start_date=${fmtYMD(s)}&end_date=${fmtYMD(aEnd)}&daily=${DAILY_VARS}${withHourly ? '&hourly=temperature_2m' : ''}&timezone=auto`));
  }
  if (e > addDays(today, -6)) {
    const past = clampDays(Math.round((today - (s > t92 ? s : t92)) / 86400000), 0, 92);
    const fore = clampDays(Math.round((e - today) / 86400000), 0, 16);
    const url = `${FORECAST_URL}?latitude=${city.lat}&longitude=${city.lon}&past_days=${past}&forecast_days=${fore}&daily=${DAILY_VARS}${withHourly ? '&hourly=temperature_2m' : ''}&timezone=auto`;
    try {
      parts.push(await fetchJSON(url));
    } catch (err) {
      if (past === 0 && fore > 0) parts.push(await fetchJSON(url.replace('past_days=0', 'past_days=1')));
      else throw err;
    }
  }
  const daily = mergeDaily(parts, start, end);
  const hourly = withHourly ? mergeHourlyTemp(parts, start, end) : null;
  return { daily, hourly, tz: (parts[0] && parts[0].timezone) || '', raw: parts };
}

function mergeDaily(parts, sStr, eStr) {
  const out = { time: [], tmax: [], tmin: [], tmean: [], precip: [] };
  const seen = new Set();
  for (const p of parts) {
    const d = p.daily || {};
    (d.time || []).forEach((t, i) => {
      if (t < sStr || t > eStr || seen.has(t)) return;
      seen.add(t);
      out.time.push(t);
      out.tmax.push(d.temperature_2m_max?.[i] ?? null);
      out.tmin.push(d.temperature_2m_min?.[i] ?? null);
      out.tmean.push(d.temperature_2m_mean?.[i] ?? null);
      out.precip.push(d.precipitation_sum?.[i] ?? null);
    });
  }
  return out;
}
function mergeHourlyTemp(parts, sStr, eStr) {
  const out = { time: [], temp: [] };
  const seen = new Set();
  for (const p of parts) {
    const h = p.hourly || {};
    (h.time || []).forEach((t, i) => {
      const day = t.slice(0, 10);
      if (day < sStr || day > eStr || seen.has(t)) return;
      seen.add(t);
      out.time.push(t);
      out.temp.push(h.temperature_2m?.[i] ?? null);
    });
  }
  return out;
}

/* 空气质量:历史 + 近期/预报拼接;跨度超 1 年只加载核心变量以减小体积 */
async function fetchAir(city, start, end) {
  const today = startOfDay(new Date());
  const t92 = addDays(today, -92);
  let s = parseYMD(start), e = parseYMD(end);
  const notes = [];
  if (s < parseYMD(AQ_START)) { notes.push(`空气质量历史数据自 ${AQ_START} 起开放(不同地点实际起始时间不同)`); s = parseYMD(AQ_START); }
  const aqMaxEnd = addDays(today, 5);
  if (e > aqMaxEnd) notes.push(`空气质量预报最多约 5 天(至 ${fmtYMD(aqMaxEnd)})`);
  if (s > aqMaxEnd) { notes.push('所选时段超出空气质量预报范围'); return { hourly: null, notes, raw: [] }; }
  if (s > e) { notes.push('所选区间早于空气质量数据起始时间,无空气质量数据'); return { hourly: null, notes, raw: [] }; }
  const lite = daySpan(fmtYMD(s), fmtYMD(e)) > 366;
  const vars = lite ? AIR_VARS_LITE : AIR_VARS_FULL;
  if (lite) notes.push('时间跨度超过 1 年,仅加载 PM2.5 / PM10 / 美国 AQI');
  const parts = [];
  if (s <= addDays(today, -3)) {
    const aEnd = e <= addDays(today, -3) ? e : addDays(today, -3);
    try {
      parts.push(await fetchJSON(`${AIR_URL}?latitude=${city.lat}&longitude=${city.lon}&start_date=${fmtYMD(s)}&end_date=${fmtYMD(aEnd)}&hourly=${vars}&timezone=auto`));
    } catch (err) {
      notes.push('空气质量历史数据请求失败:' + err.message);
    }
  }
  if (e > addDays(today, -3)) {
    const past = clampDays(Math.round((today - (s > t92 ? s : t92)) / 86400000), 0, 92);
    const fore = clampDays(Math.round((e - today) / 86400000), 0, 5);
    const url = `${AIR_URL}?latitude=${city.lat}&longitude=${city.lon}&past_days=${past}&forecast_days=${fore}&hourly=${vars}&timezone=auto`;
    try {
      parts.push(await fetchJSON(url));
    } catch (err) {
      if (past === 0 && fore > 0) {
        try { parts.push(await fetchJSON(url.replace('past_days=0', 'past_days=1'))); }
        catch (e2) { notes.push('空气质量数据请求失败:' + e2.message); }
      } else notes.push('空气质量数据请求失败:' + err.message);
    }
  }
  const hourly = mergeAirHourly(parts, fmtYMD(s), fmtYMD(e));
  if (hourly && hourly.time.length) {
    let firstNonNull = -1;
    for (let i = 0; i < hourly.time.length; i++) {
      if (hourly.pm25[i] !== null && hourly.pm25[i] !== undefined) { firstNonNull = i; break; }
    }
    if (firstNonNull > 0) notes.push(`该地点空气质量数据实际自 ${hourly.time[firstNonNull].slice(0, 10)} 起可用`);
    if (firstNonNull === -1) notes.push('该地点/时段无空气质量数据');
  } else if (!notes.length) {
    notes.push('该地点/时段无空气质量数据');
  }
  return { hourly, notes, raw: parts };
}

function mergeAirHourly(parts, sStr, eStr) {
  const out = { time: [], pm25: [], pm10: [], no2: [], so2: [], o3: [], co: [], usAqi: [] };
  const seen = new Set();
  const map = { pm2_5: 'pm25', pm10: 'pm10', nitrogen_dioxide: 'no2', sulphur_dioxide: 'so2', ozone: 'o3', carbon_monoxide: 'co', us_aqi: 'usAqi' };
  for (const p of parts) {
    const h = p.hourly || {};
    (h.time || []).forEach((t, i) => {
      const day = t.slice(0, 10);
      if (day < sStr || day > eStr || seen.has(t)) return;
      seen.add(t);
      out.time.push(t);
      for (const [src, dst] of Object.entries(map)) out[dst].push(h[src]?.[i] ?? null);
    });
  }
  return out;
}

/* 小时数据 → 日均值 + 中国 AQI */
function dailyAgg(hourly) {
  const out = { time: [], pm25: [], pm10: [], no2: [], so2: [], o3: [], co: [], usAqi: [], cnAqi: [] };
  if (!hourly || !hourly.time.length) return out;
  const keys = ['pm25', 'pm10', 'no2', 'so2', 'o3', 'co'];
  const acc = new Map();
  for (let i = 0; i < hourly.time.length; i++) {
    const day = hourly.time[i].slice(0, 10);
    if (!acc.has(day)) acc.set(day, { sums: {}, cnt: {}, us: { s: 0, c: 0 } });
    const a = acc.get(day);
    for (const k of keys) {
      const v = hourly[k] ? hourly[k][i] : null;
      if (v === null || v === undefined || Number.isNaN(v)) continue;
      a.sums[k] = (a.sums[k] || 0) + v;
      a.cnt[k] = (a.cnt[k] || 0) + 1;
    }
    const u = hourly.usAqi ? hourly.usAqi[i] : null;
    if (u !== null && u !== undefined && !Number.isNaN(u)) { a.us.s += u; a.us.c++; }
  }
  for (const [day, a] of acc) {
    const m = k => (a.cnt[k] ? a.sums[k] / a.cnt[k] : null);
    const c = { pm25: m('pm25'), pm10: m('pm10'), no2: m('no2'), so2: m('so2'), o3: m('o3'), co: m('co') != null ? m('co') / 1000 : null };
    out.time.push(day);
    for (const k of keys) out[k].push(m(k));
    out.usAqi.push(a.us.c ? Math.round((a.us.s / a.us.c) * 10) / 10 : null);
    out.cnAqi.push(computeCnAqi(c));
  }
  return out;
}

/* ================= 加载城市数据 ================= */
async function loadCity(city) {
  const prev = state.data[city.id];
  const d = state.data[city.id] = {
    status: 'loading', weather: null, air: null, airDaily: null,
    weatherError: null, airError: null,
    pollVis: (prev && prev.pollVis) ? prev.pollVis : { pm25: true, pm10: true, no2: false, so2: false, o3: false, co: false },
    token: ((prev && prev.token) || 0) + 1,
    fetchedAt: Date.now(),
  };
  const token = d.token;
  renderCardStatus(city);
  const [w, a] = await Promise.allSettled([
    fetchWeather(city, state.start, state.end),
    fetchAir(city, state.start, state.end),
  ]);
  if (token !== state.data[city.id].token) return; // 已有更新的请求,丢弃本次结果
  if (w.status === 'fulfilled') d.weather = w.value; else d.weatherError = (w.reason && w.reason.message) || '未知错误';
  if (a.status === 'fulfilled') d.air = a.value; else d.airError = (a.reason && a.reason.message) || '未知错误';
  if (!d.weather && !d.air) { d.status = 'error'; renderCardStatus(city); return; }
  d.status = 'done';
  d.airDaily = (d.air && d.air.hourly) ? dailyAgg(d.air.hourly) : { time: [], pm25: [], pm10: [], no2: [], so2: [], o3: [], co: [], usAqi: [], cnAqi: [] };
  renderCard(city);
  renderCompare();
}

function renderCardStatus(city) {
  const card = document.querySelector(`.card[data-id="${city.id}"]`);
  if (!card) return;
  const d = state.data[city.id];
  const stats = card.querySelector('.stats');
  if (d.status === 'loading') {
    stats.innerHTML = `<div class="loading"><span class="spinner"></span>正在加载 ${escHtml(city.name)} 的天气与空气质量数据…</div>`;
  } else if (d.status === 'error') {
    stats.innerHTML = `<div class="error-box">加载失败:${escHtml(d.weatherError || d.airError || '未知错误')} <button class="btn small" data-act="reload">重试</button></div>`;
  }
}

/* ================= 卡片渲染 ================= */
function cardShellHTML(city) {
  const tint1 = hexToRgba(city.color, 0.18);
  const tint2 = hexToRgba(city.color, 0.03);
  const tintLine = hexToRgba(city.color, 0.38);
  return `
  <article class="card" data-id="${city.id}" style="--cc:${city.color}">
    <header class="card-head" style="background:linear-gradient(180deg,${tint1},${tint2});border-bottom:1px solid ${tintLine}">
      <span class="dot" style="background:${city.color}"></span>
      <div class="title">
        <h3>${escHtml(city.name)}</h3>
        <p>${escHtml([city.admin1, city.country].filter(Boolean).join(' · '))} · ${city.lat.toFixed(2)}, ${city.lon.toFixed(2)}${city.tz ? ' · ' + escHtml(city.tz) : ''}</p>
      </div>
      <div class="head-actions">
        <button class="btn ghost small" data-act="reload" title="重新加载">↻</button>
        <button class="btn ghost small" data-act="remove" title="移除城市">✕</button>
      </div>
    </header>
    <div class="body">
      <div class="stats"></div>
      <div class="charts">
        <div class="chart-wrap"><div class="chart-temp"></div></div>
        <div class="chart-wrap"><div class="chart-precip"></div></div>
        <div class="chart-wrap"><div class="chart-aqi"></div></div>
        <div class="chart-wrap"><div class="chart-poll"></div></div>
      </div>
      <div class="poll-legend"></div>
      <div class="note"></div>
      <div class="downloads">
        <button class="btn primary" data-act="json">⬇ 下载 JSON</button>
        <button class="btn primary" data-act="csv">⬇ 下载 CSV</button>
        <button class="btn primary" data-act="svg">⬇ 下载 SVG</button>
      </div>
    </div>
  </article>`;
}

function rebuildCards() {
  const el = document.getElementById('cards');
  el.innerHTML = state.cities.map(cardShellHTML).join('');
}

/* 按卡片实际宽度渲染图表,避免窄窗口下字号被整体缩小 */
function chartWidth(card) {
  const probe = card && card.querySelector('.chart-temp');
  const w = probe ? probe.clientWidth : 0;
  return Math.max(520, Math.floor(w)) || 960;
}

function renderCard(city) {
  const card = document.querySelector(`.card[data-id="${city.id}"]`);
  if (!card) return;
  const d = state.data[city.id];
  const body = card.querySelector('.body');
  if (!d || d.status !== 'done') { if (d) renderCardStatus(city); return; }
  const cw = chartWidth(card);
  body.querySelector('.stats').innerHTML = statsHTML(city, d);
  body.querySelector('.note').innerHTML = noteHTML(city, d);
  const t = tempChartOpts(city, d); t.width = cw;
  body.querySelector('.chart-temp').replaceChildren(buildChart(t).svg);
  const p = precipChartOpts(city, d); p.width = cw;
  body.querySelector('.chart-precip').replaceChildren(buildChart(p).svg);
  const q = aqiChartOpts(city, d); q.width = cw;
  body.querySelector('.chart-aqi').replaceChildren(buildChart(q).svg);
  renderPollChart(city, card, cw);
  renderPollLegend(city, card);
}

function statsHTML(city, d) {
  const w = d.weather;
  if (!w) return '';
  const mean = avg(w.daily.tmean), mn = minA(w.daily.tmin), mx = maxA(w.daily.tmax), prec = sumA(w.daily.precip);
  const a = d.airDaily || { pm25: [], cnAqi: [] };
  const pm = avg(a.pm25), aqi = avg(a.cnAqi);
  const lvl = aqiLevel(aqi);
  const chip = (label, val, unit, color) =>
    `<span class="stat"><b style="${color ? 'color:' + color : ''}">${val == null ? '—' : val}</b>${unit || ''}<i>${label}</i></span>`;
  let html = '';
  html += chip('平均气温', r1(mean), '°C');
  html += chip('最高 / 最低', mx == null ? '—' : r1(mx) + ' / ' + r1(mn), '°C');
  html += chip('累计降水', r1(prec), ' mm');
  html += chip('PM2.5 均值', r1(pm), ' µg/m³');
  html += chip('中国AQI均值', aqi == null ? '—' : Math.round(aqi), '', lvl ? lvl.color : '');
  if (lvl) html += `<span class="stat level" style="background:${lvl.color}22;color:${lvl.color};border-color:${lvl.color}66"><b>${lvl.label}</b></span>`;
  return html;
}

function noteHTML(city, d) {
  const parts = [];
  const w = d.weather, a = d.air;
  if (w && w.daily.time.length) {
    parts.push(`天气:${w.daily.time[0]} ~ ${w.daily.time[w.daily.time.length - 1]},共 ${w.daily.time.length} 天${w.hourly ? '(含每小时气温)' : ''}`);
  }
  if (w && !w.daily.time.length) parts.push('该时段无天气数据');
  if (a) {
    if (a.hourly && a.hourly.time.length) parts.push(`空气质量:${a.hourly.time[0].slice(0, 10)} ~ ${a.hourly.time[a.hourly.time.length - 1].slice(0, 10)}`);
    (a.notes || []).forEach(n => parts.push(n));
  }
  parts.push('中国AQI 按 HJ 633-2012 由污染物浓度估算(24 小时均值口径近似)');
  parts.push(`更新于 ${new Date(d.fetchedAt).toLocaleString()}`);
  return parts.map(p => `<span>· ${escHtml(p)}</span>`).join('');
}

/* ---- 各图表配置 ---- */
function dailyXFmt(labels) {
  const crossYear = labels.length > 1 && labels[0].slice(0, 4) !== labels[labels.length - 1].slice(0, 4);
  return t => (crossYear ? t.slice(2, 10) : t.slice(5, 10));
}
const hourlyXFmt = t => `${t.slice(5, 10)} ${t.slice(11, 13)}时`;

function emptyChartOpts(title, height) {
  return { labels: [], series: [], title: title, height: height || 320, legend: false };
}

function tempChartOpts(city, d) {
  const w = d.weather;
  if (!w || !w.daily.time.length) return emptyChartOpts('温度变化');
  const span = daySpan(state.start, state.end);
  let labels, xFmt, series;
  if (w.hourly && w.hourly.time.length >= 2 && span <= 10) {
    labels = w.hourly.time;
    xFmt = hourlyXFmt;
    const di = new Map();
    w.daily.time.forEach((t, i) => di.set(t, i));
    const band = w.hourly.time.map(t => { const i = di.get(t.slice(0, 10)); return i == null ? null : [w.daily.tmin[i], w.daily.tmax[i]]; });
    const meanLine = w.hourly.time.map(t => { const i = di.get(t.slice(0, 10)); return i == null ? null : w.daily.tmean[i]; });
    series = [
      { label: '最低 / 最高气温', color: city.color, type: 'band', values: band, midLine: false },
      { label: '日平均气温', color: city.color, values: meanLine, width: 2, dash: '4 3', fmt: v => r1(v) + ' °C' },
      { label: '每小时气温', color: '#0ea5e9', values: w.hourly.temp, width: 1.8, fmt: v => r1(v) + ' °C' },
    ];
  } else {
    labels = w.daily.time;
    xFmt = dailyXFmt(labels);
    const band = w.daily.tmin.map((v, i) => (v == null || w.daily.tmax[i] == null) ? null : [v, w.daily.tmax[i]]);
    series = [
      { label: '最低 / 最高气温', color: city.color, type: 'band', values: band, midLine: false },
      { label: '日平均气温', color: city.color, values: w.daily.tmean, width: 2.2, fmt: v => r1(v) + ' °C' },
    ];
  }
  return { labels, xFmt, series, yLabel: '°C', title: '温度变化', legend: true, height: 320 };
}

function precipChartOpts(city, d) {
  const w = d.weather;
  if (!w || !w.daily.time.length) return emptyChartOpts('降水量', 150);
  return {
    labels: w.daily.time,
    xFmt: dailyXFmt(w.daily.time),
    series: [{ label: '降水量', color: '#38bdf8', type: 'bar', values: w.daily.precip, fmt: v => r1(v) + ' mm' }],
    yLabel: 'mm', title: '降水量(日)',
    zeroBase: true, legend: true, height: 150,
  };
}

function aqiChartOpts(city, d) {
  const a = d.air;
  const aDaily = d.airDaily;
  const span = daySpan(state.start, state.end);
  const useHourly = a && a.hourly && a.hourly.time.length >= 2 && span <= 10;
  const labels = useHourly ? a.hourly.time : (aDaily && aDaily.time.length ? aDaily.time : []);
  const cn = useHourly
    ? a.hourly.time.map((t, i) => computeCnAqi({
        pm25: a.hourly.pm25[i], pm10: a.hourly.pm10[i], no2: a.hourly.no2[i],
        so2: a.hourly.so2[i], o3: a.hourly.o3[i],
        co: a.hourly.co[i] == null ? null : a.hourly.co[i] / 1000,
      }))
    : (aDaily ? aDaily.cnAqi : []);
  const us = useHourly ? a.hourly.usAqi : (aDaily ? aDaily.usAqi : []);
  const series = [
    { label: '中国AQI(估算)', color: city.color, values: cn, width: 2.4, fmt: v => String(v) },
    { label: '美国AQI', color: '#94a3b8', values: us, width: 1.6, dash: '5 4', fmt: v => String(v) },
  ];
  const maxVal = Math.max(...cn.filter(v => v != null), 150);
  return {
    labels, series, xFmt: useHourly ? hourlyXFmt : dailyXFmt(labels),
    yLabel: 'AQI', title: '空气质量指数(AQI)',
    bands: AQI_BANDS, zeroBase: true, legend: true,
    yMax: Math.min(500, Math.max(150, Math.ceil(maxVal * 1.15 / 50) * 50)),
    height: 290,
  };
}

function pollChartOpts(city, d) {
  const a = d.air;
  const aDaily = d.airDaily;
  const span = daySpan(state.start, state.end);
  const useHourly = a && a.hourly && a.hourly.time.length >= 2 && span <= 10;
  const labels = useHourly ? a.hourly.time : (aDaily && aDaily.time.length ? aDaily.time : []);
  const series = [];
  if (a && aDaily) {
    for (const p of POLL) {
      if (!d.pollVis || !d.pollVis[p.key]) continue;
      series.push({
        label: p.label + ' (µg/m³)', color: p.color,
        values: useHourly ? a.hourly[p.key] : aDaily[p.key],
        width: 1.8, fmt: v => r1(v) + ' µg/m³',
      });
    }
  }
  return {
    labels, series, xFmt: useHourly ? hourlyXFmt : dailyXFmt(labels),
    yLabel: 'µg/m³', title: '污染物浓度' + (useHourly ? '(每小时)' : '(日均)'),
    zeroBase: true, legend: true, height: 290,
  };
}

function renderPollChart(city, card, cw) {
  const d = state.data[city.id];
  const el = card.querySelector('.chart-poll');
  if (!d || d.status !== 'done') return;
  const opts = pollChartOpts(city, d);
  opts.width = cw || chartWidth(card);
  el.replaceChildren(buildChart(opts).svg);
}

function renderPollLegend(city, card) {
  const d = state.data[city.id];
  const el = card.querySelector('.poll-legend');
  if (!d || d.status !== 'done' || !d.air || !d.airDaily) { el.innerHTML = ''; return; }
  const span = daySpan(state.start, state.end);
  const useHourly = d.air.hourly && d.air.hourly.time.length >= 2 && span <= 10;
  const hasData = (key) => {
    const arr = useHourly ? d.air.hourly[key] : d.airDaily[key];
    return arr && arr.some(v => v != null);
  };
  el.innerHTML = POLL.map(p => {
    const ok = hasData(p.key);
    const on = !!(d.pollVis[p.key]);
    return `<button class="chip poll-toggle${on ? ' on' : ''}" data-key="${p.key}"${ok ? '' : ' disabled title="该时段无此污染物数据"'}><i style="background:${p.color}"></i>${p.label}</button>`;
  }).join('');
}

/* ================= 下载(JSON / CSV / SVG) ================= */
function cityJSON(city) {
  const d = state.data[city.id];
  const doc = {
    meta: {
      city: city.name, admin1: city.admin1, country: city.country,
      latitude: city.lat, longitude: city.lon,
      timezone: d.weather ? d.weather.tz : city.tz,
    },
    range: { start: state.start, end: state.end },
    fetchedAt: new Date(d.fetchedAt).toISOString(),
    source: 'Open-Meteo (https://open-meteo.com)',
    license: 'CC BY 4.0,请注明 Open-Meteo;空气质量数据来自 CAMS',
    weather: d.weather ? { daily: d.weather.daily, hourly: d.weather.hourly, raw: d.weather.raw } : null,
    air: d.air ? { hourly: d.air.hourly, notes: d.air.notes, raw: d.air.raw } : null,
    air_daily: d.airDaily,
  };
  return JSON.stringify(doc, null, 2);
}

const CSV_HEADER = ['日期', '最低温度(°C)', '最高温度(°C)', '平均温度(°C)', '降水量(mm)', 'PM2.5(µg/m³)', 'PM10(µg/m³)', 'NO2(µg/m³)', 'SO2(µg/m³)', 'O3(µg/m³)', 'CO(µg/m³)', '美国AQI', '中国AQI(估算)'];

function csvEscape(rows) {
  return '\ufeff' + rows.map(r => r.map(c => {
    // 注意:必须转成字符串再判断,否则数字单元格会因 .includes 抛错导致下载中断
    const s = typeof c === 'number' ? String(Math.round(c * 10) / 10) : String(c ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
}

function cityCSV(city) {
  const d = state.data[city.id];
  const w = d.weather ? d.weather.daily : { time: [], tmin: [], tmax: [], tmean: [], precip: [] };
  const a = d.airDaily;
  const dates = new Set();
  (w.time || []).forEach(t => dates.add(t));
  (a.time || []).forEach(t => dates.add(t));
  const wm = new Map(); (w.time || []).forEach((t, i) => wm.set(t, i));
  const am = new Map(); (a.time || []).forEach((t, i) => am.set(t, i));
  const rows = [CSV_HEADER];
  for (const t of [...dates].sort()) {
    const wi = wm.get(t), ai = am.get(t);
    const g = (arr, i) => (arr && i != null && arr[i] != null) ? arr[i] : '';
    rows.push([
      t,
      g(w.tmin, wi), g(w.tmax, wi), g(w.tmean, wi), g(w.precip, wi),
      g(a.pm25, ai), g(a.pm10, ai), g(a.no2, ai), g(a.so2, ai), g(a.o3, ai), g(a.co, ai),
      g(a.usAqi, ai), g(a.cnAqi, ai),
    ]);
  }
  return csvEscape(rows);
}

function activeCities() {
  return state.cities.filter(c => c.compare !== false && state.data[c.id] && state.data[c.id].status === 'done');
}

function compareCSV(active) {
  const rows = [['城市', ...CSV_HEADER]];
  for (const c of active) {
    const d = state.data[c.id];
    const w = d.weather ? d.weather.daily : { time: [], tmin: [], tmax: [], tmean: [], precip: [] };
    const a = d.airDaily;
    const wm = new Map(); (w.time || []).forEach((t, i) => wm.set(t, i));
    const am = new Map(); (a.time || []).forEach((t, i) => am.set(t, i));
    const dates = new Set([...wm.keys(), ...am.keys()]);
    for (const t of [...dates].sort()) {
      const wi = wm.get(t), ai = am.get(t);
      const g = (arr, i) => (arr && i != null && arr[i] != null) ? arr[i] : '';
      rows.push([
        c.name, t,
        g(w.tmin, wi), g(w.tmax, wi), g(w.tmean, wi), g(w.precip, wi),
        g(a.pm25, ai), g(a.pm10, ai), g(a.no2, ai), g(a.so2, ai), g(a.o3, ai), g(a.co, ai),
        g(a.usAqi, ai), g(a.cnAqi, ai),
      ]);
    }
  }
  return csvEscape(rows);
}

function citySVG(city, card) {
  const charts = [];
  for (const sel of ['.chart-temp', '.chart-precip', '.chart-aqi', '.chart-poll']) {
    const svg = card.querySelector(sel + ' svg');
    if (svg) charts.push({ svg, width: +svg.dataset.w, height: +svg.dataset.h });
  }
  if (!charts.length) return null;
  const stacked = stackCharts(charts);
  return svgToString(stacked, +stacked.getAttribute('width'), +stacked.getAttribute('height'));
}

/* ---- SVG 下载:让用户选择单个图表或全部 ---- */
const CITY_CHART_DEFS = [['温度变化', '.chart-temp'], ['降水量', '.chart-precip'], ['空气质量指数', '.chart-aqi'], ['污染物浓度', '.chart-poll']];
const COMPARE_CHART_DEFS = [['平均气温对比', '.cmp-temp'], ['中国AQI对比', '.cmp-aqi'], ['PM2.5对比', '.cmp-pm']];
let svgModalState = null;

function openSvgModal(kind, city) {
  const modal = document.getElementById('svgModal');
  if (!modal) return;
  const titleEl = document.getElementById('svgModalTitle');
  const optsEl = document.getElementById('svgModalOptions');
  const isCity = kind === 'city';
  const defs = isCity ? CITY_CHART_DEFS : COMPARE_CHART_DEFS;
  const root = isCity ? document.querySelector(`.card[data-id="${city.id}"]`) : document;
  if (!root) return;
  const present = defs.filter(([, sel]) => root.querySelector(sel + ' svg'));
  svgModalState = { kind, city };
  titleEl.textContent = isCity ? `下载「${city.name}」的图表 SVG` : '下载对比图表 SVG';
  if (!present.length) {
    optsEl.innerHTML = '<div class="modal-empty">暂无可下载的图表(数据可能尚未加载完成)</div>';
  } else {
    optsEl.innerHTML =
      `<button class="btn primary modal-opt" data-svg-sel="all">全部图表(合并为一张,共 ${present.length} 张)</button>` +
      present.map(([label, sel]) => `<button class="btn modal-opt" data-svg-sel="${sel}">仅下载:${escHtml(label)}</button>`).join('');
  }
  modal.classList.remove('hidden');
}

function closeSvgModal() {
  const modal = document.getElementById('svgModal');
  if (modal) modal.classList.add('hidden');
  svgModalState = null;
}

function downloadSvgChoice(sel) {
  const st = svgModalState;
  if (!st) return;
  const isCity = st.kind === 'city';
  const root = isCity ? document.querySelector(`.card[data-id="${st.city.id}"]`) : document;
  const defs = isCity ? CITY_CHART_DEFS : COMPARE_CHART_DEFS;
  const base = isCity ? `${safeName(st.city.name)}_${state.start}_${state.end}` : `多城市对比_${state.start}_${state.end}`;
  let charts = [], name = '';
  if (sel === 'all') {
    charts = defs.map(([, s]) => root.querySelector(s + ' svg'))
      .filter(Boolean)
      .map(svg => ({ svg, width: +svg.dataset.w, height: +svg.dataset.h }));
    name = '全部图表';
  } else {
    const def = defs.find(([, s]) => s === sel);
    const svg = root.querySelector(sel + ' svg');
    if (!def || !svg) { toast('该图表暂无数据'); closeSvgModal(); return; }
    charts = [{ svg, width: +svg.dataset.w, height: +svg.dataset.h }];
    name = def[0];
  }
  if (!charts.length) { toast('暂无可下载的图表'); closeSvgModal(); return; }
  const stacked = stackCharts(charts);
  const str = svgToString(stacked, +stacked.getAttribute('width'), +stacked.getAttribute('height'));
  downloadBlob(str, `${base}_${name}.svg`, 'image/svg+xml');
  toast(`已下载:${name} SVG`);
  closeSvgModal();
}

/* ================= 对比面板(独立视图) ================= */
function renderCompare() {
  const sec = document.getElementById('compareSection');
  const cardsEl = document.getElementById('cards');
  const idxEl = document.getElementById('cityIndex');
  const isCompare = state.view === 'compare';
  document.querySelectorAll('.tab').forEach(t => {
    const on = t.dataset.view === state.view;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  sec.classList.toggle('hidden', !isCompare);
  cardsEl.classList.toggle('hidden', isCompare);
  idxEl.classList.toggle('hidden', isCompare);
  if (!isCompare) return;
  if (state.cities.length < 2) {
    document.getElementById('compareChips').innerHTML = '';
    document.getElementById('compareCharts').innerHTML = '<div class="compare-empty">至少添加 <b>2 个城市</b>才能进行对比。<br>请在上方搜索框或常用城市中添加更多城市。</div>';
    document.getElementById('compareTable').classList.add('hidden');
    return;
  }
  const chipsEl = document.getElementById('compareChips');
  chipsEl.innerHTML = state.cities.map(c =>
    `<label class="chip cmp-chip"><input type="checkbox" data-comp="${c.id}" ${c.compare !== false ? 'checked' : ''}><i style="background:${c.color}"></i>${escHtml(c.name)}</label>`
  ).join('');
  buildCompareCharts(activeCities());
  buildCompareTable(activeCities());
}

function buildCompareCharts(active) {
  const cEl = document.getElementById('compareCharts');
  cEl.innerHTML = '<div class="chart-wrap"><div class="cmp-temp"></div></div>' +
                  '<div class="chart-wrap"><div class="cmp-aqi"></div></div>' +
                  '<div class="chart-wrap"><div class="cmp-pm"></div></div>';
  const labels = (() => {
    const set = new Set();
    active.forEach(c => {
      const w = state.data[c.id].weather;
      if (w) (w.daily.time || []).forEach(t => set.add(t));
    });
    return [...set].sort();
  })();
  const mapTo = (arr, ownTime) => {
    const m = new Map();
    ownTime.forEach((t, i) => m.set(t, i));
    return labels.map(t => { const i = m.get(t); return i == null ? null : arr[i]; });
  };
  const tempSeries = active.map(c => {
    const w = state.data[c.id].weather;
    return { label: c.name, color: c.color, values: w ? mapTo(w.daily.tmean, w.daily.time) : [], width: 2.2, fmt: v => r1(v) + ' °C' };
  });
  const aqiSeries = active.map(c => {
    const a = state.data[c.id].airDaily;
    return { label: c.name, color: c.color, values: a ? mapTo(a.cnAqi, a.time) : [], width: 2.2, fmt: v => String(v) };
  });
  const pmSeries = active.map(c => {
    const a = state.data[c.id].airDaily;
    return { label: c.name, color: c.color, values: a ? mapTo(a.pm25, a.time) : [], width: 2.2, fmt: v => r1(v) + ' µg/m³' };
  });
  const cmpProbe = document.querySelector('.cmp-temp');
  const cw = Math.max(520, Math.floor(cmpProbe ? cmpProbe.clientWidth : 0)) || 960;
  document.querySelector('.cmp-temp').replaceChildren(buildChart({
    labels, xFmt: dailyXFmt(labels), series: tempSeries, yLabel: '°C',
    title: '平均气温对比', legend: true, height: 320, width: cw,
  }).svg);
  document.querySelector('.cmp-aqi').replaceChildren(buildChart({
    labels, xFmt: dailyXFmt(labels), series: aqiSeries, yLabel: 'AQI',
    title: '中国AQI对比(估算)', bands: AQI_BANDS, zeroBase: true, legend: true, height: 320, width: cw,
  }).svg);
  document.querySelector('.cmp-pm').replaceChildren(buildChart({
    labels, xFmt: dailyXFmt(labels), series: pmSeries, yLabel: 'µg/m³',
    title: 'PM2.5 对比', zeroBase: true, legend: true, height: 320, width: cw,
  }).svg);
}

function buildCompareTable(active) {
  const tbl = document.getElementById('compareTable');
  if (!active.length) { tbl.classList.add('hidden'); return; }
  tbl.classList.remove('hidden');
  const head = ['城市', '平均温度(°C)', '最高(°C)', '最低(°C)', '降水量(mm)', 'PM2.5(µg/m³)', 'PM10(µg/m³)', '中国AQI', '等级'];
  let html = '<thead><tr>' + head.map(h => `<th>${h}</th>`).join('') + '</tr></thead><tbody>';
  for (const c of active) {
    const d = state.data[c.id];
    const w = d.weather ? d.weather.daily : { time: [], tmean: [], tmax: [], tmin: [], precip: [] };
    const a = d.airDaily;
    const aqi = avg(a.cnAqi);
    const lvl = aqiLevel(aqi);
    html += `<tr><td><span class="dot" style="background:${c.color}"></span>${escHtml(c.name)}</td>` +
      `<td>${fmtOr(avg(w.tmean))}</td><td>${fmtOr(maxA(w.tmax))}</td><td>${fmtOr(minA(w.tmin))}</td><td>${fmtOr(sumA(w.precip))}</td>` +
      `<td>${fmtOr(avg(a.pm25))}</td><td>${fmtOr(avg(a.pm10))}</td><td>${aqi == null ? '—' : Math.round(aqi)}</td>` +
      `<td style="color:${lvl ? lvl.color : 'inherit'}">${lvl ? lvl.label : '—'}</td></tr>`;
  }
  tbl.innerHTML = html + '</tbody>';
}

/* ================= 城市管理 ================= */
/* 保证每个城市颜色唯一:优先选择未被占用的调色板色 */
function normalizeCityColors() {
  const used = new Set();
  let changed = false;
  state.cities.forEach((c, i) => {
    if (!c.color || used.has(c.color)) {
      const free = PALETTE.find(p => !used.has(p)) || PALETTE[i % PALETTE.length];
      c.color = free;
      changed = true;
    }
    used.add(c.color);
  });
  if (changed) saveState();
}

function addCity(g) {
  if (state.cities.some(c => Math.abs(c.lat - g.lat) < 0.02 && Math.abs(c.lon - g.lon) < 0.02)) { toast('该城市已在列表中'); return; }
  if (state.cities.length >= 8) { toast('最多同时添加 8 个城市'); return; }
  const used = new Set(state.cities.map(c => c.color));
  const color = PALETTE.find(p => !used.has(p)) || PALETTE[state.cities.length % PALETTE.length];
  const city = {
    id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: g.name, admin1: g.admin1 || '', country: g.country || '',
    lat: g.lat, lon: g.lon, tz: g.tz || '',
    color,
    compare: true,
  };
  state.cities.push(city);
  saveState();
  rebuildCards();
  rebuildIndex();
  reloadAll(); // 新增城市后刷新全部城市的数据
  renderCompare();
  toast(`已添加 ${city.name},正在刷新全部城市数据`);
}

function removeCity(city) {
  state.cities = state.cities.filter(c => c.id !== city.id);
  delete state.data[city.id];
  saveState();
  // 只移除该城市的卡片,其他城市的数据与图表保持原样(不重新请求、不影响其他城市)
  const card = document.querySelector(`.card[data-id="${city.id}"]`);
  if (card && card.parentNode) {
    card.parentNode.removeChild(card);
  } else {
    rebuildCards();
    redrawCardsFromCache();
  }
  rebuildIndex();
  renderCompare();
  toast(`已移除 ${city.name}`);
}

/* 用缓存数据重绘所有卡片(不发起请求) */
function redrawCardsFromCache() {
  for (const c of state.cities) {
    const d = state.data[c.id];
    if (!d) continue;
    if (d.status === 'done') renderCard(c);
    else renderCardStatus(c);
  }
}

function reloadAll() {
  const old = state.data;
  state.data = {};
  for (const c of state.cities) {
    const v = old[c.id] && old[c.id].pollVis;
    if (v) state.data[c.id] = { pollVis: v };
    loadCity(c);
  }
}

/* ================= 城市索引(快速定位) ================= */
function rebuildIndex() {
  const el = document.getElementById('idxList');
  if (!el) return;
  el.innerHTML = state.cities.map(c =>
    `<span class="idx-chip" data-id="${c.id}" role="button" tabindex="0" style="--c:${c.color}" title="跳转到 ${escHtml(c.name)}"><i style="background:${c.color}"></i><span class="idx-name">${escHtml(c.name)}</span><button class="idx-del" data-del="${c.id}" type="button" title="从列表移除「${escHtml(c.name)}」" aria-label="移除 ${escHtml(c.name)}">✕</button></span>`
  ).join('');
  updateActiveIndex();
}

function scrollToCity(id) {
  const card = document.querySelector(`.card[data-id="${id}"]`);
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateActiveIndex() {
  if (state.view !== 'cities') return;
  const cards = [...document.querySelectorAll('.card')];
  if (!cards.length) return;
  let activeId = cards[0].dataset.id;
  for (const card of cards) {
    if (card.getBoundingClientRect().top <= 130) activeId = card.dataset.id;
  }
  document.querySelectorAll('.idx-chip[data-id]').forEach(ch => ch.classList.toggle('active', ch.dataset.id === activeId));
}

function switchView(v) {
  if (!v || v === state.view) return;
  state.view = v;
  saveState();
  renderCompare();
  if (v === 'cities') {
    rebuildIndex();
    state.cities.forEach(c => {
      const d = state.data[c.id];
      if (d && d.status === 'done') renderCard(c);
    });
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  updateActiveIndex();
}

/* ================= 搜索框 ================= */
function initSearch() {
  const input = document.getElementById('searchInput');
  const sugg = document.getElementById('suggestions');
  let timer = null, items = [], active = -1;
  const hide = () => { sugg.classList.add('hidden'); sugg.innerHTML = ''; };
  const paintActive = () => { [...sugg.querySelectorAll('.sugg-item')].forEach((el, i) => el.classList.toggle('active', i === active)); };
  const show = (list) => {
    items = list; active = -1;
    if (!list.length) {
      sugg.innerHTML = '<div class="sugg-empty">未找到匹配城市,请尝试其它写法(如拼音 / 英文)</div>';
      sugg.classList.remove('hidden');
      return;
    }
    sugg.innerHTML = list.map((g, i) =>
      `<div class="sugg-item" data-i="${i}"><b>${escHtml(g.name)}</b><span>${escHtml([g.admin1, g.country].filter(Boolean).join(' · '))} · ${g.lat.toFixed(2)}, ${g.lon.toFixed(2)}</span></div>`
    ).join('');
    sugg.classList.remove('hidden');
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { hide(); return; }
    timer = setTimeout(async () => {
      try { show(await geocodeCity(q)); }
      catch (e) {
        sugg.innerHTML = `<div class="sugg-empty">查询失败:${escHtml(e.message)}</div>`;
        sugg.classList.remove('hidden');
      }
    }, 350);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (items.length) { addCity(items[active >= 0 ? active : 0]); input.value = ''; hide(); }
      return;
    }
    if (e.key === 'ArrowDown' && items.length) { active = (active + 1) % items.length; paintActive(); }
    if (e.key === 'ArrowUp' && items.length) { active = (active - 1 + items.length) % items.length; paintActive(); }
    if (e.key === 'Escape') hide();
  });
  sugg.addEventListener('mousedown', (e) => {
    const it = e.target.closest('.sugg-item');
    if (!it) return;
    e.preventDefault();
    addCity(items[+it.dataset.i]);
    input.value = '';
    hide();
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.searchbox')) hide(); });
}

/* ================= 日期范围 ================= */
function updateRangeNote() {
  const el = document.getElementById('rangeNote');
  const notes = [];
  const span = daySpan(state.start, state.end);
  if (state.start < AQ_START) notes.push(`空气质量历史数据自 ${AQ_START} 起开放`);
  if (state.end > fmtYMD(addDays(startOfDay(new Date()), 5))) notes.push('空气质量预报最多约 5 天');
  if (span > 10) notes.push('跨度超过 10 天时,所有曲线按日展示(查看每小时数据请选择 10 天以内)');
  el.innerHTML = notes.map(n => `<span>ℹ ${n}</span>`).join('');
  el.classList.toggle('hidden', !notes.length);
}

function initRange() {
  const sEl = document.getElementById('dateStart');
  const eEl = document.getElementById('dateEnd');
  const today = startOfDay(new Date());
  const maxEnd = fmtYMD(addDays(today, 16));
  sEl.min = WEATHER_MIN; eEl.min = WEATHER_MIN;
  sEl.max = maxEnd; eEl.max = maxEnd;
  sEl.value = state.start; eEl.value = state.end;
  const apply = () => {
    let s = sEl.value, e = eEl.value;
    if (!s || !e) return;
    if (s > e) { toast('开始日期不能晚于结束日期'); sEl.value = state.start; eEl.value = state.end; return; }
    if (s < WEATHER_MIN) { toast(`历史天气最早自 ${WEATHER_MIN}`); s = WEATHER_MIN; sEl.value = s; }
    if (e > maxEnd) { toast(`天气预报最多到 ${maxEnd}`); e = maxEnd; eEl.value = e; }
    state.start = s; state.end = e;
    saveState();
    updateRangeNote();
    reloadAll();
  };
  sEl.addEventListener('change', apply);
  eEl.addEventListener('change', apply);
  const chipsEl = document.getElementById('rangeChips');
  chipsEl.innerHTML = RANGE_CHIPS.map(([label, a, b]) => `<button class="chip" data-s="${a}" data-e="${b}">${label}</button>`).join('');
  chipsEl.addEventListener('click', (ev) => {
    const b = ev.target.closest('button.chip');
    if (!b) return;
    const t0 = startOfDay(new Date());
    const s = fmtYMD(addDays(t0, +b.dataset.s));
    const e = fmtYMD(addDays(t0, +b.dataset.e));
    if (s < WEATHER_MIN) return;
    sEl.value = s; eEl.value = e;
    state.start = s; state.end = e;
    saveState();
    updateRangeNote();
    reloadAll();
  });
}

/* ================= 常用城市 ================= */
function initPresets() {
  const el = document.getElementById('presetChips');
  el.innerHTML = PRESETS.map(p => `<button class="chip" data-name="${p[0]}">${p[0]}</button>`).join('');
  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('button.chip');
    if (!b) return;
    const p = PRESETS.find(x => x[0] === b.dataset.name);
    if (p) addCity({ name: p[0], admin1: p[0], country: p[4], lat: p[1], lon: p[2], tz: p[3] });
  });
}

/* ================= 全局事件 ================= */
function initGlobalActions() {
  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (btn) {
      const card = btn.closest('.card');
      const city = card ? state.cities.find(c => c.id === card.dataset.id) : null;
      if (!city) return;
      const act = btn.dataset.act;
      if (act === 'remove') removeCity(city);
      else if (act === 'reload') loadCity(city);
      else if (state.data[city.id] && state.data[city.id].status === 'done') {
        const base = `${safeName(city.name)}_${state.start}_${state.end}`;
        if (act === 'json') downloadBlob(cityJSON(city), `${base}_天气.json`, 'application/json;charset=utf-8');
        if (act === 'csv') downloadBlob(cityCSV(city), `${base}_天气.csv`, 'text/csv;charset=utf-8');
        if (act === 'svg') {
          openSvgModal('city', city);
        }
      }
      return;
    }
    const pt = ev.target.closest('.poll-toggle');
    if (pt) {
      const card = pt.closest('.card');
      const city = card ? state.cities.find(c => c.id === card.dataset.id) : null;
      if (city && state.data[city.id] && state.data[city.id].status === 'done') {
        const d = state.data[city.id];
        d.pollVis[pt.dataset.key] = !d.pollVis[pt.dataset.key];
        renderPollChart(city, card);
        renderPollLegend(city, card);
      }
    }
  });

  document.addEventListener('change', (ev) => {
    const cb = ev.target.closest('input[data-comp]');
    if (cb) {
      const city = state.cities.find(c => c.id === cb.dataset.comp);
      if (city) { city.compare = cb.checked; saveState(); renderCompare(); }
    }
  });

  document.getElementById('refreshAll').addEventListener('click', () => { updateRangeNote(); reloadAll(); });

  document.getElementById('dlCompareCSV').addEventListener('click', () => {
    const active = activeCities();
    if (!active.length) { toast('暂无可对比的已加载城市'); return; }
    downloadBlob(compareCSV(active), `多城市对比_${state.start}_${state.end}.csv`, 'text/csv;charset=utf-8');
  });
  document.getElementById('dlCompareSVG').addEventListener('click', () => {
    openSvgModal('compare');
  });
}

/* ================= 主题 / 回到顶部 ================= */
function initTheme() {
  const btn = document.getElementById('themeToggle');
  const meta = document.querySelector('meta[name="theme-color"]');
  let animTimer = null;
  const playAnim = () => {
    const root = document.documentElement;
    root.classList.add('theme-anim');
    clearTimeout(animTimer);
    animTimer = setTimeout(() => root.classList.remove('theme-anim'), 480);
  };
  const sync = () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (btn) {
      btn.textContent = dark ? '☀️' : '🌙';
      btn.title = dark ? '切换到浅色主题' : '切换到深色主题';
      btn.setAttribute('aria-label', dark ? '切换到浅色主题' : '切换到深色主题');
    }
    if (meta) meta.setAttribute('content', dark ? '#0b1220' : '#ffffff');
  };
  sync();
  if (btn) {
    btn.addEventListener('click', () => {
      playAnim();
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (dark) document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', 'dark');
      try { localStorage.setItem('ws_theme', dark ? 'light' : 'dark'); } catch (e) { /* 忽略 */ }
      sync();
      // 主题变化后按新配色重绘所有图表
      redrawCardsFromCache();
      renderCompare();
    });
  }
}

function initBackTop() {
  const btn = document.getElementById('backTop');
  if (!btn) return;
  const sync = () => {
    const y = window.scrollY || window.pageYOffset || 0;
    btn.classList.toggle('visible', y > 420);
  };
  sync();
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  window.addEventListener('scroll', sync, { passive: true });
}

/* ================= 初始化 ================= */
function init() {
  initSearch();
  initRange();
  initPresets();
  initGlobalActions();
  initTheme();
  initBackTop();
  updateRangeNote();
  normalizeCityColors();
  rebuildCards();
  rebuildIndex();
  renderCompare();

  // 视图标签:城市详情 / 城市对比
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchView(t.dataset.view)));
  // 城市索引:点击城市跳转;点击 ✕ 快速移除该城市
  document.getElementById('cityIndex').addEventListener('click', (ev) => {
    const del = ev.target.closest('.idx-del');
    if (del) {
      ev.stopPropagation();
      const city = state.cities.find(c => c.id === del.dataset.del);
      if (!city) return;
      const ok = (typeof window.confirm === 'function') ? window.confirm(`从列表移除「${city.name}」?`) : true;
      if (ok) removeCity(city);
      return;
    }
    const chip = ev.target.closest('.idx-chip');
    if (chip && chip.dataset.id) scrollToCity(chip.dataset.id);
  });
  // 滚动时高亮当前城市索引
  window.addEventListener('scroll', () => { requestAnimationFrame(updateActiveIndex); }, { passive: true });

  // SVG 下载选择弹窗
  const svgModal = document.getElementById('svgModal');
  if (svgModal) {
    svgModal.addEventListener('click', (ev) => {
      if (ev.target === svgModal) { closeSvgModal(); return; }
      const opt = ev.target.closest('[data-svg-sel]');
      if (opt) downloadSvgChoice(opt.dataset.svgSel);
    });
    document.getElementById('svgModalClose').addEventListener('click', closeSvgModal);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSvgModal(); });
  }

  // 窗口尺寸变化时按新宽度重绘图表(保证字号清晰)
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.view === 'cities') {
        state.cities.forEach(c => {
          const d = state.data[c.id];
          if (d && d.status === 'done') renderCard(c);
        });
      }
      renderCompare();
    }, 250);
  });

  if (!state.cities.length) {
    // 首次访问:预置北京、上海作为演示(两者颜色不同)
    const bj = PRESETS[0], sh = PRESETS[1];
    const mk = (p, i) => ({
      id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + i,
      name: p[0], admin1: p[0], country: p[4], lat: p[1], lon: p[2], tz: p[3],
      color: PALETTE[i], compare: true,
    });
    state.cities.push(mk(bj, 0), mk(sh, 1));
    saveState();
    rebuildCards();
    rebuildIndex();
    reloadAll();
    renderCompare();
  } else {
    state.cities.forEach(c => loadCity(c));
  }
}

document.addEventListener('DOMContentLoaded', init);
