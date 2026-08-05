# CLAUDE.md

Nanas' Kitchens: 10 mil yarıçapında ev mutfakları için kültür temalı yemek pazarı.
BMAD dokümanları `docs/` altında; kod oradaki hikayeleri uygular. Repo:
https://github.com/Osmanita/Nanas-Kitchens-new (origin; eski `ctuka` remote'u referans).
Demo pazaryeri artık **Powell, Ohio (43065)** merkezli (bkz. Seed verisi).

## Mimari (strangler migration)

- **`apps/api-java`** — ana backend (:8080). Spring Boot 4 + Spring AI. Auth, kitchens,
  inventory, orders, payments (Stripe), delivery (mock kurye), chat agent, public tracking.
- **`apps/web`** — Next.js 15 (:3000). Sayfalar: `/` (chat-first landing + mutfak listesi),
  `/login`, `/chat` (AI sipariş asistanı), `/orders`, `/orders/[id]`, `/track/[id]` (kurye
  takip), `/seller/*`, `/settings/notifications`, `/admin`, `/inspector/*`.
- **`apps/api`** — eski NestJS API (:3001). Prisma şemasının/migration'ların sahibi;
  menu CRUD ve kalan hikayeler taşınana kadar duruyor. Seed buradan çalışır.
- **`apps/mcp-server`** — MCP sunucusu (:3002).
- PostGIS + Redis: `docker compose up -d`.

## Çalıştırma (Windows dahil)

```powershell
# Node.js/pnpm yoksa: winget install OpenJS.NodeJS.LTS, sonra `npm install -g pnpm`
# (corepack Program Files'a admin izni ister — npm ile kurmak daha az sürtünmeli)
docker compose up -d
pnpm install
pnpm --filter api prisma:migrate:deploy   # şema Prisma'nındır, Hibernate dokunmaz
(cd apps/api && pnpm seed)                # günün menülerini yayınlar (aşağıya bak)
pnpm --parallel --filter ./apps/* dev     # DİKKAT: package.json'daki 'pnpm dev' scripti tek
                                           # tırnaklı glob kullanıyor, Windows cmd.exe'de bunu
                                           # literal karakter sayıp hiç eşleşme bulamıyor —
                                           # doğrudan bu komutu (tırnaksız glob) çalıştır.
# Java API — Spring .env OKUMAZ, export şart (PowerShell'de):
cd apps/api-java
Get-Content ../../.env | % { if ($_ -match '^([^#=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1],$Matches[2],'Process') } }
.\mvnw.cmd spring-boot:run
```

Login: `buyer@demo.com` / `demo1234` (buyer), `inspector@demo.com`, `admin@demo.com` aynı
şifreyle, satıcılar `ayse@demo.com` vb. Java API'yi yeniden başlatırken önce eski process'i
durdur (mvnw + fork iki java process açar).

**Windows'a özgü tuzaklar:**
- PowerShell `Get-Content -Raw` / `Set-Content` **`-Encoding utf8` olmadan** Türkçe karakterleri
  bozar (mojibake). Metin dosyalarını (özellikle `seed.ts`) düzenlerken PowerShell yerine
  Read/Write/Edit tool'larını kullan.
- Node.js ilk kurulumda Windows Defender Firewall her yeni dev server için izin sorar — Public
  profilde zaten Block kuralı var ama Private/Domain'de yok. Kalıcı çözüm (admin PowerShell):
  `New-NetFirewallRule -DisplayName "Node.js dev" -Direction Inbound -Program "C:\program files\nodejs\node.exe" -Action Allow -Profile Private,Domain`
- Docker Desktop'ın `docker` CLI'ı çalışsa da, Testcontainers/docker-java kütüphanesi hem named
  pipe (`docker_engine`, `dockerDesktopLinuxEngine`) hem de TCP (`tcp://localhost:2375`,
  ayarlardan açılsa bile) üzerinden **bozuk/boş bir stub yanıt** alabiliyor (Docker Desktop
  4.85+ ile gözlemlendi) — `apps/api-java/src/test/java/.../support` altındaki entegrasyon
  testleri bu ortamda çalıştırılamadı, kod hazır ama doğrulanamadı. Normal bir Docker
  kurulumunda çalışması beklenir.

## .env (gitignore'da — repoda YOK, sadece .env.example var)

