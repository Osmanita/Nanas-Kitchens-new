# CLAUDE.md

Nanas' Kitchens: 10 mil yarıçapında ev mutfakları için kültür temalı yemek pazarı.
BMAD dokümanları `docs/` altında; kod oradaki hikayeleri uygular. Repo:
https://github.com/Osmanita/Nanas-Kitchens-new (origin; eski `ctuka` remote'u referans).

## Mimari (strangler migration)

- **`apps/api-java`** — ana backend (:8080). Spring Boot 4 + Spring AI. Auth, kitchens,
  inventory, orders, payments (Stripe), delivery (mock kurye), chat agent, public tracking.
- **`apps/web`** — Next.js 15 (:3000). Sayfalar: `/` (landing), `/login`, `/chat`
  (AI sipariş asistanı), `/track/[id]` (kurye takip).
- **`apps/api`** — eski NestJS API (:3001). Prisma şemasının/migration'ların sahibi;
  menu CRUD ve kalan hikayeler taşınana kadar duruyor. Seed buradan çalışır.
- **`apps/mcp-server`** — MCP sunucusu (:3002).
- PostGIS + Redis: `docker compose up -d`.

## Çalıştırma

```bash
docker compose up -d
pnpm install
pnpm --filter api prisma:migrate:deploy   # şema Prisma'nındır, Hibernate dokunmaz
(cd apps/api && pnpm seed)                # günün menülerini yayınlar (aşağıya bak)
pnpm dev                                  # web :3000, eski api :3001, mcp :3002
# Java API — Spring .env OKUMAZ, export şart:
cd apps/api-java && set -a && . ../../.env && set +a && ./mvnw spring-boot:run
```

Login: `demo-buyer@example.com` / `sifre1234` (buyer). Seed ayrıca `buyer@demo.com` /
`demo1234` üretir. Java API'yi yeniden başlatırken: 8080'i dinleyen java process'ini
durdur (mvnw + fork iki java process açar), sonra yukarıdaki komut.

## .env (gitignore'da — repoda YOK, sadece .env.example var)

