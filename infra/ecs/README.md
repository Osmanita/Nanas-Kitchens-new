# Nanas Kitchens — ECS Fargate

Hedef adresler: **https://nanaskitchens.app** ve **https://api.nanaskitchens.app**.
Bu dosyalar kurulumu hazırlar; commit veya CI çalışması AWS kaynağı oluşturmaz.
Gerçek kurulum için bir AWS hesabı, yetkili CLI oturumu ve Cloudflare DNS erişimi gerekir.

## Mimari

```text
Cloudflare DNS → HTTPS ALB → Next.js web / Spring Boot API (private Fargate)
                                      ↓
                           RDS PostgreSQL + PostGIS
                           ElastiCache Redis (TLS)
                           Private S3 photo bucket
```

| Dosya | Görevi |
| --- | --- |
| `foundation.yml` | İki AZ, ağ, ECR, RDS, Redis, S3, loglar ve dar kapsamlı görev rolleri |
| `migration.yml` | Yeni şemayı ve sınırlı `nanas_app` hesabını hazırlayan tek seferlik görev |
| `application.yml` | HTTPS, host yönlendirmesi, web/API görevleri ve geri dönüş ayarları |
| `../../scripts/ecs/deploy.sh` | İmajları yayınlar; migration başarıyla bitince servisleri günceller |

Varsayılan bölge **us-east-2 (Ohio)**. Web 0.25 vCPU/512 MiB, API 1 vCPU/2 GiB;
her servisten bir görev çalışır. Veritabanı 20 GB ile başlar, 100 GB'a kadar büyüyebilir.
`HighlyAvailable=false` bir NAT, tek RDS ve tek Redis kullanır; tam AZ dayanıklılığı sağlamaz.
Gerçek kullanıcı trafiği için foundation'da `HighlyAvailable=true`, uygulamada
`DESIRED_COUNT=2` seçilebilir. Bu değişiklikler maliyeti artırır.
NAT, ALB, RDS, Redis, Fargate, loglar ve depolama ücretlidir; kurulumdan önce AWS bütçe
uyarısı oluşturup bölgedeki maliyetleri değerlendirin.

## 1. AWS hazırlığı ve kalıcı altyapı

AWS CLI v2, Docker, Bash, Git ve `jq` gerekir. Windows'ta WSL veya Git Bash kullanın.
CLI için SSO/Identity Center oturumu tercih edin; anahtarları dosyalara gömmeyin.
Komutları depo kökünden çalıştırın. Foundation kuran operatörün CloudFormation,
EC2/VPC, ECS, ECR, RDS, ElastiCache, S3, Secrets Manager, Logs ve IAM oluşturma/PassRole
yetkileri olmalı; bu yetkiler uygulamanın görev rolüne verilmez.

```bash
export AWS_REGION=us-east-2
export FOUNDATION_STACK=nanas-foundation
aws sts get-caller-identity
aws cloudformation deploy --region "$AWS_REGION" \
  --stack-name "$FOUNDATION_STACK" --template-file infra/ecs/foundation.yml \
  --capabilities CAPABILITY_IAM --parameter-overrides HighlyAvailable=false
aws cloudformation describe-stacks --region "$AWS_REGION" \
  --stack-name "$FOUNDATION_STACK" --query 'Stacks[0].Outputs' --output table
```

Stack adı küçük harfli olmalı (ECR adlarında kullanılır). Template PostgreSQL 16.15
kullanır; kuracağınız bölgede gerekiyorsa `DatabaseVersion` parametresiyle desteklenen
başka bir 16.x sürümü seçin. PostGIS'i migration oluşturur. Uygulama yalnızca
`nanas_app` ile bağlanır; tablo oluşturma ve yönetici parolası migration görevine aittir.
RDS ve Redis internete açık değildir. Görevler Gemini/Stripe erişimi için NAT kullanır.

## 2. Sertifika ve Cloudflare

AWS ACM'de **aynı bölgede** `nanaskitchens.app`, `api.nanaskitchens.app` ve
`www.nanaskitchens.app` için public certificate isteyin; DNS validation seçin.
ACM'nin verdiği doğrulama CNAME kayıtlarını Cloudflare'a **DNS only** olarak ekleyin.
Doğrulama kayıtlarını sonradan silmeyin ve bu kayıtlarda flattening açmayın.
Sertifika `Issued` olunca ARN'ini alın.

Foundation çıktısındaki `LoadBalancerDns` değerini şu üç CNAME kaydının hedefi yapın:

| Cloudflare adı | Hedef | İlk kurulum |
| --- | --- | --- |
| `@` | `LoadBalancerDns` | DNS only; apex flattening otomatik |
| `api` | `LoadBalancerDns` | DNS only |
| `www` | `LoadBalancerDns` | DNS only; ALB apex'e yönlendirir |

ALB IP adreslerini A kaydına kopyalamayın. Başlangıçta DNS only kullanmak SSE sohbetini,
Stripe callback'lerini ve hata ayıklamayı sade tutar. Cloudflare proxy sonradan açılırsa
SSL modu **Full (strict)** olmalı; API, auth, ödeme ve SSE yanıtlarını cache'lemeyin.
`.app` HTTPS gerektirir; ALB HTTP'yi HTTPS'e yönlendirir.

## 3. Gizli ayarlar ve ödeme

