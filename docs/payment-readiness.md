# Ödeme ve özel test yayını — 28 Eylül 2026

## Yayın durumu

`https://nanaskitchens.app` bilgisayardaki preview sürümüne bağlıdır. Cloudflare
Access tek kullanımlık e-posta koduyla yalnızca davetli kullanıcıları geçirir.
Ana sayfa, sohbet ve API yollarına anonim isteklerin Access girişine yönlendiği
doğrulandı. İlk davetli, e-posta koduyla gerçek alan adı üzerinden ana sayfaya
ulaştığını doğruladı. Tünel ayrıca Access JWT doğrulaması ister.

Bu bir sandbox yayınıdır. Ekranda “Private beta · Test payments only” görünür.
Çalıştırıcı canlı Stripe anahtarlarını reddeder; gerçek kurye ve harici uygulama
bildirimleri kapalıdır. Çalıştırma ve davetli yönetimi: [private-preview.md](private-preview.md).

## Doğrulanan akışlar

| Senaryo | Sonuç |
| --- | --- |
| Alıcı ve satıcı girişi | Preview tarayıcısında aynı origin `/api` üzerinden başarılı. |
| Pay ve tekrar tıklama | Stripe sandbox Checkout açılıyor; aynı sipariş aynı oturumu kullanıyor. |
| Reddedilen test kartı | Yetersiz bakiye hatası gösteriliyor; sipariş ödenmiş sayılmıyor. |
| Aynı Checkout'ta başarılı tekrar | Test kartı geçiyor; imzalı Stripe olayı siparişi onaylıyor. |
| Teslim alma adresi | Ödeme öncesinde gizli; onaylanınca sipariş sayfasında görünür. |
| Satıcı ve teslim alma | Satıcı ekranında kabul, hazırlama, hazır ve teslim edildi adımları geçti; alıcı bildirimleri geldi. |
| Ödeme öncesi iptal | Checkout expire oluyor; ikinci iptal/yeniden ödeme reddediliyor; stok bir kez geri geliyor. |
| Ödeme sonrası alıcı iptali | Stripe test iadesi `succeeded`; tutar eşleşiyor; stok geri geliyor. |
| İmzasız webhook | HTTP 401 ile reddediliyor. |
| Tekrarlanan/sırası değişen olaylar | İzole veritabanındaki entegrasyon testleri geçti. |
| Mobil görünüm | 390 px genişlikte taşma veya tarayıcı çalışma hatası yok. |

Hosted Checkout testi yerel preview tarayıcısında yapıldı. Başarılı dönüşün
`https://nanaskitchens.app/orders/<id>` olduğu kontrol edildi; test tarayıcısında
Cloudflare oturumu olmadığı için bu dönüş yerel preview'e yönlendirildi. Dolayısıyla
ödeme sonrası Cloudflare oturumunun korunması, alan adında yapılacak manuel ödeme
denemesiyle ayrıca doğrulanmalıdır. Sipariş onayı bu yönlendirmeye değil, gerçek
Stripe sandbox webhook'una dayanmıştır.

Kontroller: 57 web testi, 13 sipariş/ödeme entegrasyon testi ve 4 preview güvenlik
testi geçti. Üretim derlemesi ve TypeScript başarılı; lint 0 hata, mevcut 19 uyarı.
Java testleri yalnızca ayrı `nanas_preview_test` veritabanını kullandı.

## Canlı ödeme öncesinde açık kalanlar

- **Canlı hesap durumu:** Bu incelemede uygulamanın sandbox anahtarı kullanıldı.
  Canlı hesabın ödeme kabulü, banka hesabı, doğrulama gereksinimleri ve payout
  durumu henüz doğrulanmadı. Sandbox hesabının alanları canlı hesap için kanıt değildir.
- **Satıcıya para aktarımı:** `StripePaymentProvider` içinde Connect onboarding ve
  transfer uygulaması yok. Tahsilat platform hesabına gider; seller earnings ekranı
  bir hesaplama kaydıdır, banka ödemesi yapmaz. Satıcı ödemeleri uygulanmadan bu akış
  canlı bir pazar yeri olarak hazır sayılmaz.
- **Sürekli çalışan webhook:** Preview yerel Stripe CLI dinleyicisine bağlıdır.
  Canlı ortamda kalıcı, Stripe'ın erişebildiği ve imza doğrulayan bir endpoint gerekir;
  API sürümü ile SDK uyumu da bu endpoint üzerinden sınanmalıdır.
- **İade hata takibi:** Mevcut sağlayıcı hatalı iadeyi audit kaydına bırakıyor;
  yeniden deneme kuyruğu ve iade durum olaylarının işlenmesi yok. İade isteğinin
  idempotency anahtarı ve bekleyen/başarısız iadeler için operasyon akışı tamamlanmalı.

Bu açıklar davetli sandbox denemesini engellemez; gerçek para kabulü için çözülmeleri gerekir.
