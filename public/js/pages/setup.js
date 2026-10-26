import { api, state } from '../lib/api.js';
import { icon, toast, esc } from '../lib/ui.js';
import { reloadMeta, navigate } from '../app.js';

export function render(view) {
  view.innerHTML = `<div class="setup card card-pad">
    <h1>Hoş geldiniz</h1>
    <p class="text-2">Başlamak için yedekleme politikası Excel dosyasını yükleyin. Dosyadaki <strong>Detay (Sunucu-Policy-Schedule)</strong>,
    <strong>Policy Listesi</strong>, <strong>export</strong> (envanter) ve <strong>İstisnalar ve Notlar</strong>
    sayfaları okunur; diğer tüm görünümler bu verilerden otomatik hesaplanır.</p>
    <div class="drop mt" id="drop">${icon('upload', 28)}<p style="margin:8px 0 0"><strong>Excel dosyasını sürükleyin</strong> ya da tıklayıp seçin</p><p class="small muted" style="margin:4px 0 0">.xlsx</p></div>
    <p class="small muted mt">Veriler uygulama klasöründen ayrı, kalıcı olarak şu dosyada tutulur: <code>${esc(state.meta.dbPath)}</code>. Uygulamayı güncellemek ya da yeniden kurmak veriyi silmez.</p>
    <div id="status"></div>
  </div>`;
  const drop = view.querySelector('#drop');
  const go = async file => {
    if (!file) return;
    view.querySelector('#status').innerHTML = `<p class="mt">“${esc(file.name)}” içe aktarılıyor…</p>`;
    try {
      const r = await api.upload('/api/import/workbook', file);
      toast(`${r.policies} policy, ${r.schedules} schedule, ${r.servers} sunucu içe aktarıldı`);
      await reloadMeta();
      navigate('#/');
    } catch (e) {
      view.querySelector('#status').innerHTML = `<p class="mt" style="color:var(--critical)">${esc(e.message)}</p>`;
    }
  };
  drop.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.xlsx';
    inp.onchange = () => go(inp.files[0]);
    inp.click();
  });
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); go(e.dataTransfer.files[0]); });
}
