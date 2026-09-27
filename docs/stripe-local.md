# Yerel Stripe test ödemeleri

Checkout ve sohbet siparişleri Pay düğmesiyle Stripe'ın barındırdığı ödeme sayfasına gider. Ödeme,
imzası doğrulanan `/webhooks/stripe` bildirimi geldikten sonra onaylanır.

`POST /orders/{id}/checkout` yalnızca siparişin sahibine açıktır. Bekleyen eski PaymentIntent
iptal edilir ve aynı sipariş için tek bir Checkout Session tekrar kullanılır. Session açıkken
`paymentIntentId` alanı `cs_...` referansını tutar; doğrulanmış ödeme bildirimi bunu gerçek
`pi_...` kimliğiyle değiştirir. İptal ve süre aşımı, açık oturumu da kapatır.
`WEB_BASE_URL` dönüş adresidir (yerelde `http://localhost:3000`, üretimde HTTPS).
Dashboard webhook'ları da `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed` ve `checkout.session.expired` olaylarını dinlemelidir.

1. Stripe sandbox hesabının test anahtarlarını kökteki, Git'in yok saydığı `.env`
   dosyasına `STRIPE_SECRET_KEY` ve `STRIPE_PUBLISHABLE_KEY` olarak kaydet.
2. Node 20.12+ ve Stripe CLI kurulu olmalı. Repo kökünde çalıştır:

   ```sh
   node scripts/stripe-listen.cjs
   ```

   Bu komut uygulamanın test anahtarını kullanır, webhook anahtarını `.env` içine
   kaydeder ve `PAYMENTS_PROVIDER=stripe` ayarlar. Anahtarları çıktıda göstermez.
   CLI farklı konumdaysa `STRIPE_CLI_PATH` ile çalıştırılabilir dosyasını belirt.
3. Java API'yi `.env` yüklenecek şekilde başlat veya yeniden başlat. Webhook
   dinleyicisi ödeme testi boyunca açık kalmalı. Java API portu `JAVA_API_PORT`
   ile belirlenir; varsayılan 8080'dir.
4. Web checkout'ta test kartı `4242 4242 4242 4242`, gelecekte bir son kullanma
   tarihi ve herhangi bir üç haneli CVC kullan. Gerçek kart kullanma.

Ödeme durumu: `pending` → Stripe webhook → `confirmed`. Alıcı siparişi iptal
ettiğinde test ödemesi iade edilir ve porsiyonlar geri yüklenir.

Bu yerel kurulum yalnızca sandbox içindir. Canlı ödeme ve Stripe Connect satıcı
onboarding/payout kurulumu ayrıca yapılmalıdır. Sohbet özelliği ayrıca kendi AI
sağlayıcısının anahtarını gerektirir.

Stripe referansları: [yerel webhook testi](https://docs.stripe.com/webhooks#local-listener),
[test kartları](https://docs.stripe.com/testing).
