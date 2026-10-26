# vbackup — Sunucu Bazlı Yedekleme Politikası Takibi

Bir sunucunun **hangi yöntemle, hangi sıklıkta, hangi pencerede, ne kadar saklamayla yedeklendiğini ve kasete çıkıp çıkmadığını**
tek yerden takip etmek için yerel çalışan bir web uygulaması. Kısa dönemli bir backup taşıma projesi için tasarlandı:
mevcut (NetBackup) politikasını Excel'den alır, görselleştirir, raporlar ve taşıma ilerlemesini izler.

> [!IMPORTANT]
> **Güncelleme için tekrar `git clone` yapmayın.** Kurulum bir kez yapılır; sonraki tüm güncellemeler için
> uygulama klasöründe şunu çalıştırmanız yeterli:
>
> ```bash
> ./scripts/update.sh
> ```
>
> Verileriniz uygulama klasöründen ayrı (`~/Library/Application Support/vbackup/`) tutulduğu için güncelleme veriyi etkilemez.

## Kurulum (macOS) — yalnızca ilk sefer

Gereksinim: **Node.js 22.13 veya üzeri** (`brew install node`). Başka bir veritabanı ya da servis gerekmez.

```bash
git clone https://github.com/ozguryahsii/vbackup.git
cd vbackup
npm install
npm start            # → http://localhost:3000
```

İlk açılışta uygulama boş gelir ve Excel dosyasını ister. Politika Excel'ini sürükleyip bırakmanız yeterli.
Alternatif: `npm run seed -- /yol/dosya.xlsx`.

Bilgisayar açıldığında otomatik başlasın isterseniz:

```bash
./scripts/macos-autostart.sh install     # kaldırmak için: uninstall
```

> Uygulama varsayılan olarak yalnızca `127.0.0.1` üzerinden dinler. Ağdaki başka bir bilgisayardan erişmek gerekirse
> `HOST=0.0.0.0 npm start` ile başlatın (kimlik doğrulama yoktur; güvenli bir ağda kullanın).

## Veri nerede? (uygulamadan ayrı, kalıcı)

Veritabanı uygulama klasörünün **dışında** tutulur. Uygulamayı durdurmak, Mac'i yeniden başlatmak, uygulamayı güncellemek,
klasörü silip yeniden `git clone` yapmak **veriyi silmez**.

| | Konum (macOS) |
|---|---|
| Veritabanı | `~/Library/Application Support/vbackup/vbackup.db` |
| Otomatik yedekler | `~/Library/Application Support/vbackup/backups/` (her gün, son 14 gün; ayrıca tam içe aktarma, toplu silme ve geri yükleme öncesinde) |
| Log (otomatik başlatmada) | `~/Library/Logs/vbackup.log` |

Farklı bir konum (ör. iCloud Drive ya da harici disk) için: `VBACKUP_DATA_DIR=/yol/klasör npm start`.
Konumlar uygulamada Ayarlar → Veritabanı bölümünde de görünür.

Eski sürümde veri uygulama klasöründeki `data/` altındaydı; yeni sürüm ilk açılışta bu veriyi otomatik olarak yeni konuma kopyalar.

### Güncelleme

Yeniden clone'lamaya gerek yok; uygulama klasöründe:

```bash
./scripts/update.sh        # git pull + npm install (+ otomatik başlatma kuruluysa yeniden başlatır)
```

### Yedekten geri yükleme

Uygulamayı durdurun (Ctrl+C ya da `./scripts/macos-autostart.sh uninstall`), sonra:

```bash
npm run restore -- ~/Library/Application\ Support/vbackup/backups/vbackup-2026-10-26.db
npm run restore -- ~/eski/vbackup      # eski bir uygulama klasöründeki data/vbackup.db'yi alır
```

Komut, üzerine yazmadan önce mevcut veritabanının da bir kopyasını alır; uygulama çalışıyorsa işlem yapmaz.
Ayarlar → “Veritabanı yedeğini indir” ile istediğiniz an kopya indirebilirsiniz.

## Menüler

