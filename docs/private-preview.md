# Davetli test sitesi

Bu kurulum `nanaskitchens.app` alanını bilgisayarda çalışan uygulamaya bağlar.
ECS oluşturmaz. Bilgisayarın, Docker'ın ve aşağıdaki süreçlerin açık kalması gerekir.
Ödemeler Stripe sandbox, kurye işlemleri mock, uygulama bildirimleri log modundadır.

## Erişim korumasını önce kur

1. Cloudflare Zero Trust içinde ücretsiz organizasyonu ve e-posta ile tek kullanımlık
   kod girişini etkinleştir.
2. `nanaskitchens.app` için **Self-hosted** Access uygulaması oluştur. Path boş
   kalsın; böylece `/api`, dosyalar ve bütün sayfalar aynı korumayı kullanır.
3. Tek bir **Allow** politikasında yalnızca davetlilerin tam e-posta adreslerini
   seç. `Everyone` veya `Bypass` kuralı kullanma. Bu giriş, uygulamanın kendi
   alıcı/satıcı girişinden ayrıdır.
4. Uygulamanın **Application Audience (AUD)** değerini ve organizasyonun
   `*.cloudflareaccess.com` öncesindeki takım adını kaydet.
5. Access politikasını doğruladıktan sonra alan adını adlı tünele yönlendir.
   Korumayı kurmadan DNS yönlendirmesini veya tüneli başlatma.

Yerel `~/.cloudflared/nanas-preview.json` dosyasının alanları:

```json
{
  "domain": "nanaskitchens.app",
  "tunnelId": "<cloudflared tarafından verilen UUID>",
  "teamName": "<Zero Trust takım adı>",
  "audience": "<Access uygulamasının 64 karakterli AUD değeri>"
}
```

Tünelin kimlik dosyası aynı klasörde `<tunnelId>.json` olmalıdır. Cloudflare
API tokenını, `cert.pem` dosyasını, tünel kimlik dosyasını veya davetli e-postalarını
repoya ekleme. Kurulum tokenı çalışan tünel için gerekli değildir.

## Hazırla ve çalıştır

Repo kökünde `.env` ve bağımlılıklar hazır olmalı. Node 22+, Java 21 ve
`cloudflared` gerekir. Windows'ta çalıştırıcı cloudflared'ı
`%LOCALAPPDATA%/Programs/cloudflared/cloudflared.exe` altında arar;
gerekirse `CLOUDFLARED_PATH` tanımla.

```text
docker compose up -d db redis
pnpm preview api-build
pnpm preview build
```

Şu uzun süre çalışan süreçleri ayrı arka plan oturumlarında başlat:

1. `pnpm preview stripe` — test ödeme olaylarını yerel API'ye iletir;
   "Ready" mesajını bekle. Güncellenen webhook anahtarını `.env` içinde tutar.
2. `pnpm preview api` — API'yi yalnızca `127.0.0.1:8080` üzerinde başlatır.
3. `pnpm preview web` — derlenmiş siteyi `127.0.0.1:3000` üzerinde başlatır.
4. `pnpm preview tunnel` — Access JWT doğrulaması zorunlu tüneli çalıştırır.

Çalıştırıcı alt süreçleri Windows'ta gizli başlatır. `.env` dosyasındaki normal
geliştirme ayarlarını değiştirmez; Stripe dinleyicisinin webhook anahtarı ve
`PAYMENTS_PROVIDER=stripe` ayarı istisnadır.
Canlı veya karışık Stripe anahtarlarıyla başlamayı reddeder.

Web derlemesi `.next-preview` içindedir. Aynı klasöre derleme yapmadan önce çalışan
preview web sürecini durdur, derle ve tekrar başlat. Normal geliştirme sunucusu
`.next` kullanır. Tarayıcı API çağrıları `/api` üzerinden gider; sunucuda çizilen
takip sayfası `API_INTERNAL_URL` ile yerel API'yi kullanır.

## Doğrulama ve kapatma

- `pnpm test:preview`: canlı anahtarların reddini ve tünelin Access zorunluluğunu sınar.
- Yerelde `/api/health` başarılı olmalı; yetkisiz `/api/orders` erişimi reddedilmeli.
- Dışarıdan gizli tarayıcıda ana sayfa **ve** `/api/health` Access girişine gitmeli.
- İzin verilen e-posta ile giriş yap; başka bir e-posta uygulamaya erişememeli.
- Stripe sandbox ödeme dönüşü `https://nanaskitchens.app/orders/<id>` olmalı.
  Sipariş yalnızca imzalı ödeme bildirimi geldikten sonra onaylanır.
- Siteyi kapatmak için önce tüneli, ardından web/API/Stripe oturumlarını durdur.
  Veritabanı volume'larını silme. Erişimi kaldırmak için davetli politikasını güncelle.

Stripe webhook'u bu denemede yerel CLI üzerinden gelir. Canlıya geçerken Stripe'ın
erişebildiği ayrı, imza doğrulamalı webhook adresi gerekir; Access korumasını bütün
site için kaldırmak bu sorunu çözmenin uygun yolu değildir.

Kaynaklar: [Access uygulaması](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/),
[tünelde JWT doğrulaması](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/).
