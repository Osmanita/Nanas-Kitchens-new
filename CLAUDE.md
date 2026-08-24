# CLAUDE.md

Nanas' Kitchens: 10 mil yarıçapında ev mutfakları için kültür temalı yemek pazarı.
BMAD dokümanları `docs/` altında; kod oradaki hikayeleri uygular.
Demo pazaryeri artık **Powell, Ohio (43065)** merkezli (bkz. Seed verisi).

> ## ⚠️ BU DOSYA HERKESE AÇIK BİR WEB SİTESİ OLARAK YAYINLANIYOR
>
> `.github/workflows/jekyll-gh-pages.yml` (GitHub'ın hiç değiştirilmemiş örnek şablonu)
> her `main` push'unda **repo kökünü** (`source: ./`) Jekyll ile derleyip GitHub Pages'e
> basıyor. Jekyll her `.md`'yi HTML'e çevirdiği için bu dosya şu anda canlı:
> **https://ctuka.github.io/NanasKitchens/CLAUDE.html** (2026-08-12'de teyit edildi: 200,
> 65 KB, içerik güncel). Repo zaten public, ama bu ondan fazlası — aranabilir, indekslenebilir
> bir sayfa.
>
> **Buraya yazarken bunu varsay.** Sır, gerçek anahtar, kişisel veri, müşteri bilgisi yazma.
> Halihazırda yayında olanlar: isim kısa listesi + "domain henüz alınmadı" notu (domain
> squatting'e açık davetiye), demo şifresi, AWS/ECS dağıtım planı, ikinci repo URL'i ve
> hangi güvenlik kontrollerinin test edilmediğinin listesi.
>
> Kapatmak için: repo Settings > Pages > Source = None, ya da `jekyll-gh-pages.yml`'ı sil.
> İkisi de repo ayarı/commit'i gerektirir. **Şimdiye kadar yayınlanmış olan geri alınmaz.**

**Git remote'ları — 2026-08-09'da düzeltildi, doküman bunu ters yazıyordu:**
- `origin` = https://github.com/ctuka/NanasKitchens.git. Çalışılan dal **`osman`**; push
  hedefi açıkça verilmeli: `git push origin main:osman`. Düz `git push` yanlış yere gider.
  Repo dayıya (`ctuka`) ait; Osman'ın hesabı `Osmanita` ve yetkisi `push` var, `admin` YOK —
  yani repo ayarları (visibility, branch protection, Pages) onun elinde değil.
- https://github.com/Osmanita/Nanas-Kitchens-new.git ikinci bir kopya; remote olarak
  tanımlı DEĞİL, oraya push elle yapılıyor (`git push <url> main:main`). **2026-08-12'de
  senkronlandı** (61 commit, `7adcfe9..a389b7f`) — uzun süre geride kalmıştı, tekrar
  geride kalması normal. Orada Pages kapalı.
- Yani "origin Osmanita'dır" cümlesi yanlıştı; nereye push edeceğini varsayma, `git remote -v`
  ve `git ls-remote --heads origin` ile teyit et.

## Mimari (strangler migration)

- **`apps/api-java`** — ana backend (:8080). Spring Boot 4 + Spring AI. Auth, kitchens,
  inventory, orders, payments (Stripe), delivery (mock kurye), chat agent, public tracking.
- **`apps/web`** — Next.js 15 (:3000). Sayfalar: `/` (chat-first landing + mutfak listesi),
  `/login`, `/chat` (AI sipariş asistanı), `/orders`, `/orders/[id]`, `/track/[id]` (kurye
  takip), `/seller/*`, `/settings/notifications`, `/admin`, `/inspector/*`.
- **`apps/api`** — eski NestJS API (:3001). Prisma şemasının/migration'ların sahibi;
  menu CRUD ve kalan hikayeler taşınana kadar duruyor. Seed buradan çalışır.
  **Orders modülü 2026-08-24'te SİLİNDİ** — kimse çağırmıyordu ama paylaşılan JWT
  secret'ıyla ağ içinden çalışıyordu ve migration öncesi halindeydi (çift iade, kilitsiz
  stok iadesi, hiç validation yok). Ayrıntı: "8. tur". Artık kendi `.env`'ini de okuyor
  (`src/env.ts`), yani `dev.cmd` dışından başlatmak da çalışır.
- **`apps/mcp-server`** — MCP sunucusu (:3002).
- PostGIS + Redis: `docker compose up -d`. (compose SADECE bu ikisini kaldırır, uygulamaları
  değil.) **Redis artık opsiyonel değil** — Java API onsuz açılmıyor: canlı porsiyon
  yayını (`portions:{kitchenId}` pub/sub) ve kurye quote'ları oradan geçiyor ("8. tur").
- Dört uygulamanın da kendi `Dockerfile`'ı var, artı `apps/api/Dockerfile.migrate` (tek
  seferlik `prisma migrate deploy` job'ı). **Hepsinin build context'i repo köküdür.**
  Ayrıntı ve tuzaklar için "7. tur"a bak.

## Çalıştırma (Windows dahil)

**Kısayol: `.\dev.cmd`** (ya da `.\scripts\dev.ps1`) — aşağıdaki adımların hepsini sırayla
yapar: Docker'ı gerekiyorsa başlatır, `docker compose up -d`, Postgres hazır olana kadar bekler,
`.env`'i process'e export eder (hem Spring hem NestJS bundan faydalanır), `prisma migrate deploy`
çalıştırır, portlarda kalmış eski dev server'ları öldürür, sonra java-api/web/mcp'yi ayrı
pencerelerde başlatır. Flag'ler: `-Install` (pnpm install), `-Seed`, `-WithNest` (eski NestJS
API'yi de başlat), `-SkipMigrate`, `-Stop` (her şeyi durdur + container'ları kaldır).
Elle yapmak istersen adımlar şöyle:

```powershell
# Node.js/pnpm yoksa: winget install OpenJS.NodeJS.LTS, sonra `npm install -g pnpm`
# (corepack Program Files'a admin izni ister — npm ile kurmak daha az sürtünmeli)
docker compose up -d
pnpm install
pnpm --filter api prisma:generate         # ŞART: @prisma/client'ın postinstall'ı workspace
                                           # kökünden çalıştığı için şemayı bulamıyor ve model
                                           # tipsiz bir stub client üretiyor; apps/api o zaman
                                           # derlenmiyor. migrate deploy client üretmez.
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
- ~~2026-08-12: Docker'a hiç erişilemiyor (`oso13` `docker-users` grubunda değil)~~ —
  **2026-08-22'de çözüldü, Docker çalışıyor** (29.6.2, `docker compose up -d` dahil). Beş
  imaj da bu makinede build edildi; "7. tur"a bak. Aynı belirtiyi tekrar görürsen
  (`permission denied ... npipe:////./pipe/dockerDesktopLinuxEngine`) çaresi admin
  PowerShell'de `Add-LocalGroupMember -Group "docker-users" -Member "oso13"` ve **oturum
  kapat/aç** — grup üyeliği giriş token'ına yazılıyor, Docker Desktop'ı yeniden başlatmak
  yetmez.

