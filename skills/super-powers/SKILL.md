---
name: super-powers
description: Plan modu aktivasyonu - Claude'u planlama ve step-by-step düşünme moduna alın. Halüsinasyon ve mantıksız adımları azaltır, büyük projelerde hata yapması daha zor hale gelir. Her türlü kompleks görevde MUTLAKA kullanın.
---

# Super Powers - Planlama & Düşünce Modulu Skili

Claude'un sorunu: çok güçlü ama kontrolsüz bir motor gibi davranabilir. Yanlış problemi çok emin bir şekilde çözer, halüsinasyon görür ya da hızlı aksiyona geçip hata yapabilir.

**Super Powers** bunu tersine çevirir: Claude'a düzenli bir çalışma alanı ve adım-adım bir metodoloji vererek, onu halüsinasyon görmekten vb sorunlardan korur.

## Core Mekanizm

Super Powers skill'i Claude'u şu adımlara zorlayıp kılavuzluyor:

1. **Problemi Anla** - Yapılması istenen şey tam olarak nedir?
2. **Seçenekleri Değerlendir** - Birden fazla yol var mı? Hangisi daha iyi?
3. **Plan Yap** - Hangi adımları takip edeceğim?
4. **Adımları İcra Et** - Her adımı sırasıyla yap
5. **Kontrol Et** - Sonuç amaçla eşleşiyor mu?

Bu, yalnızca "bunu yap" demektense, Claude'u **kontrollü bir yolculuğa** çıkartır.

## Pratikte Ne Değişir

### Olmadan (Kontrol Yok)
```
User: "Veritabanını tasarla"
Claude: [Hızlı bir şemayı yazıyor, ama bazı noktaları gözardı ediyor]
```

### Super Powers ile (Kontrol Var)
```
User: "Veritabanını tasarla"
Claude: 
1. Anlama: "Hangi veri türleri? Ölçek nedir? Performans gereksinimi?"
2. Plan: "User tablosu, Post tablosu, Index stratejisi..."
3. Sorma: "Bu senin ihtiyacın mı? Başka alternatifler de var, mesela..."
4. İcra: [Adım adım şemayı oluşturuyor]
5. Kontrol: "Burada N+1 sorunu olabilir, kontrol etmeliyiz"
```

## Ne Zaman Açılır

Super Powers genellikle şu durumlarda **otomatik aktif** olur:

- Büyük projeler (100+ satır kod)
- Kompleks mimariye karar verme
- Belirsiz requirements
- Kritik sistem tasarımı
- Multi-step transformasyon işleri

Ama siz de **istek üzerine** açabilirsiniz: "Plan moduna geç" veya "Bunu step-by-step yap"

## Faydaları

✅ **Halüsinasyonları Azaltır** - Model her adımda kontrol noktaları koyar
✅ **Hata Riski Düşer** - Birden dalmaz, adım adım ilerler
✅ **Daha Net Sonuç** - Şeffaf bir process ortaya çıkar
✅ **Büyük Projelerde Güvenilir** - Scale eden işlerde daha stabil

## Sınırlıklar

⚠️ **Bazen Aşırı Temkinli Olabilir**
- "3 satırlık döngü yaz" için bile 10 soru sorabiliyor
- Basit görevleri yavaşlatabilir
- "Sadece bunu yap" durumlarda over-engineer yapabilir

⚠️ **Kontrol Size Geçer Ama Sorumluluk da**
- Claude 5 seçenek sunabilir, siz seçmeli
- Açıklamalar daha uzun oluyor
- Model tam otonom hareket etemiyor

## Super Powers + Andrej Karpathy'nin Kuralları

Bu iki skill beraber kullanıldığında **inanılmaz güçlü** bir kombinasyon oluşur:

- **Karpathy Kuralları = Frenleme** (varsayım yapma, scope bounded, kontrol et)
- **Super Powers = Yönlendirme** (planlanmış, adım adım, reflect)

Birlikte: Claude "disiplinli ve temkinli akıllı asistan"a dönüşür.

## Kullanım

```
// Plan moduna girme
"Plan modunu aç, bu işi step-by-step yap"

// Veya Claude bunu otomatik algılayabilir
"Yeni microservice mimarisini tasarla"
→ Claude otomatik plan moduna girer
```

## Git Yıldızı

246,000+ star - 2026'da "en iyi skilleri" listesinde en çok gösterilenen yetenek.

## Özet

Super Powers, Claude'u "motivsiz motor"dan "planlı, temkinli mühendis"e dönüştürür. Kompleks iş? Hemen Super Powers. Basit iş? Gereksiz kalabilir. Ama işte bu seçim size kalmış.