| Menü | Ne işe yarar |
|---|---|
| **Gösterge Paneli** | Kapsam, kaset, policy, kritik bulgu ve taşıma KPI'ları; ortama göre kapsam, RPO dağılımı, bugün çalışacak yedekler, son değişiklikler. |
| **İstatistikler** | Excel sayfalarına karşılık gelen sekmeler: Genel Politika, Sunucu Bazlı, Kaset (SLP), Yedek Pencereleri (gün × saat yoğunluk haritası), Policy, Taşıma. Her grafik tablo görünümüne çevrilebilir; çubuklara tıklayınca ilgili sunucu listesine gidilir. |
| **Yedek Takvimi** | Ay takvimi: her gün kaç sunucunun Full / Incremental / Log / Kaset yedeği var. Bir güne tıklayınca o gün çalışacak schedule'lar, pencereleri ve sunucuları. |
| **Envanter** | Tüm sunucular (CMDB export + policy'lerde geçen sunucular), filtreler (ortam, kritiklik, yedek var/yok, kaset, RPO…), sunucu ekleme, envanter dosyasıyla güncelleme. |
| **Sunucu kartı** | “Bu sunucu nasıl yedekleniyor?” cevabı (yöntem, Full, Incr/Log, kaset, RPO, geri dönüş derinliği), haftalık pencere zaman çizelgesi, aylık desen matrisi, policy'ler, notlar, taşıma bilgisi, değişiklik geçmişi. |
| **Politikalar** | Policy listesi ve editörü: istemciler envanterden seçilir; schedule'lar görsel takvim ızgarası (gün × ayın haftası), frekans, pencere, saklama ve kaset (SLP) ile tanımlanır; Türkçe özet canlı üretilir. Hazır şablonlar (VM günlük, aylık SLP, Oracle RMAN/ARCH, MS-SQL…). “Genel Politika” metni de buradan düzenlenir. |
| **Taşıma Takibi** | Sunucu bazında dalga, durum, hedef tarih, sorumlu, hedef çözüm, ilk başarılı yedek ve test restore; toplu güncelleme; gecikme ve “restore testi bekliyor” uyarıları. |
| **Uyum & Riskler** | Otomatik kurallar: yedeksiz aktif PROD sunucu, yedeksiz yüksek kritik sunucu, kasete çıkmayan yüksek kritik sunucu, RPO'su 1 günden uzun kritik sunucu, işletimden çıkmış ama yedeklenen sunucu, envanterde olmayan istemci, yalnızca pasif policy, gecikmiş taşıma… |
| **Raporlar** | Excel sayfalarıyla aynı yapıda raporlar; filtreli önizleme; **Excel** ve **PDF** çıktısı; “Tüm raporlar” tek dosyada. |
| **Ayarlar** | Excel'den tam içe aktarma, envanter güncelleme, retention level tablosu, kurum adı, veritabanı yedeği, değişiklik geçmişi. |

### Yedekleme sistemi (mevcut ↔ hedef)

Her policy bir “yedekleme sistemine” aittir. İçe aktarılanlar `NetBackup (Mevcut)` olarak gelir. Taşıma için bir policy'yi
**Kopyala → “Yeni Sistem (Hedef)”** ile çoğaltıp hedef politikayı tasarlayabilir, üst menüdeki sistem filtresiyle tüm
ekranları (istatistik, rapor, takvim) mevcut ya da hedef sisteme göre görebilirsiniz.

## Hesaplama notları

- **Ayın N. haftası**: NetBackup mantığıyla o haftagününün aydaki N. tekrarı (1–7 → 1. hafta, 8–14 → 2. hafta …).
- **Tahmini RPO**: aktif disk schedule'larının (kaset ve uygulama tetikli hariç) birleşiminde iki yedek arasındaki en uzun süre.
  Saatlik/dakikalık frekanslı schedule'larda frekans değeri alınır.
- **Kaset saklama süresi**: SLP schedule'larının retention değeri dökümde “0 (1 week)” görünür; kasetteki gerçek saklama
  SLP tanımındadır ve Excel'de yoktur — uygulama bu değeri aynen gösterir.
- **Kapsam istatistikleri**: envanterde `Aktif` durumdaki sunucular ile aktif policy'si olan sunucular üzerinden hesaplanır.

## Excel formatı

Tam içe aktarma şu sayfaları okur (sayfa adları ya da başlıkları ile bulunur):
`Detay (Sunucu-Policy-Schedule)`, `Policy Listesi`, `export` (envanter), `Sunucu Bazlı Politika` (sunucu görevi),
`İstisnalar ve Notlar`, `Genel Politika`. Envanter güncellemesi için `Hostname` kolonu olan herhangi bir sayfa yeterlidir
(`Domain Name`, `IP Adresi`, `Ortam`, `Platform`, `vCPU`, `RAM (GB)`, `Disk (GB)`, `Sunucu Durumu`, `Açıklama`, `Kritiklik Seviyesi`, `OS Ref` …).

## Geliştirme

```bash
npm run dev    # dosya değişince yeniden başlar
npm test       # schedule hesaplama testleri
```

Yapı: `server/` (Express + yerleşik `node:sqlite`, içe aktarma, analiz, rapor), `public/` (derleme adımı olmayan
vanilla JS arayüz, Chart.js), `public/js/lib/schedule.js` (sunucu ve tarayıcının ortak kullandığı takvim/açıklama/RPO mantığı).
