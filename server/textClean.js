// İçe aktarılan metinlerden hazırlık/çalışma notlarını temizler (kaynak dosya adı, "döküm" ifadeleri, satır numaraları).
// Uygulamada ve raporlarda yalnızca politikanın kendisi görünür.

const DROP_LINE = [
  /^\s*Kaynak\s*:/i,
  /^\s*Not\s*:\s*Aynı sunucu farklı alan adlarıyla/i,
];

const REPLACE = [
  [/\s*[–-]\s*NetBackup Policy Dökümünden Çıkarılan Özet\s*$/i, ''],
  [/\(dökümde en sık görülen yapı\)/gi, '(en sık kullanılan yapı)'],
  [/Dökümde Kullanılan Retention Level'lar/gi, "Kullanılan Retention Level'lar"],
  [/^(\s*•\s*Kaset saklama süresi:).*$/i, "$1 SLP schedule'larında Retention Level 0 (1 week) tanımlıdır; kaset üzerindeki gerçek saklama süresi SLP (Storage Lifecycle Policy) tanımında belirlenir."],
  [/\s*\(muhtemelen farklı NetBackup sunucusu\/dökümü\)/gi, ''],
  [/\bsatır \d+:\s*/gi, ''],
  [/\bAGO\.xlsx\b/gi, ''],
  // genel ifadeler
  [/dökümdeki/gi, 'tanımdaki'],
  [/dökümde/gi, 'tanımda'],
  [/dökümü/gi, 'tanımı'],
  [/döküm/gi, 'tanım'],
];

export function cleanText(text) {
  if (!text) return text;
  return String(text).split('\n')
    .filter(l => !DROP_LINE.some(re => re.test(l)))
    .map(l => REPLACE.reduce((acc, [re, to]) => acc.replace(re, to), l))
    .join('\n');
}
