import { api, state } from '../lib/api.js';
import { esc, icon, toast, confirmDialog, pickFile, relTime, DataTable } from '../lib/ui.js';
import { reloadMeta, refresh, navigate, invalidateSearch } from '../app.js';

export async function render(view) {
  const meta = state.meta;
  const audit = await api.get('/api/audit?limit=500');
  view.innerHTML = `<div class="page-head"><div><h1>Ayarlar</h1><p>İçe aktarma, veritabanı yedeği, retention level tanımları ve değişiklik geçmişi.</p></div></div>
  <div class="grid g2">
    <section class="card"><div class="card-head"><div><h3>Excel'den tam içe aktarma</h3><p>Politika özeti çalışma kitabını (Detay, Policy Listesi, export, İstisnalar) yükler.</p></div></div>
      <div class="card-body"><p class="small text-2" style="margin-top:0">Mevcut policy, sunucu, schedule ve notlar <strong>silinir</strong> ve dosyadaki verilerle yeniden oluşturulur (taşıma alanları dahil).
        İşlemden önce veritabanının otomatik bir kopyası yedek klasörüne alınır.</p>
        <button class="btn" data-full>${icon('upload', 16)}Excel seç ve içe aktar</button></div></section>
    <section class="card"><div class="card-head"><div><h3>Envanter güncelle</h3><p>CMDB export dosyası ("Hostname" kolonlu sayfa).</p></div></div>
      <div class="card-body"><p class="small text-2" style="margin-top:0">Sunucular hostname'e göre eşleşir: yeni olanlar eklenir, mevcutların envanter alanları güncellenir. Policy ve taşıma bilgileri korunur.</p>
        <button class="btn" data-inv>${icon('upload', 16)}Envanter dosyası seç</button></div></section>
    <section class="card"><div class="card-head"><div><h3>Veritabanı</h3><p>Tüm veri tek bir SQLite dosyasındadır.</p></div></div>
      <div class="card-body"><p class="small text-2" style="margin-top:0">Veritabanı uygulama klasöründen <strong>ayrı</strong> tutulur; uygulamayı güncellemek, silip yeniden kurmak veriyi etkilemez.</p>
        <dl class="info small mb"><dt>Veritabanı</dt><dd><code>${esc(meta.dbPath)}</code></dd><dt>Yedekler</dt><dd><code>${esc(meta.backupDir)}</code> (her gün otomatik, son 14 gün)</dd></dl>
        <p class="small text-2">Geri yüklemek için: uygulamayı durdurun, <code>npm run restore -- &lt;yedek-dosyası.db&gt;</code> çalıştırın ve yeniden başlatın.</p>
        <a class="btn" href="/api/backup/download">${icon('db', 16)}Veritabanı yedeğini indir</a></div></section>
    <section class="card"><div class="card-head"><div><h3>Genel</h3></div></div>
      <div class="card-body"><label class="field">Kurum / proje adı (menü ve PDF altbilgisinde görünür)<input id="cn" value="${esc(meta.companyName || '')}" placeholder="ör. Kurum – Backup Taşıma Projesi"></label>
        <button class="btn mt" data-savecn>${icon('check', 16)}Kaydet</button></div></section>
    <section class="card span2"><div class="card-head"><div><h3>Retention level tablosu</h3><p>NetBackup retention level → süre eşlemesi. Gün değeri RPO/geri dönüş derinliği hesaplarında kullanılır.</p></div>
      <div class="actions"><button class="btn sm" data-addlv>${icon('plus', 14)}Satır</button><button class="btn sm primary" data-savelv>${icon('check', 14)}Kaydet</button></div></div>
      <div class="card-body"><div class="table-wrap"><table class="data" id="lv"><thead><tr><th style="width:110px">Level</th><th>Etiket</th><th style="width:140px">Gün</th><th style="width:50px"></th></tr></thead><tbody>
        ${meta.levels.map(l => lvRow(l)).join('')}</tbody></table></div></div></section>
    <section class="card span2"><div class="card-head"><div><h3>Değişiklik geçmişi</h3><p>Son 500 kayıt</p></div></div><div class="card-body"><div id="audit"></div></div></section>
  </div>`;

  new DataTable(view.querySelector('#audit'), {
    rows: audit, pageSize: 25,
    columns: [
      { key: 'ts', label: 'Zaman', render: r => `<span class="nowrap">${esc(r.ts)}</span><div class="small muted">${relTime(r.ts)}</div>` },
      { key: 'entity', label: 'Tür', render: r => `<span class="badge">${esc({ server: 'Sunucu', policy: 'Policy', system: 'Sistem', inventory: 'Envanter' }[r.entity] || r.entity)}</span>` },
      { key: 'target', label: 'Kayıt', render: r => (r.target ? `<a href="#/${r.entity}/${r.entity_id}">${esc(r.target)}</a>` : '—') },
      { key: 'action', label: 'İşlem' },
      { key: 'summary', label: 'Özet', cls: 'cell-lines' },
    ],
  });

  const doImport = async (url, warn) => {
    if (warn && !await confirmDialog(warn, { ok: 'Devam et', danger: true })) return;
    const file = await pickFile('.xlsx');
    if (!file) return;
    toast('İçe aktarılıyor…');
    const r = await api.upload(url, file);
    toast(r.policies !== undefined ? `${r.policies} policy, ${r.schedules} schedule, ${r.servers} sunucu içe aktarıldı` : `${r.inserted} yeni, ${r.updated} güncellenen sunucu`);
    invalidateSearch();
    await reloadMeta();
    navigate('#/');
  };
  view.querySelector('[data-full]').addEventListener('click', () => doImport('/api/import/workbook', 'Mevcut tüm policy, sunucu ve taşıma verileri silinip Excel\'deki verilerle değiştirilecek. Devam edilsin mi?'));
  view.querySelector('[data-inv]').addEventListener('click', () => doImport('/api/import/inventory'));
  view.querySelector('[data-savecn]').addEventListener('click', async () => {
    await api.put('/api/settings', { company_name: view.querySelector('#cn').value });
    toast('Kaydedildi'); await reloadMeta();
  });
  const tbody = view.querySelector('#lv tbody');
  view.querySelector('[data-addlv]').addEventListener('click', () => {
    const max = Math.max(-1, ...[...tbody.querySelectorAll('[data-l=level]')].map(i => Number(i.value)));
    tbody.insertAdjacentHTML('beforeend', lvRow({ level: max + 1, label: '', days: '' }));
  });
  tbody.addEventListener('click', e => { if (e.target.closest('[data-rm]')) e.target.closest('tr').remove(); });
  view.querySelector('[data-savelv]').addEventListener('click', async () => {
    const levels = [...tbody.querySelectorAll('tr')].map(tr => ({
      level: tr.querySelector('[data-l=level]').value, label: tr.querySelector('[data-l=label]').value.trim(), days: tr.querySelector('[data-l=days]').value,
    })).filter(l => l.label);
    await api.put('/api/retention-levels', { levels });
    toast('Retention level tablosu kaydedildi');
    await reloadMeta(); refresh();
  });
}

const lvRow = l => `<tr><td><input type="number" data-l="level" value="${esc(l.level)}" style="width:90px"></td><td><input data-l="label" value="${esc(l.label)}" style="width:100%"></td>
  <td><input type="number" data-l="days" value="${esc(l.days)}" style="width:120px"></td><td><button class="icon-btn" data-rm aria-label="Sil">${icon('x', 14)}</button></td></tr>`;
