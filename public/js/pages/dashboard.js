import { api, withSystem } from '../lib/api.js';
import { esc, fmtNum, pct, icon, sevBadge, relTime } from '../lib/ui.js';
import { barChart, donutChart, chartCard, legendHTML, setChartTable, bindTableToggles, css, catColor } from '../lib/charts.js';
import { isoDate, formatDateLong, CATEGORY_LABELS } from '../lib/schedule.js';

const MIG_COLORS = { 'Planlanmadı': '--axis', 'Planlandı': '--s1', 'Devam ediyor': '--s4', 'Taşındı': '--s3', 'Doğrulandı': '--s6', 'Kapsam dışı': '--muted' };

export async function render(view) {
  const today = isoDate(new Date());
  const [st, fnd, runs, audit] = await Promise.all([
    api.get(withSystem('/api/stats')),
    api.get(withSystem('/api/findings')),
    api.get(withSystem('/api/calendar/day', { date: today })),
    api.get('/api/audit?limit=8'),
  ]);
  const k = st.kpi;
  const migTotal = st.migration.reduce((a, x) => a + x.value, 0);
  const migDone = st.migration.filter(x => ['Taşındı', 'Doğrulandı'].includes(x.label)).reduce((a, x) => a + x.value, 0);
  const crit = fnd.filter(f => f.severity === 'critical').reduce((a, f) => a + f.count, 0);

  const todayCounts = { full: new Set(), incr: new Set(), log: new Set(), tape: new Set() };
  for (const r of runs.runs) for (const s of r.servers) todayCounts[r.category]?.add(s);

  view.innerHTML = `
  <div class="page-head">
    <div><h1>Gösterge Paneli</h1><p>Sunucu bazlı yedekleme politikasının anlık özeti: kapsam, kaset, sıklık, riskler ve taşıma ilerlemesi.</p></div>
    <div class="actions"><a class="btn" href="#/reports">${icon('download', 16)}Rapor al</a><a class="btn primary" href="#/policy/new">${icon('plus', 16)}Yeni policy</a></div>
  </div>
  <div class="kpis">
    <a class="card kpi" href="#/inventory?covered=yes"><span class="label">${icon('shield', 15)}Yedeklenen sunucu</span><span class="value tnum">${fmtNum(k.covered)}</span>
      <span class="sub">Değerlendirilen ${fmtNum(k.servers_considered)} sunucunun %${pct(k.covered, k.servers_considered)}'i</span>
      <div class="meter"><span style="width:${pct(k.covered, k.servers_considered)}%;background:var(--s1)"></span></div></a>
    <a class="card kpi" href="#/inventory?covered=no"><span class="label">${icon('alert', 15)}Yedeksiz sunucu (DR hariç)</span><span class="value tnum">${fmtNum(k.uncovered_non_dr)}</span>
      <span class="sub">${fmtNum(k.high_crit_uncovered)} tanesi yüksek kritik · DR dahil ${fmtNum(k.uncovered)}</span></a>
    <a class="card kpi" href="#/inventory?tape=EVET"><span class="label">${icon('tape', 15)}Kasete çıkan sunucu</span><span class="value tnum">${fmtNum(k.tape_yes)}</span>
      <span class="sub">Yedeklenenlerin %${pct(k.tape_yes, k.covered)}'i aktif SLP ile</span></a>
    <a class="card kpi" href="#/policies"><span class="label">${icon('layers', 15)}Policy</span><span class="value tnum">${fmtNum(k.policies_active)}<span class="muted" style="font-size:16px"> / ${fmtNum(k.policies_active + k.policies_passive)}</span></span>
      <span class="sub">${fmtNum(k.policies_passive)} pasif · ${fmtNum(k.schedules)} aktif schedule</span></a>
    <a class="card kpi" href="#/risks"><span class="label">${icon('alert', 15)}Kritik bulgu</span><span class="value tnum" style="color:${crit ? 'var(--critical)' : 'inherit'}">${fmtNum(crit)}</span>
      <span class="sub">${fnd.filter(f => f.count).length} kuralda toplam ${fmtNum(fnd.reduce((a, f) => a + f.count, 0))} kayıt</span></a>
    <a class="card kpi" href="#/migration"><span class="label">${icon('truck', 15)}Taşıma ilerlemesi</span><span class="value tnum">%${pct(migDone, migTotal)}</span>
      <span class="sub">${fmtNum(migDone)} / ${fmtNum(migTotal)} sunucu taşındı</span>
      <div class="meter">${st.migration.filter(m => m.value).map(m => `<span style="width:${pct(m.value, migTotal)}%;background:var(${MIG_COLORS[m.label] || '--axis'})" title="${esc(m.label)}: ${m.value}"></span>`).join('')}</div></a>
  </div>

  <div class="grid g3">
    ${chartCard({ id: 'env', title: 'Ortama göre yedek kapsamı', sub: 'Envanterde aktif ya da yedeği olan sunucular', cls: 'span2', size: 'tall' })}
    <section class="card">
      <div class="card-head"><div><h3>Bugün çalışacak yedekler</h3><p>${esc(formatDateLong(new Date()))} · ayın ${runs.week}. haftası</p></div></div>
      <div class="card-body">
        <ul class="list-plain">
          ${['full', 'incr', 'log', 'tape'].map(c => `<li class="row"><span class="dot" style="background:${catColor(c)}"></span><span>${CATEGORY_LABELS[c]}</span><span class="spacer"></span><strong class="tnum">${fmtNum(todayCounts[c].size)}</strong><span class="muted small">sunucu</span></li>`).join('')}
        </ul>
        <p class="small muted" style="margin:10px 0 0">${runs.runs.length} schedule bugün tetiklenecek.</p>
        <a class="btn sm mt" href="#/calendar">${icon('calendar', 14)}Takvimde aç</a>
      </div>
    </section>
    ${chartCard({ id: 'rpo', title: 'Tahmini RPO dağılımı', sub: 'İki disk yedeği arasındaki en uzun süre (sunucu sayısı)' })}
    ${chartCard({ id: 'types', title: 'Policy tipleri', sub: 'Aktif ve pasif policy adedi' })}
    <section class="card">
      <div class="card-head"><div><h3>Öne çıkan bulgular</h3><p>Otomatik uyum kuralları</p></div><a class="btn sm" href="#/risks">Tümü</a></div>
      <div class="card-body"><ul class="list-plain">
        ${fnd.filter(f => f.count).slice(0, 6).map(f => `<li class="fl"><span>${sevBadge(f.severity)}</span><a href="#/risks?rule=${f.id}" style="color:var(--text)">${esc(f.title)}</a><strong class="tnum">${fmtNum(f.count)}</strong></li>`).join('') || '<li class="muted">Bulgu yok</li>'}
      </ul></div>
    </section>
    <section class="card span2">
      <div class="card-head"><div><h3>Son değişiklikler</h3><p>Uygulama içinde yapılan güncellemeler</p></div><a class="btn sm" href="#/settings">Tüm geçmiş</a></div>
      <div class="card-body"><ul class="list-plain">
        ${audit.map(a => `<li class="row"><span class="badge">${esc(a.entity)}</span><span>${a.target ? `<strong>${esc(a.target)}</strong> · ` : ''}${esc(a.summary)}</span><span class="spacer"></span><span class="muted small nowrap">${relTime(a.ts)}</span></li>`).join('') || '<li class="muted">Henüz değişiklik yok</li>'}
      </ul></div>
    </section>
    ${chartCard({ id: 'mig', title: 'Taşıma durumu', sub: 'Sunucu sayısı' })}
  </div>`;

  bindTableToggles(view);
  const go = h => { location.hash = h; };

  const env = st.coverageByEnv;
  barChart(view.querySelector('#c-env'), {
    labels: env.map(e => e.label), horizontal: true, stacked: true,
    datasets: [
      { label: 'Yedekli', data: env.map(e => e.covered), color: css('--s1') },
      { label: 'Yedeksiz', data: env.map(e => e.uncovered), color: css('--critical') },
    ],
    onClick: l => go(`#/inventory?environment=${encodeURIComponent(l)}`),
  });
  view.querySelector('#lg-env').innerHTML = legendHTML([{ label: 'Yedekli', color: css('--s1') }, { label: 'Yedeksiz', color: css('--critical') }]);
  setChartTable('env', ['Ortam', 'Yedekli', 'Yedeksiz', 'Kasete çıkan'], env.map(e => [e.label, e.covered, e.uncovered, e.tape]));

  barChart(view.querySelector('#c-rpo'), {
    labels: st.rpoDist.map(r => r.label),
    datasets: [{ label: 'Sunucu', data: st.rpoDist.map(r => r.value), color: css('--s1') }],
    onClick: l => go(`#/inventory?rpo=${encodeURIComponent(l)}`),
  });
  setChartTable('rpo', ['RPO', 'Sunucu'], st.rpoDist.map(r => [r.label, r.value]));

  barChart(view.querySelector('#c-types'), {
    labels: st.policyTypes.map(t => t.label), stacked: true, horizontal: true,
    datasets: [
      { label: 'Aktif', data: st.policyTypes.map(t => t.active), color: css('--s1') },
      { label: 'Pasif', data: st.policyTypes.map(t => t.passive), color: css('--axis') },
    ],
  });
  view.querySelector('#lg-types').innerHTML = legendHTML([{ label: 'Aktif', color: css('--s1') }, { label: 'Pasif', color: css('--axis') }]);
  setChartTable('types', ['Tip', 'Aktif', 'Pasif'], st.policyTypes.map(t => [t.label, t.active, t.passive]));

  const mig = st.migration;
  donutChart(view.querySelector('#c-mig'), {
    labels: mig.map(m => m.label), data: mig.map(m => m.value), colors: mig.map(m => css(MIG_COLORS[m.label] || '--axis')),
    onClick: l => go(`#/migration?status=${encodeURIComponent(l)}`),
  });
  view.querySelector('#lg-mig').innerHTML = legendHTML(mig.map(m => ({ label: m.label, value: m.value, color: css(MIG_COLORS[m.label] || '--axis') })));
  setChartTable('mig', ['Durum', 'Sunucu'], mig.map(m => [m.label, m.value]));
}