## .env (gitignore'da — repoda YOK, sadece .env.example var)

- `GEMINI_API_KEY` — dev'de chat agent bununla çalışır (aistudio.google.com/apikey, ücretsiz,
  key'ler hesapta kalıcı görünür — kaybedilirse tekrar oradan alınabilir).
- `AI_PROVIDER=google-genai` — tam sürümde `anthropic` yapılacak (iki starter da classpath'te).
- `STRIPE_SECRET_KEY` — test modu restricted key (`rk_test_...`) çalışıyor; boşsa
  siparişler ödemesiz onaylanır.
- `DELIVERY_PROVIDER=mock` — DoorDash (Story 4.2) developer hesabı gelene kadar sahte kurye.
- `MCP_REGISTRATION_TOKEN` — boşsa MCP istemci kaydı herkese açık (RFC 7591 varsayılanı,
  istemcilerin beklediği davranış). Set edilirse `/register` bu token'ı ister; internete
  açılmadan önce set et. Zaten `client_id` almış istemciler etkilenmez.
- `MCP_TRUSTED_PROXIES` — MCP sunucusunun önündeki, bizim sahip olduğumuz proxy sayısı.
  Varsayılan `0` (`X-Forwarded-For` tamamen yok sayılır); planlanan tek ALB için `1`.
- `JWT_SECRET`, `ADDRESS_ENC_KEY` — 32+ byte; her iki backend (NestJS + Java) aynı değeri
  paylaşır (token/şifreleme karşılıklı geçerli olsun diye). **2026-08-08: ikisinin de
  varsayılanı KALDIRILDI.** Önceden `application.yml` bunlar yoksa repoda yazan sabit
  değerlere düşüyordu (adres anahtarı birebir `.env.example`'daki değerdi), NestJS ise
  `"dev"` kullanıyordu — yani ayarlamayı unutan bir kurulum sağlıklı görünürken herkesin
  üretebileceği token'ları kabul ediyordu. Artık bu iki değer olmadan Java API açılmıyor
  ("Could not resolve placeholder 'JWT_SECRET'"), NestJS auth stratejisi de hata fırlatıyor.
  `.\dev.cmd` bunları `.env`'den export ettiği için normal akışta sorun çıkmaz; elle
  `mvnw` çalıştırıyorsan export etmeyi unutma.

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
- Sipariş onayı transaction içinde: PaymentIntent + stok düşümü; ödeme patlarsa hepsi geri
  alınır. **DeliveryJob burada oluşmuyor** — kurye ancak satıcı siparişi `ready` yaptığında
  çağrılıyor (`OrdersService.transition`, `deliveryService.createForOrder`). Bu doküman uzun
  süre "onayda oluşuyor" diyordu; 2026-08-09'da düzeltildi.
- **Mock sağlayıcı anında `succeeded` döner, Stripe DÖNMEZ**: `StripePaymentProvider`
  `requires_payment_method` durumunda bir intent yaratır, yani `place()`
  `{confirmed:false, requiresPayment:true, orderId, payment:{clientSecret...}}` döner ve
  istemci ödemeyi Stripe Elements ile tamamlar; siparişi `confirmed`'a çeviren şey
  `payment_intent.succeeded` webhook'u. (Doküman eskiden "server-confirm `pm_card_visa`"
  diyordu — öyle bir kod yok.) Bu yüzden `AI_PROVIDER`/`app.payments.provider=stripe`'a
  geçen her istemci akışının `requiresPayment` dalını ele alması ŞART.
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

- CORS: `app.cors.allowed-origin-patterns`, varsayılan `http://localhost:*`
  (`SecurityConfig` constructor'ında okunuyor). Burada uzun süre `app.cors.web-origin`
  yazıyordu — öyle bir property hiç olmadı, 2026-08-08'de düzeltildi.
- `dispatcherTypeMatchers(ASYNC).permitAll()` ŞART — kaldırılırsa SSE stream sonunda
  "Access Denied" ile bağlantı kopar (Firefox: "error in input stream").
- Public rotalar: /health, /auth/register, /auth/login, /auth/refresh, GET /kitchens/**,
  GET /track/*, POST /webhooks/delivery/*, POST /webhooks/stripe. `/auth/me` KORUMALI
  (whitelist'te değil, kasıtlı). ⚠️ `/track` bu dokümanda public yazmasına rağmen
  SecurityConfig'e hiç eklenmemişti — yani paylaşılan kurye takip linkleri giriş
  istiyordu; 2026-08-08'de eklendi. Doküman ile SecurityConfig'i birlikte güncelle.

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
- **`apps/mcp-server`**: Vitest (`pnpm --filter mcp-server test`), `src/oauth.test.ts` —
  49 test, ~1 sn, DB/network gerektirmez (platform API `fetch` ile stub'lanır). Testler
  `tsconfig.json`'da `exclude`'da: vitest kendi tiplerini getiriyor ve suite'i kendisi
  typecheck ediyor; build program'ında bırakılırsa `dist/oauth.test.js` yayınlanan çıktıya
  sızıyor ve vitest'in kurulu olmadığı yerde `tsc` kırılıyor.
- **`apps/api-java`**: JUnit 5 + AssertJ. `JwtServiceTest`, `AddressCryptoTest` — Spring
  context/DB gerektirmez. **Entegrasyon testleri 2026-08-09'da İLK KEZ gerçekten çalıştı**
  (29/29 yeşil); öncesinde "kod hazır, doğrulanmamış" durumundaydı ve aslında hiç
  çalışamazdı (aşağıya bak). **2026-08-12'de CI'da da doğrulandı** — `java` job'ı postgis
  service container'ıyla `Tests run: 29, Failures: 0, Errors: 0` + `BUILD SUCCESS` verdi
  (`OrdersServiceIntegrationTest`, `OrdersServiceDeliveryAddressIntegrationTest`,
  `KitchensServiceSearchIntegrationTest` dahil). **2026-08-24'te suite 39 teste çıktı** ve
  Docker artık bu makinede de çalıştığı için **yerelde de koşuyor** — CI tek koşum yeri
  değil. `java` job'ında artık postgis'in yanında bir **redis** service container'ı da var:
  Spring context Redis olmadan ayağa kalkmıyor.
- **Nasıl çalıştırılır (bu makinede):** `IntegrationTest` iki yoldan veritabanı bulur:
  `TEST_DATABASE_URL` doluysa hazır bir Postgres+PostGIS, boşsa Testcontainers. Testcontainers
  bu makinede hâlâ denenmedi, hazır DB yolu çalışıyor ve hızlı:
  ```powershell
  docker compose up -d
  # bir kereye mahsus: docker compose exec -T db psql -U culture -d postgres -c "CREATE DATABASE nanas_test"
  $env:TEST_DATABASE_URL = "jdbc:postgresql://localhost:5432/nanas_test"
  .\apps\api-java\mvnw.cmd -f apps\api-java\pom.xml test
  ```
  Harness her JVM'de `schema public`'i DROP edip migration'ları yeniden oynatır; bu yüzden adı
  `_test` ile bitmeyen bir veritabanını kasıtlı olarak reddeder (dev DB'yi silmemek için).
- **Neden hiç çalışamamıştı:** `MigrationRunner` SQL'i `split(";")` ile bölüyordu ve migration
  dosyalarının **yorum satırlarındaki** noktalı virgülleri de bölüyordu (`0003_reviews`,
  `0005_dish_requests`, `0009_refunds`, `0010_notification_preferences` — dördü de bozuluyordu).
  Artık gerçek bir tarayıcı var: `--` ve `/* */` yorumları, `'...'`/`"..."` kaçışları ve
  `$$`/`$tag$` gövdeleri içindeki `;` terminatör sayılmıyor.
- `@SpringBootTest` **MOCK** olmalı (NONE DEĞİL): `SecurityConfig` `HttpSecurity` alan bir bean
  tanımlıyor, onu sağlayan `@EnableWebSecurity` ise `@ConditionalOnWebApplication(SERVLET)`
  altında geliyor — NONE ile context hiç ayağa kalkmıyor.
- `TestData.insertKitchen` artık `addressEncrypted`'a **gerçek şifreli metin** yazıyor. Önceden
  `'encrypted-address'` literal'i vardı; `detail()` onaylanmış bir pickup siparişinde adresi
  çözmeye çalıştığı için `ADDRESS_DECRYPT_FAILED` ile patlıyordu.
- Kapsam: `OrdersServiceIntegrationTest`, `KitchensServiceSearchIntegrationTest`,
  `OrdersServiceCancelIntegrationTest`, `EarningsPayoutIntegrationTest`,
  `OrdersServiceDeliveryAddressIntegrationTest`,
  `OrdersServiceDeliveryAddressReadbackIntegrationTest`,
  `PortionsStreamRedisIntegrationTest`, `MockDeliveryQuoteRedisIntegrationTest`.
  Hepsi mutasyon testinden geçirildi (hata kasten geri konup kırmızı oldukları görüldü) —
  yani gerçekten davranışı tutuyorlar.
- **`apps/web` tarafında da 25 test var** (16'ydı): `lib/api.test.ts` eşzamanlı refresh
  yarışını, `lib/reviewWindow.test.ts` ay sonu taşmasını pinliyor. ⚠️ `api.test.ts`'te ısıran
  assertion **çağrı sayısı** (`/auth/refresh` bir kez) — iki istek de bozuk halde 200
  döndüğü için status'lere bakan bir test bu hatayı hiç görmez.
- ⚠️ **`mvnw spring-boot:run` forked bir JVM açar ve kabuğu öldürmek onu öldürmez.** Portta
  eski bir sürüm kalabilir; iki instance testinde tam bunu yaşadım ve yanlış bir "çalışmıyor"
  sonucu aldım. Önce `Get-NetTCPConnection -State Listen -LocalPort 8080` ile bak.

## Bilinen eksikler / sıradaki adaylar

- **"Rate restaurant" kapsamı netleşti ve uygulandı (2026-08-06):** her tamamlanmış sipariş
  `/orders/[id]`'deki `ReviewCard` üzerinden puanlanabiliyordu; buna ek olarak artık
  **6 aylık bir puanlama penceresi** var — `ReviewsService.REVIEW_WINDOW_MONTHS` (backend,
  `Order.createdAt` + 6 ay, `REVIEW_WINDOW_EXPIRED` hatası) ve `apps/web/lib/reviewWindow.ts`
  (`isWithinReviewWindow`, frontend'de `orders/page.tsx`'teki "★ Rate this order" rozeti ve
  `orders/[id]/page.tsx`'teki `ReviewCard` formu için — pencere kapandıysa form yerine kapalı
  mesajı gösteriliyor). **Chat'in mutfak arama kartına da rating eklendi (2026-08-06):**
  `KitchenSearchResult`'a `ratingCount` eklendi (ratingAvg zaten vardı), `SystemPrompt.java`'daki
  kart şeması ve `apps/web/app/chat/page.tsx`'teki kart artık `★ 4.5 (12)` gösteriyor
  (rating yoksa hiçbir şey basılmıyor, uydurma yapılmıyor).
- Gerçek ödeme (Stripe Connect satıcı ödemeleri), gerçek DoorDash/Grubhub, gerçek
  push/email bildirim kanalları (FCM/SES) — hepsi mock.
- `apps/api` (NestJS) tarafında hiç test yok (artık "referans", web sadece Java API'ye
  konuşuyor; orders modülü 2026-08-24'te silindi). `apps/mcp-server`'ın OAuth'u artık test
  altında, MCP tool'ları değil.
- Bağımsız bir buyer hesap/profil sayfası yok (telefon `/settings/notifications`'ta,
  ama genel "hesabım" sayfası yok).
- CI (GitHub Actions): pnpm sürümü package.json `packageManager`'dan gelir — workflow'a
  `version:` EKLEME (çift tanım hatası verir).
- Kaloriler temsili dev verisi; Nominatim dev geocoder'ı (üretimde ücretli servise
  geçilecek seam hazır: GeocodingService — hem `kitchens` hem `delivery` paketinde AYRI
  birer `GeocodingService` var, karıştırma). `delivery` olanına 2026-08-24'te sınırlı bir
  LRU cache eklendi (negatif sonuçlar dahil), ama ⚠️ **çağrı hâlâ sipariş yolunda ve istek
  thread'inde `Thread.sleep(1100)` yapıyor** — yük altında thread pool tüketir, ve OSM
  sunucu tabanlı toplu kullanımda IP banlıyor.

## Backlog / brainstorm (2026-08-06)

Tam liste masaüstünde `yapilacaklar-nanas-kitchens.txt`. Özet:
- **Yapılacaklar:** chat rating'i tarayıcıda gözle kontrol et; ~~`apps/api` DATABASE_URL
  bulamadan çöküyor~~ (2026-08-24'te düzeldi, `src/env.ts`); bağımsız buyer hesap sayfası
  yok; ödeme/teslimat/bildirim entegrasyonları hâlâ mock. **Güncel liste 8. turda ve
  masaüstündeki dosyada** — buradaki 08-06 özeti tarihsel.
- **[YARIN — 2026-08-07] Deployment/altyapı:** AWS üzerinden domain alınacak (Route 53); ECS
  (Elastic Container Service) üzerine container deployment kurulacak; CI/CD deployment pipeline
  kurulacak; bir Jenkins server ayağa kaldırılacak.
- **Fikirler:** satıcının yorumlara herkese açık cevap yazabilmesi, yoruma fotoğraf ekleme,
  "bu haftanın favorisi" rozeti, puana göre sıralama, favoriler listesi, "son siparişi tekrar
  ver", satıcı panelinde puan trend grafiği, düşük puanda satıcıya otomatik uyarı, sağlık
  denetimi + müşteri puanının birleşik "güven skoru", kötüye kullanılan yorumu şikayet etme.

## Hata avı ve düzeltmeler (2026-08-08)

CI uzun süredir kırmızıydı; sebebi hatırlanan "multiple versions of pnpm" DEĞİLDİ (o zaten
`d231581`'de çözülmüş). Gerçek sebep: `pnpm install` sırasında `@prisma/client`'ın postinstall'ı
workspace kökünden çalıştığı için `apps/api/prisma/schema.prisma`'yı bulamıyor ve **model tipleri
olmayan bir stub client** üretiyordu; `apps/api` bu yüzden 8 TS hatasıyla derlenmiyordu. Yerelde
görünmüyordu çünkü node_modules'te eskiden üretilmiş gerçek client hatayı maskeliyor —
**temiz bir klonda her zaman tekrar üretilir.** `ci.yml`'a ve `scripts/dev.ps1`'e
`prisma:generate` adımı eklendi.

Repo genelinde çok ajanlı bir hata avı yapıldı; düzeltilenler:

- **Payout**: satıcıya kurye teslimat ücreti ($3.99) ve kurye bahşişi de ödeniyordu. Komisyon
  zaten sadece yemek tutarından alınıyordu, yani kod kendi içinde tutarsızdı. `EarningsController`
  içinde 3 formül de düzeltildi; `gross` artık yemek tutarı demek (satıcı ekranındaki
  "gross − komisyon = kazanç" aritmetiği bu sayede bozulmadı, frontend'e dokunulmadı).
  **Kod tabanındaki tek payout formülü budur** — Stripe Connect gerçek ödemelere geçince
  parayı bu hesap taşıyacak.
- **Reddedilmiş sipariş iptal edilebiliyordu**: `decline()` zaten porsiyonu iade edip parayı
  geri gönderiyor, ama `declined` `FINAL_STATUSES`'te olmadığı için üstüne `cancel()`
  çalışabiliyordu → porsiyon ikinci kez stoğa ekleniyor (olmayan stok satışa çıkıyor), zaten
  iade edilmiş PaymentIntent'e ikinci refund gidiyordu.
- **Teslimat adresi kaydedilmiyordu**: doğrulanıyor, geocode ediliyor, 10 mil kontrolünden
  geçiriliyor, özete konuyor — ve INSERT'te yazılmıyordu. Şema'daki `deliveryAddressEncrypted`
  alanı Java kaynağının hiçbir yerinde geçmiyordu. Artık AddressCrypto ile şifrelenip
  yazılıyor. **Henüz kimse geri OKUMUYOR** — kuryeye/satıcıya göstermek ayrı bir iş.
- `/track` public rotalara eklendi (yukarıya bak).
- `JWT_SECRET` ve `ADDRESS_ENC_KEY` için sabit fallback'ler kaldırıldı (`.env` bölümüne bak).

### ⚠️ Açık kalan hatalar — tam liste masaüstünde `yapilacaklar-nanas-kitchens.txt`

Hata avı 24, denetim 12 ayrı sorun buldu; 10'u düzeltildi. **Secret'larla ilgili olanların
hepsi kapandı** (2. tur, aynı gün): delivery webhook HMAC secret'ının sabit varsayılanı da
kaldırıldı — kimlik doğrulaması olmayan `POST /webhooks/delivery/*` üzerindeki tek koruma
oydu; `.env.example`'daki çalışan secret değerleri boşaltıldı; ve **hem Java hem Node artık
32 karakterden kısa/boş `ADDRESS_ENC_KEY`'i reddediyor** (ikisi de sıfırla dolduruyordu,
yani boş değer sessizce "32 sıfır byte" anahtar demekti ve config varsayılanını kaldırmayı
da etkisiz bırakıyordu). Geçerli anahtarlar için türetme aynen korundu, iki backend
birbirinin şifresini çözmeye devam ediyor.

⚠️ Ama `.env`'deki `DELIVERY_WEBHOOK_SECRET` hâlâ repoda yayınlanmış olan değerin kendisi
(27 karakter) ve `JWT_REFRESH_SECRET` sadece 13 karakter — gerçek dağıtımdan önce ikisini de
değiştir.

### 3. tur — CI/lint gerçek oldu, çift gönderim kapandı (2026-08-08/09)

- **CI artık Java'yı derliyor ve test ediyor.** `ci.yml`'da ayrı bir `java` job'ı var
  (temurin 21 + maven cache). `*IntegrationTest` bilerek dışarıda — Testcontainers'a bağlı
  ve hiçbir yerde çalıştığı görülmedi; açmak ayrı bir iş. `mvnw` git'te LF + `100755`
  saklandığı için Linux runner'da `chmod`/`sed` gerekmiyor.
- **Lint gerçekten denetliyor.** Dört paketin dördü de tiyatroydu (web'de yapılandırılmamış
  `next lint` CI'da interaktif soruya takılıp `|| echo lint-skip`'e düşüyordu, `apps/api`'de
  eslint kurulu bile değildi). Artık tek bir flat config (`eslint.config.mjs`) ve kaçış
  kapısı yok. **Açar açmaz buldu:** `packages/core/src/` içinde git'e commit'lenmiş derlenmiş
  çıktı varmış ve `src/crypto.js` hâlâ kaldırılan sıfır-anahtar açığını taşıyormuş — silindi.
- **Çift gönderim kapandı.** Idempotency anahtarı artık istek içeriğinden + bir dakikalık
  kovadan türetiliyor (eskiden her denemede yeni UUID'ydi → iki sipariş, iki çekim, iki kez
  stok düşümü). Chat onay butonunda in-flight koruması var; checkout'ta herhangi bir sepet
  değişimi fiyat özetini geçersiz kılıyor.
  ⚠️ Bu bölümde iki kez kendi hatamı yakaladım, ikisini de **çalışan API'ye istek atarak**:
  (1) idempotency kontrolünü stok düşümünün altına koymuşum, ikinci istek stoğu düşürüp erken
  dönüyor ve `@Transactional` bunu commit ediyordu — porsiyon sızıyordu; (2) dedup, `pending`
  dışındaki her durumu "onaylandı" sayıyordu, iptal edilmiş sipariş dahil — iptal sonrası aynı
  sepeti tekrar sipariş etmek ölü siparişi geri veriyor ve hiç yeni kayıt oluşturmuyordu.
  **Bu tür değişiklikleri incelemeyle değil, gerçekten istek atarak doğrula.**

**Kalan açıklar (öncelikli):**
- ~~**MCP OAuth** ham platform refresh token'ını dağıtıyor~~ — **kapatıldı (2026-08-10),
  aşağıdaki "5. tur" bölümüne bak.**
- `apps/web/lib/api.ts:65` — eşzamanlı 401'ler tek kullanımlık refresh token için yarışıyor;
  kaybeden istek yeni token'ları silip kullanıcıyı çıkış yaptırıyor.
- Teslimat adresi artık yazılıyor ama **hiçbir yerden okunmuyor** — kuryeye/satıcıya
  göstermek ayrı bir iş.

### 4. tür — iptal penceresi, chat ödemesi, testlerin gerçekten çalışması (2026-08-09)

- **`OrdersService.cancel()` daraltıldı.** `FINAL_STATUSES`'i reddetmek yerine artık
  `CANCELLABLE = {pending, confirmed}` gerekiyor. Önceden `accepted`/`preparing`/`ready` iptal
  edilebiliyordu: pişmiş yemeğin porsiyonları stoğa geri ekleniyor (hayali stok) ve
  yemek+ücret+bahşiş tamamen iade ediliyordu. `orders/[id]/page.tsx` butonu da aynı kümeye
  bağlandı — iki taraf birlikte güncellenmeli. Askıda kurye korkusu çıkmadı: `DeliveryJob`
  zaten `ready`'de oluşuyor, yani iptal edilebilir durumlarda hiç kurye yok.
- **Chat artık ödenmemiş siparişi "onaylandı" saymıyor.** `body.order ?? body` kalkti; ödeme
  adımı `app/components/PaymentStep.tsx`'e çıkarıldı ve hem checkout hem chat aynı bileşeni
  kullanıyor. Yeni bir sipariş verme akışı yazarken `requiresPayment` dalını ele almadan
  "confirmed" gösterme.
- **Entegrasyon testleri ilk kez çalıştı** ve CI'da da çalışıyor (`ci.yml`'daki `java` job'ına
  postgis service container'ı eklendi, `-Dtest='!*IntegrationTest'` hariç tutması kaldırıldı).
  Ayrıntı için "Test suite" bölümüne bak.
- ⚠️ **Windows tuzağı, tekrar:** `Set-Content -Encoding utf8` bir `.java` dosyasına da BOM
  ekliyor ve derlemeyi bozuyor. Kaynak dosyaları PowerShell'le yazma — Edit/Write kullan.

### 5. tur — MCP OAuth kapatıldı (2026-08-10)

`apps/mcp-server/src/oauth.ts` yeniden yazıldı. Eski hali `/token`'dan **ham platform refresh
token'ını** döndürüyordu; kayıt (RFC 7591 `/register`) kimlik doğrulamasız olduğu için bu,
kendini kaydeden herkese 30 günlük, tam yetkili, istemci bazında iptal edilemeyen bir anahtar
vermek demekti — `apps/web`'in tuttuğundan ayırt edilemeyen bir anahtar.

- **İki token artık farklı şeyler.** `access_token` hâlâ platform access token'ı (resource
  çağrılarına değiştirilmeden iletiliyor); `expires_in` o JWT'nin kendi `exp` claim'inden
  okunuyor, sabit değil — eskiden 900 sn sabitti ve platform 8 saate çıkınca kaymıştı.
  `refresh_token` ise **burada üretiliyor** ve platform için hiçbir anlam taşımıyor; gerçek
  platform refresh token'ı `grants` içinde kalıyor, process'ten çıkmıyor.
- **Rotasyon + aile imhası:** MCP refresh token'ları tek kullanımlık. Zaten döndürülmüş bir
  token tekrar sunulursa kopyası sızmış demektir — o grant ailesi ve içindeki platform token'ı
  komple imha edilir. RFC 7009 `/revoke` de aynı şeyi yapıyor, yani istemcinin "disconnect"i
  gerçek. Token'lar SHA-256 ile indeksleniyor, açık halde tutulmuyor.
- **Sınırlar ve süpürme:** kayıt/kod/grant sayıları ve gövde boyutu tavanlı, süpürme istek
  üzerine tembel yapılıyor (timer YOK — `setInterval` process'i ayakta tutardı). Kullanılmayan
  bir kayıt 1 saat yaşıyor, ilk kod kullanımında 30 güne terfi ediyor.
- **Rate limit** `/register` ve login'de var. ⚠️ `X-Forwarded-For`'da **son** eleman
  kullanılıyor, ilk değil: proxy kendi gördüğü adresi sona ekler, solundaki her şey
  saldırgan metnidir. Kaç hop'a güvenildiği `MCP_TRUSTED_PROXIES` ile ayarlanır.
- Onay sayfasına CSP + `frame-ancestors 'none'` + CORS başlıklarının kaldırılması, token
  yanıtlarına `no-store` eklendi.

**Mutasyon kontrolü yapıldı (2026-08-12) — testler gerçek.** Altı kontrol tek tek kasten
bozulup suite'in kırmızıya döndüğü doğrulandı. Dördü yakalandı, **ikisi yeşil geçti** ve o
boşluklar kapatıldı (45 → 49 test):

- Ham platform refresh token'ını `/token`'dan geri döndür → 11 test kırmızı. Ama dikkat:
  koruma tek bir assertion çiftine dayanıyor (`refresh_token` platformunkine eşit olmamalı).
  Komşu iki test bu sızıntıyı YAKALAMAZ — biri platform token'ını *girdi* olarak reddetmeyi
  test ediyor (dışarı verilmesini değil), diğeri `access_token`'ın değiştirilmeden
  iletildiğini kasten doğruluyor. O assertion'ı zayıflatma.
- Rotasyonu kaldır / aile imhasını kaldır → her biri 1 test. Test bu ikisini ayırıyor:
  "tekrar reddedildi" ile "aile öldü" ayrı ayrı iddia ediliyor.
- `expires_in`'i 900'e sabitle → 4 test. İki çağrı yeri de bağımsız korunuyor.
- ~~`X-Forwarded-For`'da ilk elemanı al~~ → **yeşil geçiyordu.** Sebep: hiçbir test
  `MCP_TRUSTED_PROXIES` set etmediği için `clientIp()` erken dönüyordu ve fonksiyonun geri
  kalanı test altında ölü koddu. `TRUSTED_PROXIES` okuması modül seviyesinden `clientIp()`
  içine taşındı (dotenv geç yüklenirse 0'a donma bug'ını da düzeltiyor) ve 4 satırlık bir
  hop tablosu eklendi. Tablo sadece "son elemanı kullan"ı değil **hop sayısını** da
  sabitliyor: off-by-one ve `TRUSTED_PROXIES<0` mutasyonları da yakalanıyor.
- ~~Token'ları düz metin sakla~~ → **yeşil geçiyordu, en tehlikelisi buydu.** `sha256hex`
  yazarken ve okurken simetrik uygulandığı için kimlik fonksiyonuna çevirmek dışarıdan
  hiçbir farkla gözlemlenemiyor (45/45 yeşil, 42ms) — ama `refreshIdx` anahtarları canlı,
  tekrar oynatılabilir token'a dönüşüyor ve alan adı hâlâ `tokenHashes` olduğu için kod
  incelemesi de yakalamıyor. `__tokenStoreSnapshotForTests()` (test-only export, kopya
  döndürür, `platformRefreshToken`'a asla dokunmaz) eklendi ve saklanan her anahtarın
  64 hex karakter olduğu doğrulanıyor.

Ayrıca eşzamanlı refresh testi eklendi: `ref.consumed = true` **await'ten önce** yakılmalı;
altına alınırsa iki çakışan istek aynı platform token'ını harcıyor ve grant iki canlı
token'la kalıyor. Isıran assertion `callsTo("/auth/refresh") === 1` — status çifti mutasyon
altında da `[200, 400]` kalıyor, yani o çağrı sayımını silersen test işe yaramaz hale gelir.

**Hâlâ testsiz kontroller** (bilinçli, sıradaki iş): `MCP_REGISTRATION_TOKEN` kapısı (env
hiçbir testte set edilmiyor, o dal ölü kod), `REGISTER_RATE` ve pencere sonu ("limit kalkıyor
mu" hiç doğrulanmıyor), `MAX_CLIENTS`/`MAX_GRANTS`/`MAX_FAMILY_TOKENS` tahliye yolları.
`MAX_FAMILY_TOKENS=200` tahliyesinin güvenlik anlamı var: 200 rotasyondan sonra çok eski bir
sızmış token "bilinmeyen" görünür ve aile imha edilmez.

Hâlâ in-memory: process ölünce her istemci yeniden yetkilendirmek zorunda, çok örnekli
deployment'tan (ECS) önce paylaşımlı bir store şart.

### 6. tur — her şey main'e girdi (2026-08-12)

PR [#3](https://github.com/ctuka/NanasKitchens/pull/3) merge edildi (`a389b7f`). `osman`
dalındaki 33 commit `main`'e temiz fast-forward'la girdi, CI tamamen yeşildi. `osman` dalı
silinmedi. Aynı commit ikinci kopyaya da push'landı.

Merge öncesi tam bir denetim yapıldı; not edilmeye değer çıktıları:

- **Sır taraması temiz.** 30 commit'in tam diff'i (524 KB) + working tree + yerel `.env`
  tarandı: hiçbir yerde gerçek Stripe/Gemini/Anthropic/AWS/GitHub anahtarı veya private key
  yok, `.env` hiç takip edilmemiş. Repodaki değerler kendini ele veren placeholder'lar.
- **Ama `.env`'deki anahtarlar hâlâ o placeholder'ların kendisi.** `JWT_SECRET`,
  `JWT_REFRESH_SECRET`, `ADDRESS_ENC_KEY` — üçü de repoda yayınlanmış literal'ler. Dağıtımdan
  önce döndür. `ADDRESS_ENC_KEY`'i döndürmek **mevcut şifreli adresleri kullanılamaz hale
  getirir**, yani önce onlara ne olacağına karar ver.
- ~~`DELIVERY_WEBHOOK_SECRET` artık zorunlu ama yerel `.env`'de yok~~ — **2026-08-22'de
  kontrol edildi: artık var**, hem `.env` hem `apps/api/.env` içinde. Bu uyarı geçersiz.
  (Değer hâlâ repoda yayınlanmış olanın kendisi, yani rotasyon borcu duruyor.)
- **`merge/nanas-chatbot` bu merge'den sonra 5 dosya / 7 hunk çakışacak** (CLAUDE.md,
  SystemPrompt.java, CreateOrderRequest.java, chat/page.tsx, seller/kitchen/page.tsx).
  Sıradan bağımsız — ters sıra da test edildi, maliyet aynı. ⚠️ İçinde çakışma işaretinin
  göstermediği bir tuzak var: `chat/page.tsx`'te iki dal "alıcının konumunu chat agent'a
  gönder"i bağımsız ve uyumsuz biçimde yazmış ama sadece TEK satırda çakışıyorlar, o yüzden
  mekanik bir çözüm iki boru hattını da bağlı bırakıp birini öksüz koyuyor. Dahası
  `renderRich` importu çakışma bloğunun İÇİNDE, tek kullanımı DIŞINDA otomatik merge oluyor —
  import'ları `main` lehine çözmek (içgüdüsel seçim) hiçbir işaretin göstermediği bir
  "undefined identifier" build hatası üretiyor. main'in dört importunu **ve** chatbot'un
  `renderRich`'ini birlikte tut.
- `AddressCryptoTest.java` eski adres anahtarı literal'ini fixture olarak sabit tutuyor.
  Kendi başına zararsız ama gerçek anahtar malzemesiyle karışmasın diye yeniden adlandır.

### 7. tur — container'lama (2026-08-22)

Repoda **hiç Dockerfile yoktu** — `docker-compose.yml` yalnızca db + redis kaldırıyordu,
dört uygulamanın dördü de container'lanmamıştı. (Eski notlardaki "sadece `apps/api`
container'lanmadı" yanlıştı.) Beş imaj yazıldı, build edildi ve **çalıştığı doğrulandı**:

| imaj | boyut | doğrulama |
| --- | --- | --- |
| `nanas/web` | 343 MB | `GET /login` → 200 |
| `nanas/mcp-server` | 310 MB | `/.well-known/oauth-authorization-server` → 200 |
| `nanas/api-java` | 665 MB | Postgres'e karşı `/health` → `{"status":"ok","db":"up"}` |
| `nanas/api` | 931 MB | aynı şekilde `/health` → `{"status":"ok","db":"up"}` |
| `nanas/migrate` | 471 MB | boş DB'ye 14 migration, 24 tablo, postgis 3.4.3 |

**Hepsinin build context'i repo köküdür**, kendi dizinleri değil:
`docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=... -t nanas/web .`

Env'siz çalıştırıldıklarında **doğru sebeple** düşüyorlar — bu bir sağlık işareti:
`api-java` → `Could not resolve placeholder 'JWT_SECRET'` (2. turdaki fail-closed davranış
hâlâ yerinde), `api` → Prisma `P1001` (yani üretilen client gerçek, stub değil).

**Build sırasında iki gerçek hata çıktı; ikisi de kod incelemeyle bulunamazdı:**

- **`tsconfig.base.json` hiçbir imaja kopyalanmıyordu.** Belirti: `mcp-server`'ın `tsc`'si
  konteynerde **JS heap OOM** ile öldü — 3 dosyalık, 2000 satırlık bir pakette.
  `apps/{api,mcp-server}` ve `packages/core` tsconfig'lerinin üçü de ona `extends` ediyor;
  dosya yokken tsc **gürültülü biçimde patlamıyor**, sessizce derleyici varsayılanlarına
  dönüyor, `skipLibCheck`'i kaybediyor ve `node_modules` altındaki her `.d.ts`'i
  denetlemeye başlıyor. Küçük bir pakette OOM görürsen önce bunu kontrol et.
- **`mvnw` çalışma ağacında CRLF'ti** → `/bin/sh: 1: ./mvnw: not found`, exit 127, dosya
  tam orada dururken. Git'teki hali doğru (LF + 100755) ama `core.autocrlf=true` ve
  `.gitattributes` yalnızca `* text=auto` diyordu; Windows checkout'u CRLF veriyor.
  **Docker'ın build context'i git değil ÇALIŞMA AĞACIDIR**, dolayısıyla konteynere
  `#!/bin/sh
` gidiyor ve çekirdek `/bin/sh
` adında bir yorumlayıcı arıyor.
  ⚠️ **CI bunu asla göremez** (Linux checkout LF'tir) — yeşil CI bu sınıf hatayı elemiyor.
  `.gitattributes`'a `mvnw`/`gradlew`/`*.sh` için `eol=lf` eklendi ve dosya yeniden
  checkout edildi. **`.gitattributes`'ı değiştirmek diskteki dosyaları kendiliğinden
  düzeltmez**, etkilenen yolları yeniden materyalize etmek şart.

**Bilerek verilmiş kararlar:**

- `next.config.ts`'e `output: "standalone"` eklendi ama `NEXT_OUTPUT_STANDALONE=1`
  arkasına alındı; yalnızca Dockerfile set ediyor. Sebep: standalone çıktısı pnpm'in
  symlink ağacını yeniden kurmayı gerektiriyor ve Windows'ta symlink oluşturmak Developer
  Mode ister — koşulsuz bırakılınca `pnpm build` **derlemeyi bitirdikten sonra** `EPERM`
  ile patlıyor. Linux'ta (Docker/CI) böyle bir kısıt yok.
- `NEXT_PUBLIC_API_URL` **build zamanında bundle'a gömülür** (`lib/api.ts`). ECS task
  definition'a runtime env olarak vermek hiçbir işe yaramaz; `--build-arg` şart. Doğrulandı:
  verilen değer `.next/static` içinde 16 yerde duruyor. Domain alınınca imaj **yeniden
  build edilmek zorunda**, yeniden yönlendirilemez.
- `apps/api` ve `migrate` Debian/Alpine seçimleri keyfi değil: `argon2` native bir addon ve
  Prisma motorları libc'ye göre binary seçiyor.
- `apps/api` imajı build stage'in tamamını taşıyor (devDependency'ler dahil). `--prod` ağacı
  prisma CLI'ını düşürür ve üretilen client pnpm store'unun içinde yaşar. `pnpm deploy`
  ile incelmesi ileriye bırakıldı.
- `migrate` **1.2 GB'dan 471 MB'a indirildi**: pnpm workspace kurulumu tamamen kaldırıldı,
  yerine tek başına prisma CLI kuruluyor. Sürüm **hardcode değil**, build sırasında
  `pnpm-lock.yaml`'dan okunuyor (`test -n` ile boşsa build kasten patlıyor), yani lockfile
  tek doğruluk kaynağı olarak kalıyor.

~~**Hâlâ ECS'e engel**: fotoğraflar yerel diske yazılıyor; MCP OAuth store'u, portions SSE
sink map'i ve mock kurye quote'ları in-memory; `MenuRolloverJob` kilitsiz; Redis kodda hiç
kullanılmıyor; Nominatim IP ban riski.~~ — **8. tur bunların çoğunu kapattı**, güncel liste
aşağıda ve masaüstündeki `yapilacaklar-nanas-kitchens.txt`'te.

### 8. tur — açık hata listesi kapandı, Redis gerçekten bağlandı (2026-08-24)

Masaüstündeki todo'nun **bütün** açık hata listesi (H6, M15, M9–M13, L1–L5, L7–L9, L11)
artı E8, E11'in cache kısmı, E6/E7/E10 ve M5/M14/L6 kapatıldı. Java testleri 29 → 39,
web testleri 16 → 25. Dördü de mutasyon kontrolünden geçti.

**En önemli üçü:**

- **Teslimat adresi artık okunuyor (H6).** `deliveryAddressEncrypted` üç INSERT'te geçiyor
  ve hiçbir SELECT'te geçmiyordu — yani sipariş verilebiliyor ama ne satıcı ne kurye adresi
  görebiliyordu; teslimat akışı iki ucundan da kapalıydı. Satıcı panosu siparişi **kabul
  ettikten sonra** (FR10 kademeli açıklama; `SELLER_ADDRESS_VISIBLE`) adresi çözüp
  gösteriyor, `DeliveryProvider` arayüzü artık **pickup + dropoff** ikisini de alıyor
  (eskiden pickup adresi olarak düz `null` geçiliyordu).
- **Eşzamanlı 401'ler tek bir refresh'i paylaşıyor (M15).** ⚠️ Bu testi yazarken ısıran
  assertion **çağrı sayısıdır**, status değil: bozuk halde de iki istek 200 dönüyor.
- **`place()` artık her çağıran için doğruluyor (M10).** `CreateOrderRequest`'in
  kısıtlarını sadece controller'daki `@Valid` uyguluyordu, yani chat agent'ın `createOrder`
  tool'u hepsini atlıyordu (negatif kurye bahşişi, bozuk `fulfillment`). Yeni bir servis
  metodu bir DTO alıyorsa, o DTO'nun kısıtlarının kimin tarafından uygulandığını sor.

**Zaman dilimi — tekrar, ve bu sefer kök sebep (M13).** `Order.createdAt`'i Postgres'in
`CURRENT_TIMESTAMP` varsayılanı dolduruyor; kolon `TIMESTAMP(3)` yani **saat dilimsiz**,
ve `CURRENT_TIMESTAMP` **JDBC oturumunun** saat diliminde üretiliyor — pgjdbc de onu
**JVM'in default'undan** alıyor. UTC+3 bir makinede satırlar, karşılaştırıldıkları UTC
tarihlerin 3 saat önünde yazılıyordu; satıcı kazanç grafiği her UTC gününün ilk saatlerinde
o günün ödemelerini düşürüyordu. Sorgu değil **yazma tarafı** düzeltildi:
`TimeZone.setDefault(UTC)` (`main()`) + surefire'da `-Duser.timezone=UTC`. Artık DB
varsayılanları, `Timestamp.toInstant()` ve sorgular aynı takvimde.
⚠️ Bu turdan önce yazılmış satırlar hâlâ +03 duvar saatiyle duruyor (dev verisi).

**Redis artık gerçekten kullanılıyor (E6/E7/E10).** Baştan beri `.env`'de ve compose'daydı,
kod ona hiç dokunmuyordu — tüm repoda tek geçtiği yer bir yorum satırıydı.

- **Portions SSE** artık `portions:{kitchenId}` pub/sub üzerinden. Her instance tek bir
  **pattern aboneliği** tutuyor. Yayınlayan **kendi sink'ine kısa yol yapmıyor** — satışı
  yapan instance dahil herkes aynı yoldan öğreniyor, yani "tek task'ta çalışan, iki task'ta
  bozulan" bir yol kalmadı.
- **Kurye quote'ları** Redis'te, TTL'li ve tek kullanımlık. ⚠️ Bu hatanın görünmez olmasının
  sebebi: quote bulunamayınca mock base fee'ye düşüyordu ve base fee zaten quote ettiği
  değerdi. **Dönen ücrete bakan bir test hiçbir şey kanıtlamaz** — testler Redis anahtarına
  bakıyor.
- ⚠️ `listenToPattern` **değil** `listenToPatternLater`: Redis pub/sub'ın backlog'u yok,
  `PSUBSCRIBE` kaydolmadan önce yayınlanan mesaj kaybolur. "Akış var" ile "akış alacak"
  ayrı anlar. `subscriptionEstablished()` ikincisini veriyor.
- ⚠️ Publish **fire-and-forget değil**, 2 sn timeout'la bloklu. Commit sonrası çalışıyor ve
  düşen bir `subscribe()` Redis kesintisini komple yutardı: sipariş başarılı, bütün
  tarayıcılar bayat sayı, hiçbir yerde ses yok.
- **Gerçekten doğrulandı:** `:8080` ve `:8081`'de iki JVM, SSE akışı B'de açık, sipariş
  A'ya verildi, B'nin akışı **496 → 489** gitti.

**NestJS orders modülü silindi (M5/M14/L6).** Kimse çağırmıyordu (web ve mcp-server ikisi de
:8080) ama paylaşılan JWT secret'ıyla ağ içinden çalışıyordu ve migration öncesi halindeydi:
`declined` sipariş tekrar iptal edilebiliyor (ikinci iade + ikinci stok iadesi),
accepted/preparing/ready iptal edilebiliyor, `findUnique`+`update` arasında kilit yok, ve
`@Body` tipi bir TS **interface** olduğu için `ValidationPipe`'ın bakacağı bir metatype yok —
hiçbir alan doğrulanmıyordu. Aynı mantığı iki backend'de bakmak strangler'ın tersi olduğu
için onarılmadı.

**Denetimden kaçan dosyalar (L11).** `prisma/seed.ts`'te aynı nesne literalinde **iki
`photo` anahtarı** vardı; ikincisi kazanıyor, yani yemek tanımlarındaki fotoğrafların hepsi
ölü koddu. İki denetim birden kaçırmıştı: typescript-eslint `.ts` dosyalarında core
`no-dupe-keys`'i **kapatıyor** (tsc yakalar varsayımıyla) ve `apps/api/tsconfig.json` sadece
`"src"`'yi include ediyor — yani `prisma/` hiçbir programın içinde değildi. Kural geri
açıldı, `apps/api/tsconfig.seed.json` eklendi ve CI'ya `pnpm --filter api typecheck:seed`
adımı kondu. tsconfig ilk koşuşunda ölü satırın **tip hatası da** olduğunu buldu.

**`apps/api` artık kendi `.env`'ini okuyor.** `src/env.ts` (dotenv) — `main.ts` ve
`prisma/seed.ts` ilk önce onu import ediyor. `DATABASE_URL` export edilmemiş bir kabukta
`pnpm seed` çalıştırılarak doğrulandı.

**Secret rotasyonu — kısmi, bilerek.** `JWT_SECRET`, `JWT_REFRESH_SECRET`,
`DELIVERY_WEBHOOK_SECRET` yenilendi (üçü de repoda yayınlanmış literal'lerdi).
⚠️ **`ADDRESS_ENC_KEY` kasten dokunulmadı** — döndürmek mevcut şifreli adresleri kalıcı
olarak okunamaz yapar. Doğru an, ECS'e geçerken yeni DB kurulduğunda.

**Hâlâ ECS'e engel (güncel):** `E4` fotoğraflar yerel diske yazılıyor (S3 impl'i yok —
**sıradaki iş**); `E5` MCP OAuth store'u hâlâ in-memory (Redis bağlı olduğu için artık
küçük bir iş); `E2` migration job'ının **altyapı** tarafı (ECS RunTask + deploy adımı);
`E3` domain gelince web imajının yeniden build edilmesi; `E11` geocoding hâlâ sipariş
yolunda ve istek thread'inde blokluyor (cache eklendi ama asıl sorun duruyor).

## İsim / domain brainstorm (2026-08-07)

"Nanas' Kitchens" şu an **placeholder isim** — 45 yaş civarı hedef kitleye eski/yaşlı
hissettirebileceği düşünülüyor. Route 53 domain alımı isim netleşene kadar bilinçli olarak
ertelendi (AWS ECS/ALB domain olmadan da default AWS DNS adresiyle çalışır, isim netleşince
tek değişiklik host-bazlı routing + Route 53 kaydı olacak, mimariye dokunmaz).

Yön: kültür vurgusu değil **"world" temalı** bir isim (kod tabanındaki eski çalışma adı
`culture_eats`/CulturEats'in aksine). Aday isimler (World + X kalıbı ağırlıklı):
- **WorldBite** — şu ana kadarki favori.
- Diğer adaylar: WorldBites, WorldKitchens, WorldTable, WorldPlate, WorldFare,
  OneWorldKitchen, WorldFeast, WorldPantry, WorldDish, WorldFork, WorldSupper, WorldCrave,
  WorldPlatter, PassportKitchen (world kelimesi yok ama seyahat/keşif hissi taşıyor).

Henüz kesin karar yok, domain müsaitliği kontrol edilmedi. İsim netleşince: Route 53'ten
domain al → ECS/ALB deployment'ı kaldığı yerden devam ettir → repodaki "Nanas' Kitchens"
referanslarını (README, seed verisi, UI metinleri) güncelle.

## Test kullanıcı akışı (uçtan uca doğrulanmış)

Ana sayfa: hero chat kutusuna "turkish food near me" yaz → otomatik `/chat`'e geçip
gönderir → konum zaten seçiliyse sormadan mutfak listesi kartını gösterir → mutfak seç →
fotoğraflı menü kartından seç → "delivery" + (konum zaten varsayılan adres) → onay kartı
(adres değiştirilebilir, ABD dışı dahil) → Confirm → "Order confirmed" kartı → View order.
Uzak adres (>10 mil) veya ABD dışı adres (ör. Adana, TR) net bir mesajla reddedilir.
Seller: `ayse@demo.com` ile giriş → Today's Orders'ta günlük özet şeridi + kalem/fotoğraf
bazlı sipariş kartları → Accept/Preparing/Ready/Complete.