Foundation çıktısındaki `ProviderSecret` ARN'ini AWS Secrets Manager'da açın.
Yeni bir secret value olarak aşağıdaki **anahtarları**, kendi sandbox değerlerinizle kaydedin:

```json
{
  "GEMINI_API_KEY": "",
  "STRIPE_SECRET_KEY": "",
  "STRIPE_PUBLISHABLE_KEY": "",
  "STRIPE_WEBHOOK_SECRET": ""
}
```

Boş örneği kaydetmeyin; dört değer de dolu olmalı. Anahtarları Git'e veya sohbete koymayın.
Stripe sandbox'ta webhook adresi `https://api.nanaskitchens.app/webhooks/stripe` olacak.
Dinlenecek olaylar mevcut `docs/stripe-local.md` belgesinde listelenir; bulut webhook'unun
imza anahtarı yerel Stripe CLI dinleyicisinin anahtarından farklıdır.

JWT, adres şifreleme ve veritabanı parolaları AWS'de üretilir; container imajına girmez.
Adres anahtarını mevcut veri varken rastgele değiştirmeyin: eski adresler çözülemez.
Bu kurulum boş bir bulut veritabanı oluşturur, yereldeki demo hesaplarını/kayıtlarını taşımaz.
Yerel veri sonradan aktarılacaksa `ADDRESS_ENC_KEY` uyumu ve yedek ayrı ele alınmalıdır.

## 4. İlk yayın ve sonraki sürümler

```bash
export AWS_REGION=us-east-2
export FOUNDATION_STACK=nanas-foundation
export DOMAIN_NAME=nanaskitchens.app
export CERTIFICATE_ARN='arn:aws:acm:us-east-2:ACCOUNT_ID:certificate/CERTIFICATE_ID'
export DESIRED_COUNT=1
bash scripts/ecs/deploy.sh
```

Sertifika örneğini kendi ARN'inizle değiştirin. Önce kodu commit edin. Script üç Linux
amd64 imajını derleyip ECR'a gönderir ve digest ile sabitler. Migration `exitCode=0`
dönmeden servis güncellemesi yapılmaz; hata oluşursa CloudWatch migration loguna bakın.
`prisma migrate deploy` kullanılır; `reset`, `db push` veya demo seed çalıştırılmaz.
İmaj etiketleri değiştirilemez; aynı commit/domain yeniden denendiğinde mevcut imaj kullanılır.
Taban imajlarını aynı commit'te yeniden derlemek için yeni, benzersiz `IMAGE_TAG` verin.

Web API adresi derleme sırasında belirlenir. ECS'de `NEXT_PUBLIC_API_URL` eklemek mevcut
tarayıcı paketini değiştirmez; domain değişince yeni imaj gerekir.
AWS Secrets Manager değerleri görev başlangıcında okunur. Secret değişiminde servisleri
`aws ecs update-service --force-new-deployment` ile yenileyin. DB uygulama parolasını
değiştirirken önce migration/grant görevini yeniden çalıştırın, sonra API'yi yenileyin.
Tek seferde yalnızca bir deploy çalıştırın; farklı sürümleri aynı anda yayınlamayın.

## Doğrulama, geri dönüş ve sınırlar

```bash
curl --fail https://nanaskitchens.app/health
curl --fail https://api.nanaskitchens.app/health
```

Web sağlık yanıtı cache'lenmez. API `/health` DB ve Redis'i kontrol eder, hazır değilse
503 döner; ECS'nin `/health/live` kontrolü bağımlılık kesintisinde görevleri yeniden
başlatmaz. Yeni görev sağlıksızsa ECS circuit breaker son sağlıklı sürüme döner.
Şema geri alınmaz; migration'lar eski uygulama sürümüyle uyumlu olmalıdır.
İlk kurulumda önceki sürüm bulunmadığından başarısız deploy düzeltilip yeniden denenir.

CI `ECS readiness` üç Docker imajını ve CloudFormation şemalarını kontrol eder;
AWS'ye yayın yapmaz. RDS yedi günlük yedek tutar ve silme koruması açıktır.
S3 fotoğrafları sürümlenir; bucket, ECR ve kritik secret'lar stack silinse de korunur.
Silme işlemi bu kaynakların maliyetini otomatik olarak sonlandırmaz.

İlk yayın bir **sandbox denemesidir**: Stripe test anahtarlarıyla doğrulayın.
Kurye hâlâ mock, dış bildirimler log, ses çözümleme mock durumundadır; gerçek teslimat
ve canlı ödeme açılışı için bunları ayrıca tamamlamak gerekir. Demo seed çalıştırmayın.
Canlıya geçmeden kaydolma, mutfak fotoğrafı, oylama/ön sipariş, Stripe webhook,
satıcı sipariş akışı ve yeniden deploy sonrası fotoğraf erişimini uçtan uca deneyin.

## Kaynaklar

- [ECS Secrets Manager entegrasyonu](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)
- [RDS TLS sertifikaları](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html)
- [Prisma PostgreSQL TLS ayarları](https://docs.prisma.io/docs/orm/v6/overview/databases/postgresql)
- [Cloudflare apex CNAME](https://developers.cloudflare.com/dns/cname-flattening/set-up-cname-flattening/)
- [Cloudflare doğrulama CNAME kayıtları](https://developers.cloudflare.com/dns/manage-dns-records/troubleshooting/cname-domain-verification/)
