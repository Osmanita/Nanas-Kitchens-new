---
name: andrej-karpathy-rules
description: Claude'u frenleme kuralları - Andrej Karpathy'nin 4 temel prensipi ile daha temkinli, kontrollü ve hata yapması daha az olan çalışmasını sağlayın. Kodda kesinlik gereken ve varsayım yapılması tehlikeli olan durumlarda MUTLAKA kullanın.
---

# Andrej Karpathy'nin Kuralları - Kontrol & Hassasiyet Skili

Claude gibi güçlü bir dil modelinin ana sorunu: çok emin bir şekilde yanlış cevap verebilir. Yapay zeka yazarları tarafından En önemli teknik isimlerden biri olan Andrej Karpathy, "artık yazdığım kodun çoğunu ben değil yapay zeka yazıyor" dedi ve yapay zekanın kod yazarken en çok battığı noktaları 4 basit kurale dökmüş.

Bu 4 kural Claude'u "frenliyor" - onu güçlü kalan bir motoru kontrol etmek için dizginleyen yönetim kuralları.

## 4 Temel Kural

### 1. **Kafandan Varsayım Yapma**

Claude, basitçe en olası cevabı seçip ilerleyebilir. Ama eğer bir noktada belirsizlik varsa, o belirsizliği suskunlukla geçer ve hata yapabilir.

**Yapılması gerekenler:**
- Emin değilsen **sor**
- Birden fazla ihtimal varsa **hepsini söyle**
- Sessizce bir seçeneği seçip devam **etme**

**Örnek:**
❌ Yanlış: `database.connect()` — varsayıldı ki bağlantı string'i scope'da var
✓ Doğru: "Bu kod için database connection string'i nerede olacak? config dosyasında mı, environment variable'da mı, yoksa parametre olarak mı geçilecek?"

### 2. **En Sade Çözümü Yap**

Gereksiz özellik ekleme. Proje her zaman basit başlar ama zaman geçtikçe karmaşıklaşır. Claude bunu tahmin edip preemtif feature'ları ekleyebilir.

**Yapılması gerekenler:**
- İşe yaramayacak ekstra özellik ekleme
- Scope dışındaki genelleştirmeler yapma
- Sadece istenen işi yap

**Fayda:** Token tasarrufu + Net kod + Bakım kolaylığı

### 3. **Sadece İstenen Yere Dokun**

Yan taraftaki çalışan kodu iyileştirmek için değiştirme. Bir fix için iki şey çalışıyor: biri benim görevim, diğeri çalışan ama "daha iyi hale getirilebilir" özellik. İkincisine dokunma.

**Yapılması gerekenler:**
- Scope'a sıkı sıkı bağlı kalma
- Refactoring'i ayrı tasklar için ayır
- Çalışan kodu bozma riski almama

**Neden önemli:** Her değişiklik bug riski taşır. Scope creep projeleri karmaşıklaştırır.

### 4. **Çalıştırmadan Önce Kontrol Et**

"İşi bitirdim" demeden, gerçekten istenen şey mi diye bak. Claude halüsinasyon görebilir — kod doğru gibi görünebilir ama testler geçmeyebilir.

**Yapılması gerekenler:**
- Çıktıyı manual test et
- Örnek input'lar ile çalıştır
- Edge case'leri kontrol et
- İş yapıyor mu gerçekten, sadece doğru görünüyor mü?

## Ne Zaman Kullanalım

Bu skill özellikle değerli:

- **Kritik kod yazarken** - kütüphane, API, güvenlik ilgili
- **Kompleks projeler** - veri migrasyonu, sistem tasarımı
- **Hata toleransı düşük** - finansal kod, tıbbi sistem, işletim sistemleri
- **Belirsiz requirements** - "bunu istiyorum ama nasıl olacağını bilmiyorum" durumları

## Sınırları

- Basit, one-shot görevlerde aşırı temkinli hale gelebilir (örn: "bu 3 satırlık fonksiyon ne yapıyor?")
- Bazı durumlarda işi yavaşlatabilir
- Claude'un doğal güvenine (confidence) engel olabilir - bu aslında iyi bir şeydir ama bazen overkaution yapabilir

## Kullanım

Claude'a bu skili kullanmasını söyledikten sonra, model:
- Daha fazla soru soracak
- Varsayımları açıkça arayacak
- Birden fazla seçenek sunacak
- Kontrol noktalı adımlar atacak

Bu skill'i **Karpathy'nin Super Powers skili ile beraber** kullanmak en güçlü kombinasyondur.
