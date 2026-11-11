/* charts.js — 轻量无依赖 SVG 图表库(曲线/色带/柱状/AQI 等级带/悬浮提示)+ SVG 导出
 * 图表本身就是内联 SVG,因此"下载 SVG"只需把图表序列化即可。
 */
'use strict';

const SVGNS = 'http://www.w3.org/2000/svg';
const CHART_PALETTES = {
  light: { text: '#334155', muted: '#64748b', grid: '#e2e8f0', axis: '#cbd5e1', bg: '#ffffff' },
  dark: { text: '#e2e8f0', muted: '#94a3b8', grid: '#2a3950', axis: '#3b4c66', bg: '#0f172a' },
};
/* 当前主题下的图表配色(深色主题用深底浅字) */
function chartPalette() {
  const dark = typeof document !== 'undefined' && document.documentElement
    && document.documentElement.getAttribute
    && document.documentElement.getAttribute('data-theme') === 'dark';
  return CHART_PALETTES[dark ? 'dark' : 'light'];
}

function svgEl(name, attrs, children = []) {
  const n = document.createElementNS(SVGNS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  for (const c of children) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return n;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function niceStep(range, targetTicks) {
  if (!(range > 0)) return 1;
  const raw = range / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return step;
}

function fmtAxis(v) {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1000) return (v / 1000).toFixed(a >= 10000 ? 0 : 1) + 'k';
  if (a >= 100) return String(Math.round(v));
  return String(Math.round(v * 10) / 10);
}

let tipEl = null;
function getTip() {
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'chart-tip'; document.body.appendChild(tipEl); }
  return tipEl;
}

function polyPath(values, X, Y) {
  let d = '';
  let started = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || v === undefined || Number.isNaN(v)) { started = false; continue; }
    d += (started ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1);
    started = true;
  }
  return d;
}

/**
 * buildChart(opts)
 * opts: {
 *   labels: string[], series: [{ label, color, values: (number|[lo,hi])[], type?: 'line'|'area'|'band'|'bar',
 *                                 width, dash, opacity, midLine, fmt(v) }],
 *   width, height, yMin, yMax, yLabel, xFmt(t), title, bands: [{from,to,color,label}],
 *   zeroBase, legend: true|[{label,color}], emptyText
 * }
 * 返回 { svg, width, height }
 */
