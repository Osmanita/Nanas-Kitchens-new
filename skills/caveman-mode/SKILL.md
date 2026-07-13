---
name: caveman-mode
description: Token tasarrufu modu - Claude'un çıktısındaki gereksiz açıklamaları, kibar cümlelerini ve dolgu ifadelerini çıkararak %65'e varan oranda token tüketimini azaltın. Limitlerde çalışıyorsanız MUTLAKA açın.
---

# Caveman Mode - Token Tasarrufu & Verimlilik Skili

## Problem

Claude bir görevi tamamladığında, şöyle bir cevap verebilir:

```
"Tabii ki, sana yardımcı olmaktan mutluyum! 😊
İşte istediğin fonksiyon:

function calculateSum(arr) { ... }

Umarım bu faydalı olmuştur. Başka sorunun olursa
bana her zaman sorabileceğini unutma!

Iyi şanslar! 🎉"
```

**Problem:** Tüm bu "tabii ki", "mutluyum", emoji'ler, "başka sorunun?" — bunların hepsi **token yakıyor** ama bilgi taşımıyor.

## Caveman Mode Çözümü

Caveman Mode Claude'u şöyle ayarlar:

**"Sessiz ol. Sadece işi yap. Kibar cümleler yok."**

Çıktı şöyle olur:

```
function calculateSum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}
```

Hepsi bu. Açıklama? Gereksiz. Polite cümleler? Yok. Sonuç? Düz, net, verimli.

## Ölçüm: %65 Token Tasarrufu

Videoda ölçüm yapıldı:
- **Normal Claude** → tüm açıklamalar, temenniler, formatlamalar
- **Caveman Mode** → sadece sonuç

Ortalama token tüketimi: **%65 daha az**

### Neden Bu Kadar Fazla?

1. **Token hesaplaması iteratif**
   - Siz input veriyorsunuz → token yapar
   - Claude cevapla veriyorum → o da token yakar
   - Siz cevabı okuyorsunuz → içinde önceki mesajlar (concatenation) olur
   - Her turda bunlar birikiyor

2. **Caveman Mode çıktıları daha kısa olunca:**
   - Sonraki soruda context daha az
   - Model önceki mesajları daha çabuk okuyor
   - Daha net, daha hızlı cevap
   - Cascading token tasarrufu

## Opsiyonlar

Caveman Mode'un versiyonları:

### 1. **Ultra Caveman** (Maksimum Tasarrufu)
Sadece sonuç. Kod, veri, cevap. Hiçbir açıklama.

### 2. **Caveman Plus** (Dengeli)
Sonuç + 1 satır açıklama gerekirse (ama mümkün değilse).

### 3. **Tuned Caveman**
Sektöre/kültüre göre: işletim sistemi (tersliğe alışık), sağlık (detaylı → ama kısa).

## Ne Zaman Kullanalım

✅ **MUTLAKA KULLANALIM:**
- Claude API kullanıyorsanız (token limitleri var)
- Büyük projeler (1000+ satirda)
- Batch processing (toplu işlemler)
- Chatbot/agent (her turda token birikiyor)

✅ **ÖNERILIR:**
- Lisanslı modellerde (o/1, gpt-4 vs)
- Maliyeti önemli
- Hız önemli

❓ **İHTİYARİ:**
- Claude Plus kullanan casual user'lar
- Bir kerelik basit görevler
- Açıklamaları önemli (öğrenme amaçlı)

❌ **KULLANMAYıN:**
- Müşteriye rapor yazıyorsanız
- Detaylı öğretim gerekiyorsa
- İnsan ilişkisi önemli ("lütfen", "teşekkür" vs)

## Sınırlaması

⚠️ **Açıklamalar Kayboluyor**
- "Neden bu şekilde yaptı?" öğreneemiyor
- Kodun mantığı veya tasarım kararları anlaşılmaz
- Eğitim value'su düşük

⚠️ **Şeffaflık Azalıyor**
- Hata yapıp yapmadığını anlaması zor
- Gerekli adımları kaçırabilir (örn: güvenlik check'ler)
- Kontrol zor olur

⚠️ **Hata Toleransı**
- "Bunu öyle yapma, şöyle yap" diyemezsin (açıklamayı öğrenemezsin)
- Debugging zor

## Kullanım

```
// Caveman Mode'u aç
"Caveman mode. İşi yap, açıkla yapma."

// Veya başlangıçta
"Caveman mode, React component yaz"

// Sorgu gibi
"Mode: caveman. Database şeması tasarla."
```

## Kombinasyonlar

- **Caveman + Super Powers** = Verimli planlama (plan minimalist, adımlar net)
- **Caveman + Karpathy** = Etkili ve temkinli (seçenekler kısa, sorular direkt)
- **Caveman + UI UX Pro Max** = Tasarım önerileri ama kısa (kod/CSS, referans yok)

## Git Yıldızı

80,000+ star - kullanıcılar memnun.

## Sonuç

Caveman Mode, Claude'u verimli kılar. Açıklamalardan çok sonuca odaklanıyorsanız — ve bütçe veya limitler önemliyse — bu skill kaçmaz.

Ama aynı şey: "bana öğret" mi, yoksa "sadece yapmak" mı istediğin belli olunca karar vermelisin.
