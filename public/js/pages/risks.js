import { api, withSystem } from '../lib/api.js';
import { esc, sevBadge, icon, fmtNum, critBadge } from '../lib/ui.js';

export async function render(view, { params }) {
  const rules = await api.get(withSystem('/api/findings'));
  const open = params.get('rule');
  const order = { critical: 0, serious: 1, warning: 2, info: 3 };
  rules.sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);
  const tot = sev => rules.filter(r => r.severity === sev).reduce((a, r) => a + r.count, 0);

  view.innerHTML = `<div class="page-head"><div><h1>Uyum &amp; Riskler</h1>
    <p>Envanter ile politika karşılaştırılarak otomatik üretilen bulgular. Taşıma öncesi/sonrası “hiçbir sunucu açıkta kalmasın” kontrol listesi olarak kullanılabilir.</p></div>
    <div class="actions"><a class="btn" href="#/reports/risk">${icon('download', 16)}Rapor</a></div></div>
  <div class="kpis">
    ${['critical', 'serious', 'warning', 'info'].map(s => `<div class="card kpi"><span class="label">${sevBadge(s)}</span><span class="value tnum">${fmtNum(tot(s))}</span><span class="sub">${rules.filter(r => r.severity === s && r.count).length} kural</span></div>`).join('')}
  </div>
  <div class="stack">${rules.map(r => `<details class="card finding ${r.severity}" ${open === r.id || (!open && r.severity === 'critical' && r.count) ? 'open' : ''} id="rule-${r.id}">
    <summary class="card-pad row" style="cursor:pointer;list-style:none">${sevBadge(r.severity)}<strong>${esc(r.title)}</strong><span class="spacer"></span>
      <span class="badge ${r.count ? '' : 'good'}">${r.count ? `${fmtNum(r.count)} kayıt` : `${icon('check', 12)}Temiz`}</span></summary>
    <div class="card-body" style="padding-top:0"><p class="small text-2" style="margin-top:0">${esc(r.description)}</p>
      ${r.count ? `<div class="table-wrap" style="max-height:420px"><table class="data"><thead><tr><th>${r.items[0]?.policy ? 'Policy' : 'Sunucu'}</th><th>Açıklama</th><th>Ortam</th><th>Kritiklik</th><th>Detay</th></tr></thead><tbody>
        ${r.items.map(it => `<tr><td><a href="#/${it.policy ? 'policy' : 'server'}/${it.id}"><strong>${esc(it.hostname)}</strong></a></td><td class="text-2">${esc(it.description || '—')}</td>
          <td>${esc(it.environment || '—')}</td><td>${critBadge(it.criticality)}</td><td class="small">${esc(it.detail || '')}</td></tr>`).join('')}
      </tbody></table></div>` : ''}</div></details>`).join('')}</div>`;
  if (open) view.querySelector(`#rule-${open}`)?.scrollIntoView({ block: 'start' });
}
