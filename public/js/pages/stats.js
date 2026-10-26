import { api, state, withSystem } from '../lib/api.js';
import { esc, fmtNum, pct } from '../lib/ui.js';
import {
  barChart, donutChart, chartCard, legendHTML, setChartTable, bindTableToggles, bindTips, css, catColor, heatmapHTML, destroyCharts, track,
} from '../lib/charts.js';
import { DAYS_SHORT, CATEGORY_LABELS } from '../lib/schedule.js';
import { showServers } from '../lib/drill.js';

const TABS = [
  { id: 'genel', label: 'Genel Bakış' },
  { id: 'sunucu', label: 'Sunucu Bazlı' },
  { id: 'kaset', label: 'Kaset (SLP)' },
  { id: 'pencere', label: 'Yedek Pencereleri' },
  { id: 'policy', label: 'Policy' },
  { id: 'tasima', label: 'Taşıma' },
];
const go = h => { location.hash = h; };
const MIG_COLORS = { 'Planlanmadı': '--axis', 'Planlandı': '--s1', 'Devam ediyor': '--s4', 'Taşındı': '--s3', 'Doğrulandı': '--s6', 'Kapsam dışı': '--muted' };

export async function render(view, { match }) {
  const tab = TABS.find(t => t.id === match[1]) ? match[1] : 'genel';
  view.innerHTML = `<div class="page-head"><div><h1>İstatistikler</h1>
    <p>Politikanın görsel takibi. Sekmeler Excel'deki sayfalara karşılık gelir; grafikteki herhangi bir çubuğa, dilime ya da hücreye tıklayınca o sayıyı oluşturan sunucular listelenir. “Yedeksiz” her yerde gösterge panelindeki tanımla aynıdır: envanterde aktif, DR dışı ve aktif policy'si olmayan sunucu; DR ortamındaki yedeksiz sunucular ayrı gösterilir.</p></div></div>
    <div class="tabs">${TABS.map(t => `<button class="${t.id === tab ? 'on' : ''}" data-tab="${t.id}">${esc(t.label)}</button>`).join('')}</div>
    <div id="tab"></div>`;
  view.querySelector('.tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (b) history.replaceState(null, '', `#/stats/${b.dataset.tab}`), show(b.dataset.tab);
  });
  bindTableToggles(view);
  bindTips(view);
  const st = await api.get(withSystem('/api/stats'));
  const el = view.querySelector('#tab');

  async function show(id) {
    destroyCharts();
    view.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === id));
    await RENDER[id](el, st);
  }
  await show(tab);
}

