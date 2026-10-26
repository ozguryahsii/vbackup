import { api, state, withSystem } from '../lib/api.js';
import { esc, icon, critBadge, tapeBadge, coverageBadge, migBadge, modal, toast, confirmDialog, relTime, trLower, fmtNum } from '../lib/ui.js';
import { catColor, bindTips } from '../lib/charts.js';
import {
  DAYS_SHORT, DAYS_TR, CATEGORY_LABELS, typeLabel, describeWhen, describeWindows, retentionText, rpoText, runBitmap, runsOn, hhmm,
} from '../lib/schedule.js';
import { serverFormModal, migrationFormModal } from '../lib/forms.js';
import { setCrumbs, navigate, refresh, invalidateSearch } from '../app.js';

const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Pazartesi başlangıçlı
const sampleDate = (week, day) => new Date(2026, 2, 1 + (week - 1) * 7 + day); // 1 Mart 2026 Pazar

export async function render(view, { match }) {
  const id = Number(match[1]);
  const d = await api.get(withSystem(`/api/servers/${id}`));
  const s = d.server, sum = d.summary;
  setCrumbs([{ label: 'Envanter', href: '#/inventory' }, { label: s.hostname }]);
  const active = d.policies.filter(p => p.active);
  const passive = d.policies.filter(p => !p.active);
  const activeScheds = active.flatMap(p => p.schedules.map(x => ({ ...x, policy: p })));
  const lv = state.meta.levels;
  const strip = t => t.replace(/^\[[^\]]+\]\s*/, '');

  const answers = [
    ['Yedekleniyor mu?', sum.covered ? `Evet — ${sum.active_count} aktif policy${sum.passive_count ? `, ayrıca ${sum.passive_count} pasif policy` : ''}` : sum.passive_count ? `Hayır — yalnızca ${sum.passive_count} pasif (Active=no) policy'de tanımlı` : 'Hayır — hiçbir policy\'de yok'],
    ['Hangi yöntemle?', sum.methods.join('\n') || '—'],
    ['Full yedek', sum.full_lines.map(strip).join('\n') || '—'],
    ['Incremental / Log', sum.incr_lines.map(strip).join('\n') || '—'],
    ['Kasete çıkıyor mu?', sum.tape_status === 'EVET' ? `Evet\n${sum.tape_lines.map(strip).join('\n')}` : sum.tape_status === 'HAYIR' ? 'Hayır' : "Yalnızca pasif policy'de SLP tanımı var"],
    ['Tahmini RPO', sum.rpo_hours ? `${rpoText(sum.rpo_hours)} — iki disk yedeği arasındaki en uzun süre` : '—'],
    ['Geri dönüş derinliği', sum.max_retention_days ? `${sum.max_retention_days} gün (disk yedeklerindeki en uzun saklama)${sum.full_retention_days ? ` · Full saklama: ${sum.full_retention_days} gün` : ''}` : '—'],
  ];

  view.innerHTML = `<div class="page-head">
    <div><div class="row" style="gap:10px"><h1>${esc(s.hostname)}</h1>${coverageBadge(sum)}${critBadge(s.criticality)}${s.environment ? `<span class="badge">${esc(s.environment)}</span>` : ''}${migBadge(s.mig_status)}</div>
      <p>${esc(s.description || 'Açıklama yok')}${s.source === 'policy' ? ' · <span class="badge warn">Envanterde (CMDB) kaydı yok</span>' : ''}</p></div>
    <div class="actions">
      <button class="btn" data-edit>${icon('edit', 16)}Envanter bilgisi</button>
      <button class="btn" data-addpol>${icon('plus', 16)}Policy'ye ekle</button>
      <a class="btn" href="#/policy/new?server=${s.id}">${icon('shield', 16)}Bu sunucu için policy</a>
    </div></div>

  <div class="grid g3">
    <section class="card span2"><div class="card-head"><div><h3>Bu sunucu nasıl yedekleniyor?</h3><p>Aktif policy'lerden otomatik derlenir</p></div></div>
      <div class="card-body"><div class="answer">${answers.map(([q, a]) => `<div class="q">${esc(q)}</div><div class="a">${esc(a)}</div>`).join('')}</div></div></section>
    <section class="card"><div class="card-head"><h3>Envanter</h3></div><div class="card-body"><dl class="info">
      ${[['IP', s.ip], ['Domain', s.domain], ['Platform', s.platform], ['İşletim sistemi', s.os], ['Kaynak', `${s.vcpu ?? '—'} vCPU · ${s.ram_gb ?? '—'} GB RAM · ${s.disk_gb ? fmtNum(s.disk_gb) + ' GB disk' : '—'}`],
        ['Durum', s.status], ['Sahip ekip', s.owner_team], ['Envanter anahtarı', s.inventory_key], ['Notlar', s.notes]]
        .map(([k, v]) => `<dt>${k}</dt><dd>${esc(v || '—')}</dd>`).join('')}
    </dl></div></section>

    <section class="card span2"><div class="card-head"><div><h3>Haftalık yedek penceresi</h3><p>Aktif schedule pencereleri (uygulama tetikli pencereler hariç)</p></div>
      <div class="seg" id="tlw">${['Tüm haftalar', '1', '2', '3', '4', '5'].map((w, i) => `<button data-w="${i}" class="${i === 0 ? 'on' : ''}">${i ? w + '. hf' : w}</button>`).join('')}</div></div>
      <div class="card-body"><div id="timeline"></div>
      <div class="legend">${['full', 'incr', 'log', 'tape'].map(c => `<span><i class="sw" style="background:${catColor(c)}"></i>${CATEGORY_LABELS[c]}</span>`).join('')}</div></div></section>
    <section class="card"><div class="card-head"><div><h3>Aylık desen</h3><p>Ayın haftası × gün (F: Full, I: Incr, L: Log, K: Kaset)</p></div></div>
      <div class="card-body"><div id="month"></div></div></section>
  </div>

  <h2 class="mt mb" style="margin-top:24px">Policy'ler <span class="muted">(${active.length} aktif${passive.length ? `, ${passive.length} pasif` : ''})</span></h2>
  <div class="stack" id="pols">${d.policies.length ? d.policies.map(p => policyCard(p, lv)).join('') : '<div class="card empty">Bu sunucu hiçbir policy\'de yer almıyor. “Policy\'ye ekle” ile mevcut bir policy\'ye ekleyebilir ya da yeni policy oluşturabilirsiniz.</div>'}</div>

  <div class="grid g3 mt" style="margin-top:24px">
    <section class="card"><div class="card-head"><h3>Taşıma</h3><button class="btn sm" data-mig>${icon('edit', 14)}Düzenle</button></div><div class="card-body"><dl class="info">
      ${[['Durum', migBadge(s.mig_status)], ['Dalga', esc(s.mig_wave || '—')], ['Hedef tarih', esc(s.mig_target_date || '—')], ['Sorumlu', esc(s.mig_owner || '—')],
        ['Hedef çözüm', esc(s.mig_target || '—')], ['İlk başarılı yedek', esc(s.mig_first_backup || '—')], ['Test restore', esc(s.mig_restore_test || '—')], ['Notlar', esc(s.mig_notes || '—')]]
        .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></div></section>
    <section class="card"><div class="card-head"><h3>İstisnalar ve notlar</h3><button class="btn sm" data-addnote>${icon('plus', 14)}Not</button></div>
      <div class="card-body"><ul class="list-plain">${d.exceptions.map(e => `<li class="row" style="align-items:flex-start;flex-wrap:nowrap">
        <input type="checkbox" data-resolve="${e.id}" ${e.resolved ? 'checked' : ''} title="Çözüldü olarak işaretle">
        <span style="flex:1;${e.resolved ? 'text-decoration:line-through;color:var(--muted)' : ''}">${esc(e.text)}</span>
        <button class="icon-btn" style="width:26px;height:26px" data-delnote="${e.id}" aria-label="Sil">${icon('trash', 14)}</button></li>`).join('') || '<li class="muted">Not yok</li>'}</ul></div></section>
    <section class="card"><div class="card-head"><h3>Değişiklik geçmişi</h3></div><div class="card-body"><ul class="list-plain">
      ${d.audit.map(a => `<li><div class="small">${esc(a.summary)}</div><div class="small muted">${relTime(a.ts)} · ${esc(a.ts)}</div></li>`).join('') || '<li class="muted">Kayıt yok</li>'}</ul></div></section>
  </div>
  <div class="row mt" style="margin-top:24px"><span class="spacer"></span><button class="btn danger" data-delete>${icon('trash', 16)}Sunucuyu sil</button></div>`;

  bindTips(view);
  const drawTimeline = week => { view.querySelector('#timeline').innerHTML = timelineHTML(activeScheds, week); };
  drawTimeline(0);
  view.querySelector('#month').innerHTML = monthHTML(activeScheds);
  view.querySelector('#tlw').addEventListener('click', e => {
    const b = e.target.closest('[data-w]');
    if (!b) return;
    view.querySelectorAll('#tlw button').forEach(x => x.classList.toggle('on', x === b));
    drawTimeline(Number(b.dataset.w));
  });

  view.querySelector('[data-edit]').addEventListener('click', () => serverFormModal(s, () => { invalidateSearch(); refresh(); }));
  view.querySelector('[data-mig]').addEventListener('click', () => migrationFormModal(s, refresh));
  view.querySelector('[data-addpol]').addEventListener('click', () => addToPolicy(s, d.policies));
  view.querySelector('[data-addnote]').addEventListener('click', () => {
    modal({
      title: 'Not / istisna ekle', body: '<textarea id="nt" rows="4" placeholder="ör. Uygulama ekibi haftalık yedeği yeterli buldu (onay: …)"></textarea>',
      foot: '<button class="btn" data-close>Vazgeç</button><button class="btn primary" data-ok>Ekle</button>',
      onMount: (el, close) => el.querySelector('[data-ok]').addEventListener('click', async () => {
        const text = el.querySelector('#nt').value.trim();
        if (!text) return;
        await api.post('/api/exceptions', { server_id: s.id, text });
        close(); refresh();
      }),
    });
  });
  view.addEventListener('change', async e => {
    if (e.target.matches('[data-resolve]')) { await api.put(`/api/exceptions/${e.target.dataset.resolve}`, { resolved: e.target.checked }); refresh(); }
  });
  view.addEventListener('click', async e => {
    const del = e.target.closest('[data-delnote]');
    if (del && await confirmDialog('Not silinsin mi?', { ok: 'Sil', danger: true })) { await api.del(`/api/exceptions/${del.dataset.delnote}`); refresh(); }
    const rm = e.target.closest('[data-removefrom]');
    if (rm) {
      const p = d.policies.find(x => x.id === Number(rm.dataset.removefrom));
      if (!await confirmDialog(`${s.hostname}, “${p.name}” policy'sinden çıkarılsın mı?`, { ok: 'Çıkar', danger: true })) return;
      const full = await api.get(`/api/policies/${p.id}`);
      await api.put(`/api/policies/${p.id}`, { ...full, client_ids: full.clients.map(c => c.id).filter(x => x !== s.id), schedules: undefined });
      toast('Policy\'den çıkarıldı'); refresh();
    }
    if (e.target.closest('[data-delete]')) {
      if (!await confirmDialog(`${s.hostname} envanterden ve tüm policy'lerden silinsin mi? Bu işlem geri alınamaz.`, { ok: 'Sil', danger: true })) return;
      await api.del(`/api/servers/${s.id}`);
      invalidateSearch(); toast('Sunucu silindi'); navigate('#/inventory');
    }
  });
}

