// Chart.js sarmalayıcıları + HTML ısı haritası. Renkler CSS değişkenlerinden okunur (açık/koyu tema).
import { esc, fmtNum, icon } from './ui.js';

const live = new Set();
export function destroyCharts() {
  for (const c of live) c.destroy();
  live.clear();
}

export function track(chart) { live.add(chart); return chart; }

export const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const series = i => css(`--s${(i % 8) + 1}`);
// Kategori renkleri varlığa bağlıdır, sıraya değil
export const CAT_VAR = { full: '--s1', incr: '--s2', log: '--s3', tape: '--s4' };
export const catColor = k => css(CAT_VAR[k] || '--s7');

function baseOptions({ stacked, horizontal, legend }) {
  const grid = css('--grid'), muted = css('--muted'), axis = css('--axis');
  const valueAxis = {
    stacked, beginAtZero: true,
    grid: { color: grid, drawTicks: false }, border: { display: false },
    ticks: { color: muted, padding: 6, precision: 0, font: { size: 11 } },
  };
  const catAxis = {
    stacked, grid: { display: false }, border: { color: axis },
    ticks: { color: muted, font: { size: 11 }, autoSkip: false, maxRotation: 0 },
  };
  return {
    responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
    indexAxis: horizontal ? 'y' : 'x',
    interaction: { mode: 'nearest', axis: horizontal ? 'y' : 'x', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: css('--surface'), titleColor: css('--text'), bodyColor: css('--text-2'),
        borderColor: css('--border-strong'), borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true,
        callbacks: { label: c => ` ${c.dataset.label ? c.dataset.label + ': ' : ''}${fmtNum(c.parsed[horizontal ? 'x' : 'y'] ?? c.parsed)}` },
      },
    },
    scales: horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
    _legend: legend,
  };
}

// datasets: [{ label, data, color }]
export function barChart(canvas, { labels, datasets, stacked = false, horizontal = false, onClick, max }) {
  const surface = css('--surface');
  const opts = baseOptions({ stacked, horizontal });
  if (max) opts.scales[horizontal ? 'x' : 'y'].max = max;
  if (onClick) {
    opts.onClick = (e, els) => { if (els.length) onClick(labels[els[0].index], els[0]); };
    opts.onHover = (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; };
  }
  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: datasets.map((d, i) => ({
        label: d.label, data: d.data, backgroundColor: d.color, hoverBackgroundColor: d.color,
        borderColor: surface, borderWidth: stacked ? { top: 0, bottom: 0, left: horizontal ? 0 : 0, right: 0, [horizontal ? 'right' : 'top']: 2 } : 0,
        borderSkipped: false,
        borderRadius: stacked ? (i === datasets.length - 1 ? 4 : 0) : 4,
        maxBarThickness: horizontal ? 22 : 34, categoryPercentage: 0.72, barPercentage: 0.9,
      })),
    },
    options: opts,
  });
  live.add(chart);
  return chart;
}

export function donutChart(canvas, { labels, data, colors, onClick }) {
  const chart = new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: css('--surface'), borderWidth: 2, hoverOffset: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '68%', animation: { duration: 250 },
      plugins: { legend: { display: false }, tooltip: baseOptions({}).plugins.tooltip },
      onClick: onClick ? (e, els) => { if (els.length) onClick(labels[els[0].index]); } : undefined,
    },
  });
  chart.options.plugins.tooltip.callbacks = { label: c => ` ${c.label}: ${fmtNum(c.parsed)}` };
  live.add(chart);
  return chart;
}

export function legendHTML(items) {
  return `<div class="legend">${items.map(i => `<span><i class="sw" style="background:${i.color}"></i>${esc(i.label)}${i.value !== undefined ? ` <strong class="tnum">${fmtNum(i.value)}</strong>` : ''}</span>`).join('')}</div>`;
}

// Grafik kartı: başlık + grafik/tablo geçişi
export function chartCard({ id, title, sub = '', size = '', extra = '', cls = '' }) {
  return `<section class="card ${cls}" data-chart-card="${id}">
    <div class="card-head"><div><h3>${esc(title)}</h3>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
      <div class="actions">${extra}<button class="icon-btn" data-table-toggle="${id}" title="Tablo olarak göster" aria-label="Tablo olarak göster">${icon('table', 16)}</button></div></div>
    <div class="card-body"><div class="chart-box ${size}" id="cb-${id}"><canvas id="c-${id}"></canvas></div><div id="lg-${id}"></div>
    <div id="tb-${id}" class="chart-table" hidden></div></div></section>`;
}