function buildChart(opts) {
  const { labels = [], series = [], width = 960, height = 300, yMin, yMax, yLabel = '', bands = [], xFmt, title = '', zeroBase = false, legend = false, emptyText = '该时段无数据' } = opts;
  const P = chartPalette();
  const ML = 58, MR = 18, MB = 36;

  // ---- 图例(画在 SVG 内部,保证导出的 SVG 自带图例) ----
  let legendItems = null;
  if (legend === true) legendItems = series.filter(s => !s.hidden).map(s => ({ label: s.label || s.name || '', color: s.color }));
  else if (Array.isArray(legend)) legendItems = legend.filter(Boolean);

  const legendRows = [];
  if (legendItems && legendItems.length) {
    let x = ML, row = [];
    for (const it of legendItems) {
      let w = 12 + 6 + 16;
      for (const ch of String(it.label)) w += ch.charCodeAt(0) > 255 ? 12.5 : 7.8;
      if (x + w > width - MR && row.length) { legendRows.push(row); row = []; x = ML; }
      row.push({ x, ...it });
      x += w;
    }
    if (row.length) legendRows.push(row);
  }

  let contentTop = 12;
  if (title) contentTop += 26;
  if (legendRows.length) contentTop += legendRows.length * 18 + 8;
  const plotTop = contentTop + 6;
  const plotW = width - ML - MR;
  const plotH = Math.max(height - plotTop - MB, 30);

  // ---- y 轴范围 ----
  let lo = yMin, hi = yMax;
  if (lo === undefined || hi === undefined) {
    let mn = Infinity, mx = -Infinity;
    for (const s of series) {
      if (s.hidden) continue;
      for (const v of s.values) {
        if (v === null || v === undefined || Number.isNaN(v)) continue;
        if (Array.isArray(v)) { mn = Math.min(mn, v[0], v[1]); mx = Math.max(mx, v[0], v[1]); }
        else { mn = Math.min(mn, v); mx = Math.max(mx, v); }
      }
    }
    if (!isFinite(mn)) { mn = 0; mx = 1; }
    const pad = (mx - mn) * 0.08 || 1;
    if (lo === undefined) lo = mn - pad;
    if (hi === undefined) hi = mx + pad;
  }
  if (zeroBase) lo = Math.min(0, lo);
  if (!(hi > lo)) hi = lo + 1;

  const n = labels.length;
  const X = i => ML + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const Y = v => plotTop + plotH - ((v - lo) / (hi - lo)) * plotH;

  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart-svg', 'data-w': width, 'data-h': height, role: 'img', 'font-family': 'Inter, "SF Pro Text", "PingFang SC", "Segoe UI", "Microsoft YaHei", sans-serif' });
  svg.appendChild(svgEl('rect', { x: 0, y: 0, width: width, height: height, class: 'chart-bg', fill: P.bg }));

  // ---- AQI 等级色带 ----
  for (const b of bands) {
    const yTop = Y(Math.max(b.from, lo));
    const yBot = Y(Math.min(b.to, hi));
    if (yBot - yTop < 0.5) continue;
    svg.appendChild(svgEl('rect', { x: ML, y: yBot, width: plotW, height: yTop - yBot, fill: b.color, opacity: 0.10 }));
    svg.appendChild(svgEl('text', { x: width - MR - 4, y: yBot + 11, 'text-anchor': 'end', 'font-size': 11, fill: b.color, opacity: 0.8 }, [b.label]));
  }

  // ---- 网格 + y 刻度 ----
  const step = niceStep(hi - lo, 5);
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) {
    const y = Y(v);
    svg.appendChild(svgEl('line', { x1: ML, y1: y, x2: width - MR, y2: y, stroke: P.grid, 'stroke-width': 1 }));
    svg.appendChild(svgEl('text', { x: ML - 7, y: y + 4, 'text-anchor': 'end', 'font-size': 12.5, fill: P.muted }, [fmtAxis(v)]));
  }

  // ---- x 刻度:均匀铺满整个宽度(端点必含,避免最后两个刻度挤在一起) ----
  if (n > 0) {
    const idxs = [];
    if (n === 1) {
      idxs.push(0);
    } else {
      const K = Math.max(1, Math.min(n - 1, Math.floor(plotW / 115)));
      for (let k = 0; k <= K; k++) idxs.push(Math.round((k * (n - 1)) / K));
    }
    for (const i of idxs) {
      const x = X(i);
      svg.appendChild(svgEl('line', { x1: x, y1: plotTop, x2: x, y2: plotTop + plotH, stroke: P.grid, 'stroke-width': 1 }));
      svg.appendChild(svgEl('text', { x: x, y: height - 10, 'text-anchor': 'middle', 'font-size': 12.5, fill: P.muted }, [xFmt ? xFmt(labels[i]) : labels[i]]));
    }
  }

  // ---- 基线 ----
  svg.appendChild(svgEl('line', { x1: ML, y1: plotTop + plotH, x2: width - MR, y2: plotTop + plotH, stroke: P.axis, 'stroke-width': 1 }));

  // ---- 标题 / y 轴标题 / 图例 ----
  if (title) svg.appendChild(svgEl('text', { x: ML, y: 28, 'font-size': 16, 'font-weight': 700, fill: P.text }, [title]));
  if (yLabel) svg.appendChild(svgEl('text', { x: 15, y: plotTop + plotH / 2, transform: `rotate(-90 15 ${plotTop + plotH / 2})`, 'text-anchor': 'middle', 'font-size': 12, fill: P.muted }, [yLabel]));
  const legTop = 12 + (title ? 26 : 0);
  legendRows.forEach((row, ri) => {
    const ly = legTop + ri * 18;
    for (const it of row) {
      svg.appendChild(svgEl('rect', { x: it.x, y: ly + 2, width: 11, height: 11, rx: 2.5, fill: it.color }));
      svg.appendChild(svgEl('text', { x: it.x + 16, y: ly + 12, 'font-size': 12.5, fill: P.text }, [it.label]));
    }
  });

  // ---- 无数据提示 ----
  if (!n) {
    svg.appendChild(svgEl('text', { x: width / 2, y: plotTop + plotH / 2, 'text-anchor': 'middle', 'font-size': 15, fill: P.muted }, [emptyText]));
  }

  // ---- 数据序列 ----
  const hoverGroup = svgEl('g', { class: 'hover-el' });
  const hoverLine = svgEl('line', { y1: plotTop, y2: plotTop + plotH, stroke: '#94a3b8', 'stroke-width': 1, 'stroke-dasharray': '3 3', visibility: 'hidden' });
  hoverGroup.appendChild(hoverLine);
  const dotDefs = [];

  for (const s of series) {
    if (s.hidden) continue;
    if (s.type === 'band') {
      const dTop = [], dBot = [];
      for (let i = 0; i < n; i++) {
        const v = s.values[i];
        if (!v) continue;
        dTop.push((dTop.length ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v[1]).toFixed(1));
      }
      for (let i = n - 1; i >= 0; i--) {
        const v = s.values[i];
        if (!v) continue;
        dBot.push('L' + X(i).toFixed(1) + ' ' + Y(v[0]).toFixed(1));
      }
      if (dTop.length) {
        svg.appendChild(svgEl('path', { d: dTop.join('') + dBot.join('') + 'Z', fill: s.color, opacity: s.opacity ?? 0.16 }));
        if (s.midLine !== false) {
          const mid = s.values.map(v => (v ? (v[0] + v[1]) / 2 : null));
          svg.appendChild(svgEl('path', { d: polyPath(mid, X, Y), fill: 'none', stroke: s.color, 'stroke-width': s.width ?? 1.6, 'stroke-dasharray': s.dash || '', 'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: s.lineOpacity ?? 0.9 }));
          const c = svgEl('circle', { r: 4, fill: '#ffffff', stroke: s.color, 'stroke-width': 2, visibility: 'hidden' });
          hoverGroup.appendChild(c);
          dotDefs.push({ values: mid, circle: c, label: s.label || s.name, color: s.color, fmt: s.fmt });
        }
      }
    } else if (s.type === 'bar') {
      // 柱宽约为槽位的 80%(相对此前 62% 加宽约 130%)
      const bw = Math.min((plotW / Math.max(n, 1)) * 0.8, 34);
      for (let i = 0; i < n; i++) {
        const v = s.values[i];
        if (v === null || v === undefined || Number.isNaN(v)) continue;
        svg.appendChild(svgEl('rect', { x: X(i) - bw / 2, y: Y(v), width: bw, height: Math.max(Y(lo) - Y(v), 0.5), rx: 1.5, fill: s.color, opacity: s.opacity ?? 0.8 }));
      }
    } else {
      const d = polyPath(s.values, X, Y);
      if (d && s.type === 'area') {
        svg.appendChild(svgEl('path', { d: d + ` L${X(n - 1).toFixed(1)} ${Y(lo).toFixed(1)} L${X(0).toFixed(1)} ${Y(lo).toFixed(1)} Z`, fill: s.color, opacity: s.opacity ?? 0.12 }));
      }
      if (d) {
        svg.appendChild(svgEl('path', { d: d, fill: 'none', stroke: s.color, 'stroke-width': s.width ?? 2, 'stroke-dasharray': s.dash || '', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
        const c = svgEl('circle', { r: 4, fill: '#ffffff', stroke: s.color, 'stroke-width': 2, visibility: 'hidden' });
        hoverGroup.appendChild(c);
        dotDefs.push({ values: s.values, circle: c, label: s.label || s.name, color: s.color, fmt: s.fmt });
      }
    }
  }
  svg.appendChild(hoverGroup);

  // ---- 悬浮交互 ----
  if (n > 0) {
    svg.addEventListener('mousemove', (e) => {
      const rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      const px = (e.clientX - rect.left) / rect.width * width;
      const i = Math.max(0, Math.min(n - 1, Math.round((px - ML) / plotW * (n - 1))));
      const x = X(i);
      hoverLine.setAttribute('x1', x); hoverLine.setAttribute('x2', x);
      hoverLine.setAttribute('visibility', 'visible');
      let html = `<div class="tip-title">${esc(labels[i] ?? '')}</div>`;
      for (const it of dotDefs) {
        const v = it.values[i];
        const vis = v !== null && v !== undefined && !Number.isNaN(v);
        it.circle.setAttribute('cx', x);
        it.circle.setAttribute('cy', vis ? Y(v) : -10);
        it.circle.setAttribute('visibility', vis ? 'visible' : 'hidden');
        if (vis) html += `<div class="tip-row"><i style="background:${it.color}"></i><span>${esc(it.label)}</span><b>${esc(it.fmt ? it.fmt(v) : fmtAxis(v))}</b></div>`;
      }
      const tip = getTip();
      tip.innerHTML = html;
      tip.style.display = 'block';
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let tx = e.clientX + 14, ty = e.clientY - th - 8;
      if (tx + tw > window.innerWidth - 6) tx = e.clientX - tw - 14;
      if (ty < 6) ty = e.clientY + 16;
      tip.style.left = tx + 'px';
      tip.style.top = ty + 'px';
    });
    svg.addEventListener('mouseleave', () => {
      hoverLine.setAttribute('visibility', 'hidden');
      for (const it of dotDefs) it.circle.setAttribute('visibility', 'hidden');
      const tip = getTip();
      if (tip) tip.style.display = 'none';
    });
  }

  return { svg, width, height };
}

/* 把图表序列化为可独立打开的 SVG 文件内容(导出统一使用白色背景,便于分享/打印) */
const CHART_DARK_TO_LIGHT = { '#e2e8f0': '#334155', '#94a3b8': '#64748b', '#2a3950': '#e2e8f0', '#3b4c66': '#cbd5e1', '#0f172a': '#ffffff' };
function svgToString(svg, w, h) {
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', SVGNS);
  clone.setAttribute('width', w);
  clone.setAttribute('height', h);
  clone.removeAttribute('class');
  clone.removeAttribute('data-w');
  clone.removeAttribute('data-h');
  clone.querySelectorAll('.hover-el').forEach(e => e.remove());
  const bg = clone.querySelector('.chart-bg');
  if (bg) bg.setAttribute('fill', '#ffffff');
  let str = new XMLSerializer().serializeToString(clone);
  // 深色主题下导出时,把深色图表配色还原为浅色(白底深字)
  if (chartPalette() === CHART_PALETTES.dark) {
    for (const [d, l] of Object.entries(CHART_DARK_TO_LIGHT)) str = str.split(d).join(l);
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + str;
}

/* 将多张图表纵向拼接为一张 SVG */
function stackCharts(charts, opts = {}) {
  const gap = opts.gap ?? 30;
  const w = Math.max(...charts.map(c => c.width));
  const totalH = charts.reduce((a, c) => a + c.height, 0) + gap * Math.max(0, charts.length - 1);
  const outer = svgEl('svg', { xmlns: SVGNS, viewBox: `0 0 ${w} ${totalH}`, width: w, height: totalH });
  outer.appendChild(svgEl('rect', { width: w, height: totalH, fill: '#ffffff' }));
  let y = 0;
  for (const c of charts) {
    const g = svgEl('g', { transform: `translate(0,${y})` });
    const clone = c.svg.cloneNode(true);
    clone.querySelectorAll('.hover-el').forEach(e => e.remove());
    // 关键的修复:内层 <svg> 必须显式设置 width/height,
    // 否则嵌套 SVG 默认按 100% 撑满外层,导致“全部图表”导出错位/裁剪。
    clone.setAttribute('width', c.width);
    clone.setAttribute('height', c.height);
    clone.setAttribute('viewBox', `0 0 ${c.width} ${c.height}`);
    const bg = clone.querySelector('.chart-bg');
    if (bg) bg.setAttribute('fill', '#ffffff');
    g.appendChild(clone);
    outer.appendChild(g);
    y += c.height + gap;
  }
  return outer;
}