function policyCard(p, lv) {
  const others = p.clients.filter(c => c.hostname).length;
  return `<section class="card ${p.active ? '' : 'finding warning'}">
    <div class="card-head"><div><div class="row" style="gap:8px"><a href="#/policy/${p.id}"><h3>${esc(p.name)}</h3></a>
      ${p.active ? '<span class="badge good">Aktif</span>' : '<span class="badge warn">Pasif</span>'}<span class="badge">${esc(p.policy_type || '—')}</span>
      ${p.backup_system ? `<span class="badge blue">${esc(p.backup_system)}</span>` : ''}</div>
      <p>${esc(p.method || '')}${p.client_name ? ` · istemci adı: <span class="mono">${esc(p.client_name)}</span>` : ''} · Bu policy'de toplam ${p.peers} sunucu</p></div>
      <div class="actions"><a class="btn sm" href="#/policy/${p.id}">${icon('edit', 14)}Düzenle</a><button class="btn sm ghost danger" data-removefrom="${p.id}">Çıkar</button></div></div>
    <div class="card-body">
      ${p.include_list ? `<div class="small text-2 mb">İçerik (include): <span class="mono">${esc(p.include_list.replace(/\n/g, ', '))}</span></div>` : ''}
      <div class="table-wrap"><table class="data"><thead><tr><th>Schedule</th><th>Tür</th><th>Ne zaman</th><th>Pencere</th><th>Saklama</th></tr></thead><tbody>
      ${p.schedules.map(x => `<tr><td><span class="dot" style="background:${catColor(x.category)}"></span> <strong>${esc(x.name)}</strong>${x.tape ? ` <span class="badge blue">${icon('tape', 12)}${esc(x.tape)}</span>` : ''}</td>
        <td>${esc(typeLabel(x.backup_type))}</td><td>${esc(describeWhen(x))}</td><td class="small">${esc(describeWindows(x.windows))}</td><td class="nowrap">${esc(retentionText(x.retention_level, lv))}</td></tr>`).join('')}
      </tbody></table></div>
      ${others > 1 ? `<details class="small mt"><summary>Aynı policy'deki diğer sunucular (${p.peers})</summary><p>${p.clients.map(c => `<a href="#/server/${c.id}">${esc(c.hostname)}</a>`).join(', ')}${p.peers > p.clients.length ? ' …' : ''}</p></details>` : ''}
    </div></section>`;
}

function timelineHTML(scheds, week) {
  const rows = ORDER.map(day => ({ day, bars: [] }));
  const byDay = new Map(rows.map(r => [r.day, r]));
  for (const s of scheds) {
    if (s.category === 'app') continue;
    for (const w of s.windows) {
      if (week) {
        const runs = runsOn(s, sampleDate(week, w.d)) || (s.freq_unit && s.freq_unit !== 'day');
        if (!runs) continue;
      } else if (!runBitmap(s).some(Boolean) && !(s.freq_unit && s.freq_unit !== 'day')) continue;
      // pencereyi günlere böl
      let start = w.d * 1440 + w.s;
      let end = w.ed * 1440 + w.e;
      if (end <= start) end += 7 * 1440;
      const tip = `${s.policy.name} · ${s.name}\n${typeLabel(s.backup_type)}: ${describeWhen(s)}\n${DAYS_TR[w.d]} ${hhmm(w.s)} → ${DAYS_TR[w.ed]} ${hhmm(w.e)}`;
      for (let t = start; t < end;) {
        const dayIdx = Math.floor(t / 1440) % 7;
        const dayStart = Math.floor(t / 1440) * 1440;
        const segEnd = Math.min(end, dayStart + 1440);
        byDay.get(dayIdx).bars.push({ from: t - dayStart, to: segEnd - dayStart, cat: s.category, tip });
        t = segEnd;
      }
    }
  }
  const axis = [0, 3, 6, 9, 12, 15, 18, 21, 24];
  return `<div class="timeline">${rows.map(r => {
    const n = r.bars.length;
    return `<div class="tl-day">${DAYS_SHORT[r.day]}</div><div class="tl-track" style="height:${Math.max(22, Math.min(n, 4) * 7 + 8)}px">${r.bars.map((b, i) => {
      const lane = n > 1 ? i % Math.min(n, 4) : 0;
      const lanes = Math.min(n, 4);
      const h = lanes > 1 ? `top:${3 + lane * ((Math.max(22, lanes * 7 + 8) - 6) / lanes)}px;height:${(Math.max(22, lanes * 7 + 8) - 6) / lanes - 1}px;bottom:auto;` : '';
      return `<div class="tl-bar" style="left:${(b.from / 1440) * 100}%;width:${((b.to - b.from) / 1440) * 100}%;background:${catColor(b.cat)};${h}" data-tip="${esc(b.tip)}"></div>`;
    }).join('')}</div>`;
  }).join('')}<div></div><div class="tl-axis">${axis.map(h => `<span style="left:${(h / 24) * 100}%">${String(h).padStart(2, '0')}</span>`).join('')}</div></div>`;
}

function monthHTML(scheds) {
  const cells = Array.from({ length: 35 }, () => ({ full: [], incr: [], log: [], tape: [] }));
  for (const s of scheds) {
    if (s.category === 'app') continue;
    runBitmap(s).forEach((v, i) => { if (v) cells[i][s.category].push(`${s.policy.name.replace(/^AGO_/, '')} · ${s.name}`); });
  }
  const label = { full: 'F', incr: 'I', log: 'L', tape: 'K' };
  let html = `<div class="month-matrix"><div></div>${ORDER.map(d => `<div class="mh">${DAYS_SHORT[d]}</div>`).join('')}`;
  for (let w = 0; w < 5; w++) {
    html += `<div class="ml">${w + 1}. hafta</div>`;
    for (const d of ORDER) {
      const c = cells[w * 7 + d];
      const tip = ['full', 'incr', 'log', 'tape'].filter(k => c[k].length).map(k => `${CATEGORY_LABELS[k]}: ${c[k].join(', ')}`).join('\n');
      html += `<div class="mc" ${tip ? `data-tip="${esc(`Ayın ${w + 1}. haftası ${DAYS_TR[d]}\n${tip}`)}"` : ''}>${['full', 'incr', 'log', 'tape'].filter(k => c[k].length).map(k => `<span class="chip ${k}">${label[k]}</span>`).join('')}</div>`;
    }
  }
  return html + '</div>';
}

async function addToPolicy(server, current) {
  const list = await api.get('/api/policies');
  const have = new Set(current.map(p => p.id));
  const { el, close } = modal({
    title: `${server.hostname} – policy'ye ekle`,
    wide: true,
    body: `<input type="search" id="pq" placeholder="Policy ara…" style="width:100%">
      <div class="client-list mt" id="pl" style="height:380px"></div>`,
  });
  const draw = () => {
    const q = trLower(el.querySelector('#pq').value);
    el.querySelector('#pl').innerHTML = list.filter(p => !have.has(p.id) && (!q || trLower(p.name).includes(q))).slice(0, 200).map(p => `
      <label data-pid="${p.id}"><div style="flex:1"><strong>${esc(p.name)}</strong> ${p.active ? '' : '<span class="badge warn">Pasif</span>'}
      <div class="meta">${esc(p.policy_type || '')} · ${p.clients} sunucu · ${esc(p.summary.slice(0, 2).join(' / '))}</div></div></label>`).join('') || '<div class="empty">Eşleşen policy yok</div>';
  };
  draw();
  el.querySelector('#pq').addEventListener('input', draw);
  el.querySelector('#pl').addEventListener('click', async e => {
    const lab = e.target.closest('[data-pid]');
    if (!lab) return;
    const full = await api.get(`/api/policies/${lab.dataset.pid}`);
    await api.put(`/api/policies/${full.id}`, { ...full, client_ids: [...full.clients.map(c => c.id), server.id], schedules: undefined });
    toast(`${full.name} policy'sine eklendi`);
    close(); refresh();
  });
}
