# Nanas' Kitchens

10 mil yaricapinda ev mutfaklari icin kultur-temali yemek pazari.
BMAD dokumanlari `docs/` altinda; kod, oradaki hikayeleri uygular.

Backend Java'ya tasindi (strangler migration): `apps/api-java` (Spring Boot 4 + Spring AI)
ana API'dir (:8080) — auth, kitchens, menuler, inventory, orders, teslimat ve AI chat
agent'i dahil. Frontend (Next.js, `apps/web`) ve MCP sunucusu yalnizca :8080 ile konusur;
eski NestJS API'si (:3001) referans olarak durur. Mobil uygulama Kotlin Multiplatform +
Compose Multiplatform ile (iOS + Android tek codebase, `apps/mobile`) ayni REST
API'sini kullanir. API kapaliyken urun demosu yerel ornek veriyle calisir. Detay:
`apps/mobile/README.md`, `apps/api-java/README.md`, `docs/front-end-spec.md`.

## Calistirma
```bash
cp .env.example .env
docker compose up -d          # PostGIS + Redis
pnpm install
pnpm --filter api prisma:generate
pnpm --filter api prisma:migrate:dev
pnpm dev                      # eski api :3001, web :3000, mcp :3002
```

Java API'yi ayri baslat. **Spring `.env` OKUMAZ** ve `JWT_SECRET` / `ADDRESS_ENC_KEY`
artik varsayilansiz (yoksa uygulama acilmiyor), yani once `.env`'i process'e export et:

```powershell
# Windows / PowerShell
cd apps/api-java
Get-Content ../../.env | % { if ($_ -match '^([^#=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1],$Matches[2],'Process') } }
.\mvnw.cmd spring-boot:run    # yeni Java API :8080
```

```bash
# macOS / Linux
set -a && . ./.env && set +a
(cd apps/api-java && ./mvnw spring-boot:run)   # yeni Java API :8080
```

Windows'ta `.\dev.cmd` bunlarin hepsini (compose, migrate, export, dev serverlar) tek
komutta yapar — ayrinti icin `CLAUDE.md`'deki "Calistirma" bolumune bak.

## Hizli test
```bash
curl localhost:8080/health
curl -X POST localhost:8080/auth/register -H 'content-type: application/json' \
  -d '{"email":"ayse@example.com","password":"sifre1234","role":"seller"}'
curl 'localhost:8080/kitchens/search?lat=37.788&lng=-122.4075'
```

## Durum (BMAD hikayeleri)
- [x] 1.1 Iskelet + CI        - [x] 1.2 Auth & roller
- [x] 1.3 Mutfak profili+geo  - [x] 1.4 Uygunluk beyani
- [x] 2.1/2.2 Menu CRUD + hazir-zaman pencereleri (Java)
- [x] 2.3 Atomik envanter + canli SSE + manuel duzeltme
- [x] 3.3 Siparis cekirdegi + web cart/checkout
- [~] 3.4 Stripe (PaymentIntent + imzali webhook + terkedilen-siparis supurucusu +
      web PaymentElement; PAYMENTS_PROVIDER=mock varsayilan — gercek test anahtariyla
      denenmedi, Connect payout icin satici onboarding bekliyor)
- [x] 4.1 Satici siparis yasam dongusu
- [~] 4.2 Teslimat (mock provider; DoorDash/Grubhub kimlik bilgisi bekliyor)
- [x] 5.1 MCP sunucusu        - [x] 5.2 Konusma agenti
- [~] 5.3 Sesli giris (kayit + sunucu tarafi transkripsiyon; Whisper anahtari yoksa mock)
- [~] 4.4 Bildirimler (uygulama ici inbox + web zili; push/email kanali FCM/SES
      kimlik bilgisi bekliyor, NOTIFICATIONS_CHANNEL=log)
- [x] 6.1 Puan & yorumlar     - [x] 6.2 Menu anketleri  - [x] 6.3 Yemek istekleri
- [x] 7.1 Saglik belgeleri    - [x] 7.2 Mufettis portali - [x] 7.3 Admin konsolu + itirazlar
- [x] Satici web portali (menu/porsiyon, siparis panosu, profil+foto, kazanclar)
- [x] Alici siparis gecmisi (/orders)
- [ ] Kalanlar: gercek DoorDash/Grubhub, Stripe Connect satici odemeleri, FCM/SES
      kanallari, token refresh UI akisi, gunluk seed otomasyonu

## Geliştirici notu — son çalışma (11 Temmuz 2026)

### Tamamlananlar

- Java API, kök `.env` içindeki `GEMINI_API_KEY` ile çalışacak şekilde yapılandırıldı.
- Chat aracı artık şehir veya posta koduyla (ör. `43065`) mutfak arayabiliyor; isimle
  istenen bir mutfağın menüsü doğrudan kontrol ediliyor.
- 43065 demo pazaryeri stoklu menülerle güncellendi: Nana Elif's Anatolian Table,
  Ayse's Anatolian Kitchen ve Teta Mariam's Lebanese Kitchen.
- Checkout akışında pickup sınırsız mesafede kullanılabilir. Teslimat için adres doğrulaması,
  10 mil yarıçap kontrolü, $3.99 demo kurye ücreti ve isteğe bağlı kurye bahşişi eklendi.
- Web ana sayfasının demo konumu 43065 / Powell, OH ile eşitlendi.

### Devam edenler / dikkat edilmesi gerekenler

- Teslimat sağlayıcısı şu an DoorDash-benzeri `mock` sağlayıcıdır. Gerçek DoorDash veya
  Grubhub anahtarları geldiğinde aynı `DeliveryProvider` arayüzüne gerçek adaptör eklenmeli.
- Gerçek ödeme için Stripe test anahtarları ve Stripe Connect satıcı onboarding akışı gerekir.
- Java API değiştirildiğinde yeniden başlatılmalıdır:

  ```bash
  cd apps/api-java
  set -a && source ../../.env && set +a
  ./mvnw spring-boot:run
  ```

- Web geliştirme sunucusunda macOS dosya izleme limiti yaşanırsa şu komutu kullanın:

  ```bash
  cd apps/web
  WATCHPACK_POLLING=true npm run dev -- -p 3010
  ```