// Tablo görünümü verisi: { head: [], rows: [[]] }
const tables = new Map();
export function setChartTable(id, head, rows) { tables.set(id, { head, rows }); }
export function bindTableToggles(root) {
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-table-toggle]');
    if (!b) return;
    const id = b.dataset.tableToggle;
    const tb = root.querySelector(`#tb-${id}`), cb = root.querySelector(`#cb-${id}`), lg = root.querySelector(`#lg-${id}`);
    const show = tb.hidden;
    if (show) {
      const t = tables.get(id);
      tb.innerHTML = t ? `<div class="table-wrap" style="max-height:340px"><table class="data"><thead><tr>${t.head.map((h, i) => `<th class="${i ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map(r => `<tr>${r.map((v, i) => `<td class="${i ? 'num' : ''}">${typeof v === 'number' ? fmtNum(v) : esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<div class="empty">Veri yok</div>';
    }
    tb.hidden = !show;
    if (cb) cb.hidden = show;
    if (lg) lg.hidden = show;
    b.classList.toggle('on', show);
  });
}

// Sıralı (tek ton) ısı rengi
export function seqColor(v, max) {
  if (!v || !max) return 'var(--surface-2)';
  const step = Math.min(7, Math.max(1, Math.ceil((v / max) * 7)));
  return `var(--seq-${step})`;
}
const inkOn = (v, max) => (v && max && Math.ceil((v / max) * 7) >= 5 ? '#fff' : 'var(--text-2)');

// grid: satır x kolon sayılar
export function heatmapHTML(grid, rowLabels, colLabels, { showValues = true, tip, minCell = 22, colEvery = 1 } = {}) {
  const max = Math.max(1, ...grid.flat());
  const cols = colLabels.length;
  let html = `<div class="heat" style="grid-template-columns: auto repeat(${cols}, minmax(${minCell}px, 1fr))"><div></div>`;
  html += colLabels.map((c, i) => `<div class="hh">${i % colEvery === 0 ? esc(c) : ''}</div>`).join('');
  grid.forEach((row, r) => {
    html += `<div class="hl">${esc(rowLabels[r])}</div>`;
    html += row.map((v, c) => `<div class="hc" style="background:${seqColor(v, max)};color:${inkOn(v, max)}" data-tip="${esc(tip ? tip(r, c, v) : `${rowLabels[r]} · ${colLabels[c]}: ${fmtNum(v)}`)}">${showValues && v ? fmtNum(Math.round(v)) : ''}</div>`).join('');
  });
  html += '</div>';
  html += `<div class="heat-scale"><span>Az</span>${[1, 2, 3, 4, 5, 6, 7].map(i => `<i style="background:var(--seq-${i})"></i>`).join('')}<span>Çok</span><span class="spacer"></span><span>En yüksek: ${fmtNum(Math.round(max))}</span></div>`;
  return html;
}

// data-tip öznitelikli öğeler için ortak tooltip
let tipEl;
export function bindTips(root) {
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; tipEl.hidden = true; document.body.appendChild(tipEl); }
  root.addEventListener('mouseover', e => {
    const t = e.target.closest('[data-tip]');
    if (!t) return;
    tipEl.textContent = t.dataset.tip;
    tipEl.style.whiteSpace = 'pre-line';
    tipEl.hidden = false;
  });
  root.addEventListener('mousemove', e => {
    if (tipEl.hidden) return;
    const x = Math.min(e.clientX + 14, window.innerWidth - tipEl.offsetWidth - 8);
    const y = Math.min(e.clientY + 14, window.innerHeight - tipEl.offsetHeight - 8);
    tipEl.style.left = `${x}px`;
    tipEl.style.top = `${y}px`;
  });
  root.addEventListener('mouseout', e => { if (e.target.closest('[data-tip]')) tipEl.hidden = true; });
}
export function hideTip() { if (tipEl) tipEl.hidden = true; }