const RENDER = {
  genel(el, st) {
    el.innerHTML = `<div class="grid g2">
      ${chartCard({ id: 'types', title: 'Yedekleme yöntemleri (policy tipi)', sub: 'Aktif / pasif policy adedi' })}
      ${chartCard({ id: 'methods', title: 'Yönteme göre sunucu sayısı', sub: 'Bir sunucu birden fazla yöntemle yedeklenebilir' })}
      ${chartCard({ id: 'ret', title: 'Saklama süresi (retention) dağılımı', sub: 'O saklama süresiyle yedeklenen sunucu sayısı, yedek türüne göre', cls: 'span2', size: 'tall' })}
      ${chartCard({ id: 'fulldays', title: 'Full yedeklerin haftanın günlerine dağılımı', sub: 'O gün Full yedeği alınan sunucu sayısı (ayın herhangi bir haftasında)' })}
      ${chartCard({ id: 'tapest', title: 'Kasete çıkma durumu', sub: 'Değerlendirilen sunucular' })}
    </div>`;
    barChart(el.querySelector('#c-types'), {
      labels: st.policyTypes.map(t => t.label), stacked: true,
      datasets: [{ label: 'Aktif', data: st.policyTypes.map(t => t.active), color: css('--s1') }, { label: 'Pasif', data: st.policyTypes.map(t => t.passive), color: css('--axis') }],
      onClick: (l, { datasetIndex }) => go(`#/policies?type=${encodeURIComponent(l)}&active=${datasetIndex ? 0 : 1}`),
    });
    el.querySelector('#lg-types').innerHTML = legendHTML([{ label: 'Aktif', color: css('--s1') }, { label: 'Pasif', color: css('--axis') }]);
    setChartTable('types', ['Tip', 'Aktif', 'Pasif'], st.policyTypes.map(t => [t.label, t.active, t.passive]));

    barChart(el.querySelector('#c-methods'), {
      labels: st.methodDist.map(m => m.label), horizontal: true,
      datasets: [{ label: 'Sunucu', data: st.methodDist.map(m => m.value), color: css('--s1') }],
      onClick: (l, { index }) => showServers({ title: `Yöntem: ${l}`, ids: st.methodDist[index].ids }),
    });
    setChartTable('methods', ['Yöntem', 'Sunucu'], st.methodDist.map(m => [m.label, m.value]), r => showServers({ title: `Yöntem: ${st.methodDist[r].label}`, ids: st.methodDist[r].ids }));

    const cats = ['full', 'incr', 'log', 'tape'];
    barChart(el.querySelector('#c-ret'), {
      labels: st.retentionDist.map(r => r.label), stacked: true,
      datasets: cats.map(c => ({ label: CATEGORY_LABELS[c], data: st.retentionDist.map(r => r[c]), color: catColor(c) })),
      onClick: (l, { index, datasetIndex }) => showServers({ title: `${CATEGORY_LABELS[cats[datasetIndex]]} · saklama ${l}`, ids: st.retentionDist[index].ids[cats[datasetIndex]] }),
    });
    el.querySelector('#lg-ret').innerHTML = legendHTML(cats.map(c => ({ label: CATEGORY_LABELS[c], color: catColor(c) })));
    setChartTable('ret', ['Saklama', ...cats.map(c => CATEGORY_LABELS[c])], st.retentionDist.map(r => [r.label, ...cats.map(c => r[c])]),
      (r, c) => showServers({ title: `${CATEGORY_LABELS[cats[c - 1]]} · saklama ${st.retentionDist[r].label}`, ids: st.retentionDist[r].ids[cats[c - 1]] }));

    barChart(el.querySelector('#c-fulldays'), {
      labels: st.fullDays.map(d => d.label), datasets: [{ label: 'Full', data: st.fullDays.map(d => d.value), color: catColor('full') }],
      onClick: (l, { index }) => showServers({ title: `${l} günü Full yedek`, ids: st.fullDays[index].ids }),
    });
    setChartTable('fulldays', ['Gün', 'Full'], st.fullDays.map(d => [d.label, d.value]), r => showServers({ title: `${st.fullDays[r].label} günü Full yedek`, ids: st.fullDays[r].ids }));

    tapeDonut(el, st, 'tapest');
  },

  sunucu(el, st) {
    el.innerHTML = `<div class="grid g2">
      ${chartCard({ id: 'env', title: 'Ortama göre kapsam', sub: 'Yedekli / yedeksiz sunucu', size: 'tall' })}
      ${chartCard({ id: 'crit', title: 'Kritikliğe göre kapsam', sub: 'Yedekli / yedeksiz sunucu', size: 'tall' })}
      ${chartCard({ id: 'rpo', title: 'Tahmini RPO dağılımı', sub: 'İki disk yedeği arasındaki en uzun süre' })}
      ${chartCard({ id: 'plat', title: 'Platforma göre kapsam', sub: 'Yedekli / yedeksiz sunucu' })}
      <section class="card span2"><div class="card-head"><div><h3>RPO × Kritiklik matrisi</h3><p>Yüksek kritik sunucuların sağ (seyrek yedek) kolonlarda olmaması beklenir. Hücreye tıklayınca sunucular listelenir.</p></div></div>
        <div class="card-body" id="rpomx"></div></section>
    </div>`;
    const SERIES = [
      { k: 'covered', label: 'Yedekli', color: css('--s1') },
      { k: 'uncovered', label: 'Yedeksiz', color: css('--critical') },
      { k: 'dr', label: 'Yedeksiz – DR (ayrı sayılır)', color: css('--axis') },
    ];
    const cov = (id, data, key) => {
      const name = key === 'environment' ? 'Ortam' : key === 'criticality' ? 'Kritiklik' : 'Platform';
      const series = SERIES.filter(x => x.k !== 'dr' || data.some(d => d.dr));
      const open = (row, k) => showServers({ title: `${name}: ${data[row].label} · ${SERIES.find(x => x.k === k).label}`, ids: data[row].ids[k] });
      barChart(el.querySelector(`#c-${id}`), {
        labels: data.map(e => e.label), horizontal: true, stacked: true,
        datasets: series.map(x => ({ label: x.label, data: data.map(e => e[x.k]), color: x.color })),
        onClick: (l, { index, datasetIndex }) => open(index, series[datasetIndex].k),
      });
      const tot = k => data.reduce((a, d) => a + d[k], 0);
      el.querySelector(`#lg-${id}`).innerHTML = legendHTML(series.map(x => ({ label: x.label, color: x.color, value: tot(x.k) })));
      setChartTable(id, [name, ...series.map(x => x.label), 'Kasete çıkan'], data.map(e => [e.label, ...series.map(x => e[x.k]), e.tape]),
        (r, c) => open(r, c <= series.length ? series[c - 1].k : 'tape'));
    };
    cov('env', st.coverageByEnv, 'environment');
    cov('crit', st.coverageByCrit, 'criticality');
    cov('plat', st.coverageByPlatform, 'platform');
    barChart(el.querySelector('#c-rpo'), {
      labels: st.rpoDist.map(r => r.label), datasets: [{ label: 'Sunucu', data: st.rpoDist.map(r => r.value), color: css('--s1') }],
      onClick: (l, { index }) => showServers({ title: `RPO: ${l}`, ids: st.rpoDist[index].ids }),
    });
    setChartTable('rpo', ['RPO', 'Sunucu'], st.rpoDist.map(r => [r.label, r.value]), r => showServers({ title: `RPO: ${st.rpoDist[r].label}`, ids: st.rpoDist[r].ids }));
    const mx = el.querySelector('#rpomx');
    mx.innerHTML = heatmapHTML(st.rpoMatrix.map(r => r.values), st.rpoMatrix.map(r => r.criticality), st.rpoBuckets,
      { minCell: 70, clickable: true, tip: (r, c, v) => `${st.rpoMatrix[r].criticality} · ${st.rpoBuckets[c]}: ${v} sunucu` });
    mx.addEventListener('click', e => {
      const c = e.target.closest('.hc.click');
      if (c) showServers({ title: `${st.rpoMatrix[c.dataset.r].criticality} · RPO ${st.rpoBuckets[c.dataset.c]}`, ids: st.rpoMatrix[c.dataset.r].ids[c.dataset.c] });
    });
  },

  kaset(el, st) {
    const envTape = st.coverageByEnv.filter(e => e.tape);
    el.innerHTML = `<div class="grid g2">
      ${chartCard({ id: 'tapest', title: 'Kasete çıkma durumu', sub: 'Yedeği olan sunucular' })}
      ${chartCard({ id: 'tapeenv', title: 'Ortama göre kasete çıkan sunucu', sub: 'Aktif SLP schedule\'ı olan sunucular' })}
      <section class="card span2"><div class="card-head"><div><h3>Kasete çıkış takvimi (ayın haftası × gün)</h3>
        <p>Hücre: o gün kasete çıkan sunucu sayısı; tıklayınca sunucular listelenir. Yıllık SLP'ler (1 Ocak) bu matriste gösterilmez.</p></div></div>
        <div class="card-body" id="tapemx"></div></section>
    </div>`;
    tapeDonut(el, st, 'tapest');
    barChart(el.querySelector('#c-tapeenv'), {
      labels: envTape.map(e => e.label), datasets: [{ label: 'Kasete çıkan', data: envTape.map(e => e.tape), color: catColor('tape') }],
      onClick: (l, { index }) => showServers({ title: `Kasete çıkan · ${l}`, ids: envTape[index].ids.tape }),
    });
    setChartTable('tapeenv', ['Ortam', 'Kasete çıkan'], envTape.map(e => [e.label, e.tape]), r => showServers({ title: `Kasete çıkan · ${envTape[r].label}`, ids: envTape[r].ids.tape }));
    const tm = el.querySelector('#tapemx');
    tm.innerHTML = heatmapHTML(st.tapeMatrix, [1, 2, 3, 4, 5].map(w => `${w}. hafta`), DAYS_SHORT,
      { minCell: 60, clickable: true, tip: (r, c, v) => `Ayın ${r + 1}. haftası ${DAYS_SHORT[c]}: ${v} sunucu kasete çıkar` });
    tm.addEventListener('click', e => {
      const c = e.target.closest('.hc.click');
      if (c) showServers({ title: `Kasete çıkış · ayın ${Number(c.dataset.r) + 1}. haftası ${DAYS_SHORT[c.dataset.c]}`, ids: st.tapeMatrixIds[c.dataset.r][c.dataset.c] });
    });
  },

  async pencere(el) {
    el.innerHTML = `<section class="card"><div class="card-head"><div><h3>Haftalık yedek penceresi yoğunluğu</h3>
      <p>Her hücre, o gün ve saatte yedek penceresi açık olan sunucu sayısıdır. Taşıma sırasında yeni sistemin yük planlaması ve bakım saatleri için kullanılabilir.</p></div></div>
      <div class="card-body">
        <div class="filters">
          <span class="small muted">Ayın haftası</span>
          <div class="seg" id="wk">${['Ortalama', '1', '2', '3', '4', '5'].map((w, i) => `<button data-w="${i}" class="${i === 0 ? 'on' : ''}">${w}</button>`).join('')}</div>
          <span class="small muted" style="margin-left:8px">Yedek türü</span>
          <div class="seg" id="kind">${[['all', 'Tümü'], ['full', 'Full'], ['incr', 'Incremental'], ['log', 'Log'], ['tape', 'Kaset']].map(([k, l], i) => `<button data-k="${k}" class="${i === 0 ? 'on' : ''}">${l}</button>`).join('')}</div>
        </div>
        <div id="hm" style="overflow-x:auto"></div>
      </div></section>`;
    let week = 0, kind = 'all', hmIds = [];
    el.querySelector('#hm').addEventListener('click', e => {
      const c = e.target.closest('.hc.click');
      if (!c) return;
      const d = Number(c.dataset.r), h = Number(c.dataset.c);
      const kindTxt = { all: 'tüm yedekler', full: 'Full', incr: 'Incremental', log: 'Log', tape: 'Kaset' }[kind];
      showServers({
        title: `${DAYS_SHORT[d]} ${String(h).padStart(2, '0')}:00–${String(h + 1).padStart(2, '0')}:00 penceresi açık`,
        subtitle: `${kindTxt} · ${week ? `ayın ${week}. haftası` : 'ayın herhangi bir haftasında (hücredeki sayı 5 haftanın ortalamasıdır)'}`,
        ids: hmIds[d][h],
      });
    });
    const load = async () => {
      const { grid, ids } = await api.get(withSystem('/api/heatmap', { week, kind }));
      hmIds = ids;
      el.querySelector('#hm').innerHTML = `<div style="min-width:760px">${heatmapHTML(grid, ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'],
        Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')),
        { showValues: false, minCell: 26, clickable: true, tip: (r, c, v) => `${DAYS_SHORT[r]} ${String(c).padStart(2, '0')}:00–${String(c + 1).padStart(2, '0')}:00\n${fmtNum(v)} sunucunun penceresi açık` })}</div>`;
    };
    el.querySelector('#wk').addEventListener('click', e => { const b = e.target.closest('[data-w]'); if (!b) return; week = Number(b.dataset.w); el.querySelectorAll('#wk button').forEach(x => x.classList.toggle('on', x === b)); load(); });
    el.querySelector('#kind').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; kind = b.dataset.k; el.querySelectorAll('#kind button').forEach(x => x.classList.toggle('on', x === b)); load(); });
    await load();
  },

  policy(el, st) {
    el.innerHTML = `<div class="grid g2">
      ${chartCard({ id: 'top', title: 'En çok sunucu içeren policy\'ler', sub: 'İlk 15 aktif policy, istemci sayısı', cls: 'span2', size: 'tall' })}
      ${chartCard({ id: 'sys', title: 'Yedekleme sistemine göre policy', sub: 'Mevcut ve hedef sistem tanımları' })}
      ${chartCard({ id: 'types2', title: 'Policy tipleri', sub: 'Aktif / pasif' })}
    </div>`;
    barChart(el.querySelector('#c-top'), {
      labels: st.topPolicies.map(p => p.label), horizontal: true, datasets: [{ label: 'Sunucu', data: st.topPolicies.map(p => p.value), color: css('--s1') }],
      onClick: (l, { index }) => showServers({ title: `Policy: ${l}`, ids: st.topPolicies[index].ids }),
    });
    setChartTable('top', ['Policy', 'Sunucu'], st.topPolicies.map(p => [p.label, p.value]), r => showServers({ title: `Policy: ${st.topPolicies[r].label}`, ids: st.topPolicies[r].ids }));
    barChart(el.querySelector('#c-sys'), {
      labels: st.systems.map(s => s.label), datasets: [{ label: 'Policy', data: st.systems.map(s => s.value), color: css('--s7') }],
      onClick: l => { state.system = l; try { localStorage.setItem('vb.system', l); } catch { /* yok */ } document.querySelector('#system-filter').value = l; go('#/policies'); },
    });
    setChartTable('sys', ['Sistem', 'Policy'], st.systems.map(s => [s.label, s.value]));
    barChart(el.querySelector('#c-types2'), {
      labels: st.policyTypes.map(t => t.label), stacked: true, horizontal: true,
      datasets: [{ label: 'Aktif', data: st.policyTypes.map(t => t.active), color: css('--s1') }, { label: 'Pasif', data: st.policyTypes.map(t => t.passive), color: css('--axis') }],
      onClick: (l, { datasetIndex }) => go(`#/policies?type=${encodeURIComponent(l)}&active=${datasetIndex ? 0 : 1}`),
    });
    el.querySelector('#lg-types2').innerHTML = legendHTML([{ label: 'Aktif', color: css('--s1') }, { label: 'Pasif', color: css('--axis') }]);
    setChartTable('types2', ['Tip', 'Aktif', 'Pasif'], st.policyTypes.map(t => [t.label, t.active, t.passive]));
  },

  async tasima(el, st) {
    const servers = await api.get(withSystem('/api/servers'));
    const scope = servers.filter(s => s.covered || s.mig_wave || (s.mig_status && s.mig_status !== 'Planlanmadı'));
    const statuses = state.meta.migStatuses;
    const waves = [...new Set(scope.map(s => s.mig_wave || 'Dalga atanmamış'))].sort((a, b) => a.localeCompare(b, 'tr', { numeric: true }));
    const byWave = statuses.map(st2 => waves.map(w => scope.filter(s => (s.mig_wave || 'Dalga atanmamış') === w && (s.mig_status || 'Planlanmadı') === st2).length));
    const done = scope.filter(s => ['Taşındı', 'Doğrulandı'].includes(s.mig_status)).length;
    // hedef tarihe göre kümülatif plan vs gerçekleşen
    const dated = scope.filter(s => s.mig_target_date).sort((a, b) => a.mig_target_date.localeCompare(b.mig_target_date));
    const dates = [...new Set(dated.map(s => s.mig_target_date))];
    el.innerHTML = `<div class="kpis">
        <div class="card kpi"><span class="label">Taşıma kapsamı</span><span class="value tnum">${fmtNum(scope.length)}</span><span class="sub">Yedeği olan veya dalgaya atanmış sunucu</span></div>
        <div class="card kpi"><span class="label">Taşınan / doğrulanan</span><span class="value tnum">${fmtNum(done)}</span><span class="sub">%${pct(done, scope.length)}</span></div>
        <div class="card kpi"><span class="label">Hedef tarihi atanmış</span><span class="value tnum">${fmtNum(dated.length)}</span><span class="sub">${dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : 'Henüz tarih yok'}</span></div>
      </div>
      <div class="grid g2">
      ${chartCard({ id: 'migst', title: 'Durum dağılımı', sub: 'Sunucu sayısı' })}
      ${chartCard({ id: 'wave', title: 'Dalgalara göre durum', sub: 'Her dalgadaki sunucuların durumu' })}
      ${chartCard({ id: 'burn', title: 'Planlanan tarihlere göre kümülatif ilerleme', sub: 'Hedef tarihe göre planlanan vs. taşınan sunucu', cls: 'span2' })}
    </div>`;
    const idsBy = (fn) => scope.filter(fn).map(s => s.id);
    const counts = statuses.map(s => scope.filter(x => (x.mig_status || 'Planlanmadı') === s).length);
    const openStatus = i => showServers({ title: `Taşıma durumu: ${statuses[i]}`, ids: idsBy(x => (x.mig_status || 'Planlanmadı') === statuses[i]) });
    donutChart(el.querySelector('#c-migst'), { labels: statuses, data: counts, colors: statuses.map(s => css(MIG_COLORS[s])), onClick: (l, i) => openStatus(i) });
    el.querySelector('#lg-migst').innerHTML = legendHTML(statuses.map((s, i) => ({ label: s, value: counts[i], color: css(MIG_COLORS[s]) })));
    setChartTable('migst', ['Durum', 'Sunucu'], statuses.map((s, i) => [s, counts[i]]), r => openStatus(r));
    const openWave = (j, i) => showServers({ title: `${waves[j]} · ${statuses[i]}`, ids: idsBy(s => (s.mig_wave || 'Dalga atanmamış') === waves[j] && (s.mig_status || 'Planlanmadı') === statuses[i]) });
    barChart(el.querySelector('#c-wave'), {
      labels: waves, stacked: true, horizontal: true,
      datasets: statuses.map((s, i) => ({ label: s, data: byWave[i], color: css(MIG_COLORS[s]) })),
      onClick: (l, { index, datasetIndex }) => openWave(index, datasetIndex),
    });
    el.querySelector('#lg-wave').innerHTML = legendHTML(statuses.map(s => ({ label: s, color: css(MIG_COLORS[s]) })));
    setChartTable('wave', ['Dalga', ...statuses], waves.map((w, j) => [w, ...statuses.map((_, i) => byWave[i][j])]), (r, c) => openWave(r, c - 1));
    if (dates.length) {
      const planned = dates.map(d => dated.filter(s => s.mig_target_date <= d).length);
      const actual = dates.map(d => dated.filter(s => s.mig_target_date <= d && ['Taşındı', 'Doğrulandı'].includes(s.mig_status)).length);
      track(new Chart(el.querySelector('#c-burn'), {
        type: 'line',
        data: { labels: dates, datasets: [
          { label: 'Planlanan', data: planned, borderColor: css('--s1'), backgroundColor: css('--s1'), borderWidth: 2, pointRadius: 3, tension: 0 },
          { label: 'Taşınan', data: actual, borderColor: css('--s3'), backgroundColor: css('--s3'), borderWidth: 2, pointRadius: 3, tension: 0 },
        ] },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          plugins: { legend: { display: false } },
          scales: { x: { grid: { display: false }, ticks: { color: css('--muted') } }, y: { beginAtZero: true, grid: { color: css('--grid') }, border: { display: false }, ticks: { color: css('--muted'), precision: 0 } } } },
      }));
      el.querySelector('#lg-burn').innerHTML = legendHTML([{ label: 'Planlanan', color: css('--s1') }, { label: 'Taşınan', color: css('--s3') }]);
      setChartTable('burn', ['Tarih', 'Planlanan (kümülatif)', 'Taşınan (kümülatif)'], dates.map((d, i) => [d, planned[i], actual[i]]));
    } else {
      el.querySelector('#cb-burn').innerHTML = '<div class="empty">Taşıma Takibi ekranından sunuculara hedef tarih atadığınızda burada plan/gerçekleşen eğrisi oluşur.</div>';
    }
  },
};

function tapeDonut(el, st, id) {
  const colors = { 'EVET': catColor('tape'), 'HAYIR': css('--axis'), "Sadece pasif policy'de": css('--s2') };
  const labels = st.tapeStatus.map(t => t.label);
  donutChart(el.querySelector(`#c-${id}`), {
    labels, data: st.tapeStatus.map(t => t.value), colors: labels.map(l => colors[l] || css('--s7')),
    onClick: (l, i) => showServers({ title: `Kasete çıkma: ${l}`, ids: st.tapeStatus[i].ids }),
  });
  el.querySelector(`#lg-${id}`).innerHTML = legendHTML(st.tapeStatus.map(t => ({ label: t.label, value: t.value, color: colors[t.label] || css('--s7') })));
  setChartTable(id, ['Durum', 'Sunucu'], st.tapeStatus.map(t => [t.label, t.value]), r => showServers({ title: `Kasete çıkma: ${st.tapeStatus[r].label}`, ids: st.tapeStatus[r].ids }));
}
