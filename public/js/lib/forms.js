// Paylaşılan form modalları
import { api, state } from './api.js';
import { esc, modal, options, formData, toast } from './ui.js';

const INV_FIELDS = [
  ['hostname', 'Hostname *'], ['domain', 'Domain'], ['ip', 'IP adresi'], ['environment', 'Ortam', 'environments'],
  ['platform', 'Platform', 'platforms'], ['os', 'İşletim sistemi'], ['vcpu', 'vCPU', null, 'number'], ['ram_gb', 'RAM (GB)', null, 'number'],
  ['disk_gb', 'Disk (GB)', null, 'number'], ['status', 'Sunucu durumu', 'statuses'], ['criticality', 'Kritiklik', 'criticalities'],
  ['owner_team', 'Sahip ekip'], ['location', 'Lokasyon'], ['inventory_key', 'Envanter anahtarı'],
];

export function serverFormModal(server = {}, onSaved) {
  const m = state.meta;
  const field = ([key, label, list, type]) => {
    const v = server[key] ?? '';
    if (list) {
      const id = `dl-${key}`;
      return `<label class="field">${esc(label)}<input name="${key}" value="${esc(v)}" list="${id}"><datalist id="${id}">${(m[list] || []).map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>`;
    }
    return `<label class="field">${esc(label)}<input name="${key}" type="${type || 'text'}" value="${esc(v)}"></label>`;
  };
  modal({
    title: server.id ? `${server.hostname} – envanter bilgisi` : 'Yeni sunucu',
    wide: true,
    body: `<form class="form-grid" id="sf">${INV_FIELDS.map(field).join('')}
      <label class="field wide">Açıklama / Sunucu görevi<input name="description" value="${esc(server.description ?? '')}"></label>
      <label class="field wide">Notlar<textarea name="notes" rows="3">${esc(server.notes ?? '')}</textarea></label></form>`,
    foot: '<button class="btn" data-close>Vazgeç</button><button class="btn primary" data-save>Kaydet</button>',
    onMount: (el, close) => {
      el.querySelector('[data-save]').addEventListener('click', async () => {
        const body = formData(el.querySelector('#sf'));
        if (!body.hostname.trim()) return toast('Hostname zorunludur', 'err');
        const r = server.id ? await api.put(`/api/servers/${server.id}`, body) : await api.post('/api/servers', body);
        toast('Kaydedildi');
        close();
        onSaved?.(server.id || r.id);
      });
    },
  });
}

export function migrationFormModal(server, onSaved) {
  const m = state.meta;
  modal({
    title: `${server.hostname} – taşıma bilgisi`,
    body: `<form class="form-grid" id="mf">
      <label class="field">Durum<select name="mig_status">${options(m.migStatuses, server.mig_status || 'Planlanmadı')}</select></label>
      <label class="field">Dalga<input name="mig_wave" value="${esc(server.mig_wave ?? '')}" list="dl-waves" placeholder="ör. Dalga 1"><datalist id="dl-waves">${m.waves.map(w => `<option value="${esc(w)}">`).join('')}</datalist></label>
      <label class="field">Hedef tarih<input type="date" name="mig_target_date" value="${esc(server.mig_target_date ?? '')}"></label>
      <label class="field">Sorumlu<input name="mig_owner" value="${esc(server.mig_owner ?? '')}" list="dl-owners"><datalist id="dl-owners">${m.owners.map(w => `<option value="${esc(w)}">`).join('')}</datalist></label>
      <label class="field wide">Hedef policy / çözüm<input name="mig_target" value="${esc(server.mig_target ?? '')}" placeholder="ör. Yeni sistem – VM günlük + aylık kaset"></label>
      <label class="field">İlk başarılı yedek<input type="date" name="mig_first_backup" value="${esc(server.mig_first_backup ?? '')}"></label>
      <label class="field">Test restore tarihi<input type="date" name="mig_restore_test" value="${esc(server.mig_restore_test ?? '')}"></label>
      <label class="field wide">Notlar<textarea name="mig_notes" rows="3">${esc(server.mig_notes ?? '')}</textarea></label></form>`,
    foot: '<button class="btn" data-close>Vazgeç</button><button class="btn primary" data-save>Kaydet</button>',
    onMount: (el, close) => {
      el.querySelector('[data-save]').addEventListener('click', async () => {
        await api.put(`/api/servers/${server.id}`, formData(el.querySelector('#mf')));
        toast('Taşıma bilgisi kaydedildi');
        close();
        onSaved?.();
      });
    },
  });
}