- `GEMINI_API_KEY` — dev'de chat agent bununla çalışır (aistudio.google.com/apikey, ücretsiz).
- `AI_PROVIDER=google-genai` — tam sürümde `anthropic` yapılacak (iki starter da classpath'te).
- `GEMINI_MODEL=gemini-3.1-flash-lite` — Google 2026-07'de `gemini-2.5-flash`'ı kapattı;
  `gemini-flash-latest` free tier'da sık 503 veriyor. Model değişimi sadece env.
- `STRIPE_SECRET_KEY` — test modu restricted key (`rk_test_...`) çalışıyor; boşsa
  siparişler ödemesiz onaylanır. Ödemeler: dashboard.stripe.com/test/payments.
- `DELIVERY_PROVIDER=mock` — DoorDash (Story 4.2) developer hesabı gelene kadar sahte kurye.

## Günlük menü tuzağı (her gün tekrarlar!)

Menüler UTC gününe bağlı. UTC gece yarısından (yerel 03:00) sonra arama "porsiyon yok"
döner. Çözüm: `(cd apps/api && set -a && . ../../.env && set +a && pnpm seed)` — o günün
menülerini idempotent şekilde yayınlar. Otomatikleştirilmedi (aday iş).

## Chat agent nasıl çalışır (kritik bilgiler)

- SSE: Spring `data:{...}` (boşluksuz) yazar; frontend parser iki formatı da kabul eder.
- **Tool sonuçları turlar arası taşınmaz** — frontend sadece metin geçmişi gönderir.
  SystemPrompt modele "ID gerekiyorsa tool'ları yeniden çağır" der; `getMenu` mutfak
  ADI da kabul eder (`KitchensService.resolveKitchenId`).
- Yapılandırılmış kart protokolleri (SystemPrompt.java'da şemalar):
  - Menü kartı: ```json {"type":"menu", items:[{photo, calories, ...}]}``` → chat'te
    fotoğraflı/kalorili seçici, +/- adet, "Add to order" seçimi mesaj olarak geri yollar.
  - Onay kartı: ```json {"confirmed":false, summary:{deliveryAddress...}, draft:{...}}```
    → haritalı (Nominatim geocode + OSM iframe) onay kartı; Confirm draft'ı
    `confirm:true` ile POST eder. Ham JSON balondan temizlenir.
- Teslimat: adres zorunlu (`ADDRESS_REQUIRED`), kademeli geocode (baştan kelime düşürerek
  Nominatim, 1.1s aralıklı) + PostGIS mesafe; >10 mil → `ADDRESS_OUT_OF_RANGE` (mil
  bilgisiyle), çözülemeyen → `ADDRESS_NOT_FOUND`. Adres DB'de şifreli
  (`Order.deliveryAddressEncrypted`, AddressCrypto).
- Sipariş onayı transaction içinde: Stripe PaymentIntent (test modu, server-confirm,
  `pm_card_visa`) + mock DeliveryJob (`/track/{externalId}` linki) + stok düşümü;
  ödeme patlarsa hepsi geri alınır.
- Free tier RPM düşük, agent turu başına birkaç model çağrısı yapar; 429/503 retry
  application.yml'de. Yine de arada "try again" gerekebilir.

## Spring Security dikkat

- CORS: sadece `app.cors.web-origin` (default :3000).
- `dispatcherTypeMatchers(ASYNC).permitAll()` ŞART — kaldırılırsa SSE stream sonunda
  "Access Denied" ile bağlantı kopar (Firefox: "error in input stream").
- Public rotalar: /health, /auth/*, GET /kitchens/**, GET /track/**.

## Veri/DB kuralları

- Şema ve migration'lar Prisma'nın (apps/api/prisma). Java'da `ddl-auto: none`,
  her identifier quoted camelCase. Yeni kolon = elle migration dosyası +
  `prisma migrate deploy` (migrate dev interaktif olduğundan çalışmaz).
- SQL'de tarih karşılaştırması `(now() AT TIME ZONE 'UTC')::date` — `CURRENT_DATE`
  JDBC oturumunun yerel saat diliminde çalışır ve gece yarısı bug'ı yaratır.
- Cuisine filtresi lowercase tag'ler (`turkish`...); sorgu case-insensitive.
- Seed mutfakları: SF (Ayse, Fatma, Mei, Rosa), Lefkoşa (Emine — Girne Cad.,
  Havva — Dereboyu), Columbus OH (Zeynep, Abeba). Dish.photo `/public/dishes/*.jpg`
  (Wikimedia CC), Dish.calories dolu; `dishMeta()` seed'de isimden eşler.

## Frontend tasarım sistemi

- Vanilla CSS token'ları `apps/web/app/globals.css` (Tailwind YOK). Font: Outfit (next/font).
- Palet: **olimpiyat renkleri** — mavi ana vurgu (#0081c8/#006ba6), beş halka rengi
  `.hue-N` sınıflarıyla mutfak kartlarında döner. Açık/koyu tema `prefers-color-scheme`.
- Kalıplar: `.island-nav` (yüzen cam nav), `.shell`/`.shell-core` (double-bezel),
  `.chat-dock` (yüzen input), `.stagger` (kademeli giriş), `.cascade-card` (eğik kartlar).
- Chat input hiç disable edilmez; stream sırasında gönderilen mesaj kuyruğa alınır
  (`queued` state) ve stream bitince otomatik gider; odak inputta tutulur.
- Chat markdown renderer'ı sınırlı: bold/italik/link/bullet (`renderRich`). Ham HTML asla.

## Bilinen eksikler / sıradaki adaylar

- Dış kimlik bilgisi bekleyenler: gerçek DoorDash/Grubhub (mock provider hazır),
  Stripe Connect satıcı ödemeleri, FCM/SES push/email kanalları (in-app inbox çalışıyor),
  Whisper STT (mock STT çalışıyor).
- 6.x/7.x, satıcı paneli, sipariş geçmişi (/orders), token refresh (apiFetch 401'de
  yeniler) ve günlük menü rollover'ı (MenuRolloverJob, MENU_DAILY_ROLLOVER=false ile
  kapanır) TAMAMLANDI — README durum tablosuna bak.
- CI (GitHub Actions): pnpm sürümü package.json `packageManager`'dan gelir — workflow'a
  `version:` EKLEME (çift tanım hatası verir).
- Kaloriler temsili dev verisi; Nominatim dev geocoder'ı (üretimde ücretli servise
  geçilecek seam hazır: GeocodingService).
- globals.css iki tasarım sistemini birlikte taşır: marka token'ları (--brand-*) pazar
  sayfaları için, chat/track bölümü (--accent/--surface/..., dosyanın altında) sadece
  /chat ve /track için. `.btn-primary` çakışması `.btn.btn-primary` scoping'iyle çözülü.

## Test kullanıcı akışı (uçtan uca doğrulanmış)

Chat: "turkish food near me" → konum sorar → "lefkosa" → mutfaklar → mutfak seç →
fotoğraflı menü kartından seç → "delivery" + adres → haritalı onay kartı →
Confirm → Stripe tahsilat + kurye + takip linki. Uzak adres (örn. Kalkanlı ~20 mil)
mil bilgisiyle reddedilir.
