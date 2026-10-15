# Devler Ligi Kuponu

Arkadaşlar arası Şampiyonlar Ligi kupon oyunu. Gerçek para yok; herkes 100 ile başlar, her maç haftası +50 alır ve kasasının yarısını oynamak zorundadır. Final sonrası kasası en dolu olan kazanır.

## Nasıl çalışır

| Parça | Nerede |
|---|---|
| Site | GitHub Pages (`index.html`, `style.css`, `js/`) |
| Hesaplar | Firebase Authentication: kullanıcı adı + şifre (e-posta istenmez) |
| Oyuncular, kuponlar, yönetici düzeltmeleri | Firestore (`players`, `coupons`, `overrides`, `adjust`, `resets`) |
| Maçlar, oranlar, sonuçlar | `data/feed.json` (saatte bir `scripts/update-feed.mjs` ile güncellenir: oranlar iddaa'dan, Nesine'dekiyle aynı değerler; sonuçlar ESPN'den) |
| Kasalar ve sıralama | Tarayıcıda hesaplanır (`js/logic.js`), saklanmaz |

Yöneticinin panelde yaptığı değişiklikler (`overrides`) `feed.json`'daki değerlerin önüne geçer.

## Kurulum

1. Firebase'de proje aç, **Authentication → Email/Password**'ü aç, **Firestore**'u production modda oluştur.
2. Web uygulaması ekleyip ayarları `js/firebase-config.js` dosyasına yaz.
3. Firebase → Project settings → **Service accounts** → *Generate new private key*. İnen JSON'un tamamını GitHub deposunda **Settings → Secrets and variables → Actions → New repository secret** ile `FIREBASE_SERVICE_ACCOUNT` adıyla kaydet. Bu gizli değer:
   - `firestore.rules` dosyasını Firebase'e yayınlar,
   - yöneticinin panelden istediği şifre sıfırlamalarını 5 dakikada bir uygular.
   (Kuralları elle yayınlamak istersen: Firestore → Rules sekmesine `firestore.rules` içeriğini yapıştır → Publish.)
4. GitHub → Settings → **Pages** → *Deploy from a branch* → `main` / `(root)`.
5. Site açılınca `…/#kurulum` adresine git ve kullanıcı adı **yonetici** olan hesabı oluştur. Bu hesap oyuncu sayılmaz, sadece Yönetim sekmesini görür.

## Yönetim

- **Oyuncular:** ad değiştirme, şifre sıfırlama, oyundan çıkarma.
- **Haftalar:** bülteni elle açma, hafta ekleme, final işaretleme.
- **Maçlar:** skor/durum girme, oran düzeltme, maç ekleme/kaldırma.
- **Kuponlar:** bir kuponu iptal etme (miktar kasaya döner).
- **Kasa düzeltmesi:** bir oyuncuya ekleme/düşme.
