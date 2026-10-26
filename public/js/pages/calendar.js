import { api, withSystem } from '../lib/api.js';
import { esc, fmtNum, icon, trLower } from '../lib/ui.js';
import { catColor } from '../lib/charts.js';
import { DAYS_TR, isoDate, formatDateLong, CATEGORY_LABELS, typeLabel } from '../lib/schedule.js';

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const CATS = ['full', 'incr', 'log', 'tape'];

export async function render(view, { params }) {
  const now = new Date();
  let y = Number(params.get('y')) || now.getFullYear();
  let m = Number(params.get('m')) || now.getMonth() + 1;
  let selected = params.get('d') || isoDate(now);
  let catFilter = '';
  let q = '';

  view.innerHTML = `<div class="page-head"><div><h1>Yedek Takvimi</h1>
    <p>Takvim, schedule tanımlarından hesaplanır: bir güne tıklayınca o gün hangi sunucuların hangi pencerede, hangi türde yedekleneceğini ve kasete çıkacağını görürsünüz.
    “Ayın N. haftası” NetBackup mantığıyla o haftagününün aydaki N. tekrarıdır.</p></div>
    <div class="actions"><button class="btn" data-nav="-1">‹</button><strong id="mtitle" style="min-width:130px;text-align:center"></strong><button class="btn" data-nav="1">›</button><button class="btn" data-today>Bugün</button></div></div>
    <div class="grid" style="grid-template-columns:minmax(0,1.25fr) minmax(0,1fr)">
      <section class="card card-pad"><div id="cal"></div>
        <div class="legend mt">${CATS.map(c => `<span><i class="sw" style="background:${catColor(c)}"></i>${CATEGORY_LABELS[c]} (sunucu)</span>`).join('')}</div></section>
      <section class="card"><div class="card-head"><div><h3 id="dtitle"></h3><p id="dsub"></p></div></div>
        <div class="card-body">
          <div class="filters"><input type="search" id="dq" placeholder="Sunucu / policy ara"><div class="seg" id="dcat"><button data-c="" class="on">Tümü</button>${CATS.map(c => `<button data-c="${c}">${CATEGORY_LABELS[c]}</button>`).join('')}</div></div>
          <div id="day" style="max-height:72vh;overflow-y:auto"></div></div></section>
    </div>`;
  if (window.innerWidth < 1100) view.querySelector('.grid').style.gridTemplateColumns = 'minmax(0,1fr)';

  let dayData = null;
  async function loadMonth() {
    view.querySelector('#mtitle').textContent = `${MONTHS[m - 1]} ${y}`;
    const days = await api.get(withSystem('/api/calendar/month', { year: y, month: m }));
    const first = new Date(y, m - 1, 1).getDay();
    const lead = (first + 6) % 7; // Pazartesi başlangıçlı
    const todayIso = isoDate(new Date());
    const heads = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
    view.querySelector('#cal').innerHTML = `<div class="cal">${heads.map(h => `<div class="cal-h">${h}</div>`).join('')}
      ${'<div class="cal-d blank"></div>'.repeat(lead)}
      ${days.map(d => `<button class="cal-d ${d.date === selected ? 'on' : ''} ${d.date === todayIso ? 'today' : ''}" data-d="${d.date}">
        <span><span class="n">${d.day}</span><span class="w">${d.week}. hf</span></span>
        ${CATS.filter(c => d[c]).map(c => `<span class="ln"><span class="dot" style="background:${catColor(c)}"></span>${fmtNum(d[c])}</span>`).join('')}
      </button>`).join('')}</div>`;
  }

  async function loadDay() {
    dayData = await api.get(withSystem('/api/calendar/day', { date: selected }));
    const [yy, mm, dd] = selected.split('-').map(Number);
    view.querySelector('#dtitle').textContent = formatDateLong(new Date(yy, mm - 1, dd));
    view.querySelector('#dsub').textContent = `Ayın ${dayData.week}. ${DAYS_TR[dayData.weekday]} günü · ${dayData.runs.length} schedule`;
    drawDay();
  }

  function drawDay() {
    const ql = trLower(q);
    const runs = dayData.runs.filter(r => (!catFilter || r.category === catFilter) &&
      (!ql || trLower(r.policy).includes(ql) || r.servers.some(s => trLower(s).includes(ql))));
    view.querySelector('#day').innerHTML = runs.length ? `<ul class="list-plain">${runs.map(r => `<li>
      <div class="row" style="gap:8px"><span class="dot" style="background:${catColor(r.category)}"></span>
        <a href="#/policy/${r.policy_id}"><strong data-notr>${esc(r.policy)}</strong></a><span class="badge">${esc(r.schedule)}</span>
        ${r.tape ? `<span class="badge blue">${icon('tape', 12)}Kaset</span>` : ''}<span class="spacer"></span><span class="small muted nowrap">${icon('clock', 13)} ${esc(r.window)}</span></div>
      <div class="small text-2" style="margin:4px 0 0 16px">${esc(typeLabel(r.backup_type))} · ${esc(r.when)} · Saklama: ${esc(r.retention)}</div>
      <div class="small" style="margin:4px 0 0 16px">${r.servers.length > 12 ? `<details><summary>${r.servers.length} sunucu</summary>${r.servers.map(s => esc(s)).join(', ')}</details>` : r.servers.map(s => esc(s)).join(', ')}</div>
    </li>`).join('')}</ul>` : '<div class="empty">Bu gün için eşleşen yedek yok.</div>';
  }

  view.addEventListener('click', e => {
    const d = e.target.closest('[data-d]');
    if (d) {
      selected = d.dataset.d;
      view.querySelectorAll('.cal-d').forEach(x => x.classList.toggle('on', x === d));
      loadDay();
    }
    const nav = e.target.closest('[data-nav]');
    if (nav) { m += Number(nav.dataset.nav); if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } loadMonth(); }
    if (e.target.closest('[data-today]')) { const t = new Date(); y = t.getFullYear(); m = t.getMonth() + 1; selected = isoDate(t); loadMonth(); loadDay(); }
    const c = e.target.closest('[data-c]');
    if (c) { catFilter = c.dataset.c; view.querySelectorAll('#dcat button').forEach(x => x.classList.toggle('on', x === c)); drawDay(); }
  });
  view.querySelector('#dq').addEventListener('input', e => { q = e.target.value; drawDay(); });
  await Promise.all([loadMonth(), loadDay()]);
}