- `GEMINI_API_KEY` — dev'de chat agent bununla çalışır (aistudio.google.com/apikey, ücretsiz,
  key'ler hesapta kalıcı görünür — kaybedilirse tekrar oradan alınabilir).
- `AI_PROVIDER=google-genai` — tam sürümde `anthropic` yapılacak (iki starter da classpath'te).
- `STRIPE_SECRET_KEY` — test modu restricted key (`rk_test_...`) çalışıyor; boşsa
  siparişler ödemesiz onaylanır.
- `DELIVERY_PROVIDER=mock` — DoorDash (Story 4.2) developer hesabı gelene kadar sahte kurye.
- `JWT_SECRET`, `ADDRESS_ENC_KEY` — 32+ byte; her iki backend (NestJS + Java) aynı değeri
  paylaşır (token/şifreleme karşılıklı geçerli olsun diye).

## Günlük menü — artık otomatik (ama bir tuzağı var)

`MenuRolloverJob` (`apps/api-java/.../menus`) `@EnableScheduling` ile her 30 dakikada bir
çalışıyor: UTC günü değiştiğinde, o gün için hiç menüsü olmayan her mutfağın son yayınlanmış
menüsünü taze porsiyonlarla yeniden yayınlıyor. `app.menus.daily-rollover` (`MENU_DAILY_ROLLOVER`)
ile kapatılabilir, varsayılan `true`. **Elle `pnpm seed` çalıştırmak artık şart değil** — ama
job'ın ilk çalışması boot'tan 15 sn sonra, sonrası 30 dk'da bir; UTC gün değişimi tam o pencerede
olursa birkaç dakika "porsiyon yok" görünebilir.

Ayrıca: bir mutfağın **mevcut günün** porsiyonları test sırasında tükenirse (0'a düşerse), bu
rollover job'ın işi DEĞİL (o sadece "hiç menüsü olmayan" günleri dolduruyor) — böyle bir durumda
`UPDATE "MenuItem" SET "portionsRemaining" = "portionsTotal"` ile elle doldur ya da `pnpm seed`
çalıştır (idempotent, üstüne yazmaz, sadece eksik günü doldurur).

## Chat agent nasıl çalışır (kritik bilgiler)

- SSE: Spring `data:{...}` (boşluksuz) yazar; frontend parser iki formatı da kabul eder.
- **Tool sonuçları turlar arası taşınmaz** — frontend sadece metin geçmişi gönderir.
  SystemPrompt modele "ID gerekiyorsa tool'ları yeniden çağır" der; `getMenu` mutfak
  ADI da kabul eder (`KitchensService.resolveKitchenId`).
- **Konum artık sohbetle sorulmuyor.** Buyer, Home sayfasındaki `LocationPickerModal`'dan
  (harita + adres arama + "konumumu kullan") bir konum seçer (`lib/location.ts`,
  localStorage). Bu konum her giden chat mesajına görünmez bir ek olarak iliştirilir:
  `"...\n\n[buyer's selected browse location: <adres> (lat X, lng Y)]"` (bkz.
  `apps/web/app/chat/page.tsx`'te `send()`). SystemPrompt bu notu hem `searchKitchens`
  konumu hem de (aksi belirtilmedikçe) `deliveryAddress` olarak kabul etmesi için
  yönlendirilmiş — agent bir daha "neredesin?" diye sormamalı.
  ⚠️ Home→Chat handoff'unda (bkz. aşağı) konum state'i race condition'a açık: `send()`
  artık bir `locationOverride` parametresi alıyor, mount effect'i konumu senkron okuyup
  doğrudan `send(text, savedLocation)` ile geçiriyor — state güncellemesini beklemiyor.
- **Home → Chat handoff:** Ana sayfadaki hero chat kutusuna yazılan ilk mesaj
  `sessionStorage["pendingChatMessage"]`'a yazılıp `/chat`'e yönlendirilir; chat sayfası
  mount olduğunda bunu okuyup otomatik gönderir (bkz. yukarıki race condition notu).
- Yapılandırılmış kart protokolleri (SystemPrompt.java'da şemalar):
  - **Mutfak listesi kartı** (`{"type":"kitchens", items:[...]}`) — arama sonuçlarını
    numaralı metin yerine fotoğraflı bir grid olarak gösterir; her `description` alanı
    `Kitchen.description`'dan birebir kopyalanır (agent uydurmaz).
  - **Menü kartı** (`{"type":"menu", items:[{photo, calories, ...}]}`) → fotoğraflı/kalorili
    seçici, +/- adet, "Add to order" seçimi mesaj olarak geri yollar.
  - **Onay kartı** (`{"confirmed":false, summary:{deliveryAddress...}, draft:{...}}`)
    → haritalı (Nominatim geocode + OSM iframe, salt-okunur önizleme: `AddressMap`) onay
    kartı. Kartın üstünde ayrıca **"Change address"** butonu var — `LocationPickerModal`'ı
    `restrictToUS={false}` ile açar (ABD dışı da dahil, dünya çapında arama/harita), seçilen
    adres hem `summary.deliveryAddress` hem `draft.deliveryAddress`'e client-side yazılır
    (agent'a tekrar sormaya gerek kalmaz). Confirm, draft'ı `confirm:true` ile POST eder.
  - **Sipariş onaylandı kartı** — artık metin değil, React state (`confirmedOrder`):
    `/orders/{id}`'ye giden "View order" butonu + (varsa) "Track delivery" linki.
  - Ham JSON hiçbir zaman balonda görünmez, hepsi parse edilip temizlenir.
- **Selamlaşma:** SystemPrompt kural 10 — "selam"/"merhaba" gibi genel selamlara asla dini
  bir ifadeyle (ör. "Aleyküm selam") karşılık vermez; sadece kullanıcı dini bir selam
  verirse kısaca aynı şekilde karşılık verir.
- Teslimat: adres zorunlu (`ADDRESS_REQUIRED`), kademeli geocode (baştan kelime düşürerek
  Nominatim, `addressdetails=1` ile ülke kodu da alınır) + PostGIS mesafe. Sırayla kontrol:
  bulunamadı → `ADDRESS_NOT_FOUND`; ülke ABD değilse → `ADDRESS_OUTSIDE_US` (mesafe hesabından
  ÖNCE, daha net bir mesaj için); >10 mil → `ADDRESS_OUT_OF_RANGE` (mil bilgisiyle). Adres
  DB'de şifreli (`Order.deliveryAddressEncrypted`, AddressCrypto).
- `CreateOrderRequest`'teki `courierTipCents`/`confirm`/`Item.qty` **kutulanmış tipler**
  (`Integer`/`Boolean`), primitif değil — agent bazen bu alanları `null` gönderiyor
  (ör. pickup siparişte bahşiş "geçerli değil" diye), primitif `int`/`boolean` bunu kabul
  etmeyip ham bir Jackson hatası fırlatıyordu. Record'un compact constructor'ı null'ları
  güvenli varsayılana çeviriyor (0 / false / qty:1) — yeni bir alan eklerken aynı deseni
  kullan, primitif ekleme.
- Sipariş onayı transaction içinde: Stripe PaymentIntent (test modu, server-confirm,
  `pm_card_visa`) + mock DeliveryJob (`/track/{externalId}` linki) + stok düşümü;
  ödeme patlarsa hepsi geri alınır.
- Free tier RPM düşük, agent turu başına birkaç model çağrısı yapar; 429/503 retry
  application.yml'de. Yine de arada "try again" gerekebilir.

## Auth / JWT

- **Access token TTL: 8 saat** (`app.jwt.access-token-ttl-minutes: 480`, önceden 15 dk).
  Refresh token 30 gün. `JwtService` constructor'ındaki fallback default'u da senkron tut.
- `apps/web/lib/api.ts`: `apiFetch()` zaten 401'de sessizce refresh deneyip retry ediyordu;
  ama sayfa guard'ları (`getSession()` senkron exp kontrolü) refresh denemeden direkt
  login'e atıyordu. Artık `ensureSession()` var — expired ama refresh edilebilir bir
  session'ı sessizce yeniler. Tüm `useEffect` tabanlı sayfa guard'ları (`orders`,
  `seller/*`, `admin`, `inspector/*`, `settings/notifications`) buna geçirildi.
- `/auth/me` (GET/PATCH) — herhangi bir rol için telefon numarası (`User.phone`) okur/yazar.
  UI: `PhoneSettingsCard` bileşeni, hem `seller/kitchen` hem `settings/notifications`'ta.

## Spring Security dikkat

- CORS: sadece `app.cors.web-origin` (default :3000).
- `dispatcherTypeMatchers(ASYNC).permitAll()` ŞART — kaldırılırsa SSE stream sonunda
  "Access Denied" ile bağlantı kopar (Firefox: "error in input stream").
- Public rotalar: /health, /auth/register, /auth/login, /auth/refresh, GET /kitchens/**,
  GET /track/**. `/auth/me` KORUMALI (whitelist'te değil, kasıtlı).

## Veri/DB kuralları

- Şema ve migration'lar Prisma'nın (apps/api/prisma). Java'da `ddl-auto: none`,
  her identifier quoted camelCase. Yeni kolon = elle migration dosyası +
  `prisma migrate deploy` (migrate dev interaktif olduğundan çalışmaz).
- **`CURRENT_DATE` KULLANMA** — JDBC oturumunun yerel saat diliminde çalışır (bu makine
  UTC+3), UTC'de hâlâ dün olsa bile yerelde gece yarısını geçtiği an "bugün" sorguları
  boş döner. Her zaman `(now() AT TIME ZONE 'UTC')::date`. Bu oturumda iki gerçek prod
  bug'ı buradan çıktı (`KitchensService.search`, `PortionsStreamService`); `EarningsController`
  de düzeltildi. Yeni bir "bugün" sorgusu yazarken bunu unutma.
- Cuisine filtresi lowercase tag'ler (`turkish`...); sorgu case-insensitive.
- `KitchenSearchResult`'a `description` eklendi (Kitchen.description'dan) — chat'in mutfak
  listesi kartı bunu kullanıyor, agent'ın uydurmasına gerek kalmasın diye.
- **Seed script artık idempotent update de yapıyor**: `apps/api/prisma/seed.ts`'teki
  `else` dalı (mutfak zaten varsa) `addressEncrypted` VE `description`'ı senkronize eder —
  önceden sadece adres güncelleniyordu, mutfakları Powell'a taşırken description'lar bir
  süre eski (Lefkoşa) metni gösterip durdu. Yeni bir alan taşınırken bu dalı da güncelle.
- Seed mutfakları artık hepsi **Powell, OH (43065)** merkezli, birbirine 0–1.5 mil mesafede
  (SF/Lefkoşa/Columbus değil): Ayse, Fatma, Emine, Havva, Zeynep (Türk), Mei (Çin),
  Rosa (Meksika), Abeba (Etiyopya). Her `MenuItem` 500 porsiyon (demo'nun kolay tükenmemesi
  için). Dish.photo `/public/dishes/*.jpg` (Wikimedia CC), Dish.calories dolu;
  `dishMeta()` seed'de isimden eşler.

## Frontend tasarım sistemi

- Vanilla CSS token'ları `apps/web/app/globals.css` (Tailwind YOK).
- İki paralel tasarım sistemi VARDI — artık birleşti: eski "brand-*" (yeşil/turuncu, `.card`,
  `.field`, `.pill`) hâlâ mutfak grid'i / seller sayfaları gibi yerlerde kullanılıyor;
  chat/login/global-header artık hepsi **glass/olimpiyat sistemine** (`--accent`, `--text-*`,
  `.shell`/`.shell-core`, `.island-nav`, `.chip`, `.chat-dock`, `.hero-em`, `.halo-orb`)
  geçirildi. Yeni bir auth/chat-benzeri sayfa yazarken glass sistemini kullan.
- **Global Header artık `position: fixed`** (`.island-nav`, sadece `Header.tsx`'te kullanılıyor
  — chat/track'in kendi kopyaları kaldırıldı, çakışan çift sticky-nav sorunu buradan çıktı).
  Header kendi altına `<div style={{height:78}} />` spacer'ı ekliyor. **Header'ın yüksekliğini
  değiştirirsen** hem bu spacer'ı hem de `chat/page.tsx`'teki
  `height: "calc(100dvh - 78px)"` değerini güncellemeyi unutma — yoksa sayfa taşıp scroll'a
  zorlar ve `.chat-dock` sabit kalmaz.
- Konum seçici: `LocationPickerModal` + `LeafletMap` (Leaflet/OSM, API key gerekmiyor).
  `restrictToUS` prop'u (varsayılan `true`) — Home'un "yakınımda" picker'ı ABD ile sınırlı,
  chat'teki teslimat adresi picker'ı (`restrictToUS={false}`) dünya çapında.
- Chat input hiç disable edilmez; stream sırasında gönderilen mesaj kuyruğa alınır
  (`queued` state) ve stream bitince otomatik gider; odak inputta tutulur.
- Chat markdown renderer'ı sınırlı: bold/italik/link/bullet (`renderRich`). Ham HTML asla.

## Test suite

- **`apps/web`**: Vitest (`pnpm test`). `vitest.config.ts` + jsdom + Testing Library.
  `lib/cart.test.ts`, `lib/location.test.ts` — DB/network gerektirmez, saniyeler sürer.
- **`apps/api-java`**: JUnit 5 + AssertJ (`.\mvnw.cmd test`, pom.xml'de zaten vardı, hiç
  kullanılmamıştı). `JwtServiceTest`, `AddressCryptoTest` — Spring context/DB gerektirmez.
  Ayrıca `src/test/java/.../support` altında Testcontainers tabanlı entegrasyon test
  altyapısı var (`IntegrationTest`, `MigrationRunner` — apps/api/prisma/migrations'ı gerçek
  bir Postgres+PostGIS container'ına replay eder) + `KitchensServiceSearchIntegrationTest`,
  `OrdersServiceIntegrationTest`; bu makinede Docker Desktop uyumsuzluğu yüzünden
  ÇALIŞTIRILAMADI (yukarıki Windows tuzakları'na bak) — kod hazır, doğrulanmamış.

## Bilinen eksikler / sıradaki adaylar

- **[SONRAKI OTURUM] "Rate restaurant" — Osman istedi (2026-08-05), henüz konuşulmadı.**
  ⚠️ Önce şunu bilerek başla: mutfak puanlama zaten VAR — `/orders/[id]` sayfasında
  `ReviewCard` bileşeni (yıldız puanı + yorum, `POST /kitchens/{id}/reviews`,
  `GET /orders/{id}/review`), ama SADECE tamamlanmış (`completed`) bir siparişten sonra,
  o sipariş detay sayfasına gidip görünüyor. Osman'ın kastettiği muhtemelen bu değil —
  başka bir yerden (mutfağın kendi genel sayfası `/kitchens/[id]`'den mi, sipariş
  geçmişinden mi, mutfak listesi kartından mı?) puanlama/rating erişimi istiyor olabilir.
  Yarın kapsamı netleştirip ona göre uygula.
- Gerçek ödeme (Stripe Connect satıcı ödemeleri), gerçek DoorDash/Grubhub, gerçek
  push/email bildirim kanalları (FCM/SES) — hepsi mock.
- `apps/api` (NestJS) ve `apps/mcp-server`'da hiç test yok (apps/api artık "referans",
  web sadece Java API'ye konuşuyor).
- Bağımsız bir buyer hesap/profil sayfası yok (telefon `/settings/notifications`'ta,
  ama genel "hesabım" sayfası yok).
- CI (GitHub Actions): pnpm sürümü package.json `packageManager`'dan gelir — workflow'a
  `version:` EKLEME (çift tanım hatası verir).
- Kaloriler temsili dev verisi; Nominatim dev geocoder'ı (üretimde ücretli servise
  geçilecek seam hazır: GeocodingService — hem `kitchens` hem `delivery` paketinde AYRI
  birer `GeocodingService` var, karıştırma).

## Test kullanıcı akışı (uçtan uca doğrulanmış)

Ana sayfa: hero chat kutusuna "turkish food near me" yaz → otomatik `/chat`'e geçip
gönderir → konum zaten seçiliyse sormadan mutfak listesi kartını gösterir → mutfak seç →
fotoğraflı menü kartından seç → "delivery" + (konum zaten varsayılan adres) → onay kartı
(adres değiştirilebilir, ABD dışı dahil) → Confirm → "Order confirmed" kartı → View order.
Uzak adres (>10 mil) veya ABD dışı adres (ör. Adana, TR) net bir mesajla reddedilir.
Seller: `ayse@demo.com` ile giriş → Today's Orders'ta günlük özet şeridi + kalem/fotoğraf
bazlı sipariş kartları → Accept/Preparing/Ready/Complete.
