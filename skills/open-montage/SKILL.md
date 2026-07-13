---
name: open-montage
description: Video prodüksiyonu otomasyonu - Grafikler, animasyonlar, altyazılar, geçişler, stok fotoğraf/video ile profesyonel video prodüksiyonu yapın. Remotion framework'üne erişim. Video içeriği üreten herkes için S-tier skill - Premiere Pro / After Effects işlemlerini otomatikleştirin.
---

# Open Montage - Video Prodüksiyonu Otomasyonu Skili

## Problem: Video Editing İşleri Zaman Alır

Profesyonel bir video editlemek ne kadar zaman alır?
- Grafikler, transition'lar: 5-10 dakika
- Altyazılar: 5+ dakika
- Animasyonlar: 10+ dakika
- Color grading, effects: 10+ dakika
- Sonuçlandırma, render: 20+ dakika

**Toplam: 50+ dakika**

Open Montage bunu **otomatikleştiriyor**. İnsan yapacağı visual editing işini (greyscale, filmstrip'e bağlı değil) kod üretip Remotion ile render ediyor.

## Ne Sunar

### 1. **Otomatik Video Şeması Oluşturma**

Claude'a "bana 30 saniyelik bir video yap: başında logo, ortasında sürgülü geçiş, sonda text animasyon" diyorsunuz.

Open Montage:
- Remotion (React tabanlı video kütüphanesi) kullanıyor
- Video sequence'ini JavaScript kod olarak yazıyor
- Render alıyor
- .mp4 video çıkartıyor

### 2. **Grafik & Animasyon**

**Öncesi (Manuel):**
- After Effects aç → composition oluştur → animasyon çiz → render → çıkış

**Open Montage ile:**
```javascript
// Claude bunu yazıyor
<Sequence from={0} durationInFrames={90}>
  <Logo position="center" opacity={0.8} />
  <Transition type="slide-left" duration={30} />
  <Text content="Başlık" animation="fade-in" />
</Sequence>
```

### 3. **Altyazı Otomasyonu**

STT (speech-to-text) veya provided text'ten:
- Otomatik timing hesapla
- Sinkronizasyon yap
- Stil belirle (font, renk, boyut)
- Render et

### 4. **Stok Fotoğraf/Video Entegrasyonu**

API yardımıyla:
- Unsplash, Pexels, Pixabay vs. bağlantı
- Arama (örn: "mavi gökyüzü", "ofis ortamı")
- Video'ya embed et
- Crop/resize otomatik

### 5. **Remotion İçeriye Entegre**

Open Montage açtığında **Remotion framework** kullanılabiliyor:
- React component olarak video
- Keyframe animasyon
- Effects: blur, opacity, transform
- Responsive render

## Pratikte Çıktı

### Örnek 1: YouTube Thumbnail Video

**İstek:** "Başlık yazısı ile 10 saniyelik hype videosunu yap"

**Claude (Open Montage ile):**
```javascript
import { Composition, Video, Img, Text, interpolate } from "remotion";

export const MyVideo = () => (
  <Composition>
    <Img src="background.jpg" scale={1.2} />
    <Text 
      text="BIG ANNOUNCEMENT" 
      fontSize={100} 
      animation="bounce-in"
      time={0}
    />
    <Video src="stagger.mp4" time={2} duration={8} />
  </Composition>
);
```

→ 10 saniyelik mp4 video render olur, ready to upload

### Örnek 2: Tutorial Video Auto-Editing

Screencast videosu + script:
- Zaman kodlarına göre metin overlay
- Okun göstermesi (auto-pointer)
- Kodun highlight edilmesi
- Geçişler, müzik sinkronizasyonu

**Çıktı:** Kurulu, profesyonel tutorial video

### Örnek 3: Social Media Reel

30-saniyelik reel:
- Birden fazla clip birleştirme
- Transition'lar (cutaway, fade, slide)
- Müzik sinkronizasyonu
- Caption/emoji overlay

## Kapsamı

✅ **Yapabilir:**
- Grafik, text, animasyon
- Geçiş (transition) efektleri
- Altyazı & caption
- Müzik sinkronizasyonu
- Video composition
- Stok fotoğraf/video entegrasyonu
- Renderlenmiş mp4

❌ **Yapamaz:**
- AI video generation (Sora gibi) - tek clip oluşturmuyor
- Gerçek 3D rendering (three.js gerekli)
- Real-time video (encoding gerekli)
- Ses generation (TTS başka tool)

## Ne Zaman Kullanalım

✅ **MUTLAKA KULLANALIM:**
- YouTube, TikTok videosu yapıyorken
- Tutorial, kurs videosu
- Sosyal medya content
- Marketing video
- Belgesel editing
- Podcast visual companion

✅ **ÇOK YARARLI:**
- Automated video reporting
- Live stream intro/outro'lar
- Ön işlemler (montaj blueprint'i)

❌ **GEREKLİ DEĞİL:**
- Sanat/sinema projesi (manual kontrol lazım)
- Compleks color grading
- VFX/effects (Blender + After Effects lazım)

## Workflow

1. **Video konsepti açıkla:** "30 saniyelik TikTok, dark mode tema, techno müzik, text animasyonu"
2. **Clipler sağla:** video file'ları, müzik, metin
3. **Claude çalışır:** Remotion kodu yazıyor
4. **Preview:** Her iterasyonda render kontrol ediyorsunuz
5. **Refine:** "Müzik biraz geciksin", "Font daha büyük"
6. **Export:** Final mp4 indir

## Sınırlamaları

⚠️ **Rendering Zaman Alır**
- Kompleks 4K video: birkaç dakika render
- Real-time değil

⚠️ **Custom Effects Gerekli Olabilir**
- Blender integration varsa ama limited
- Color grading manual gerekir

⚠️ **Müzik Hızlama/Yavaşlama**
- Sinkronizasyon önemli
- Dinamik tempo değişiklikleri kompleks

## Git Yıldızı & Başarı

İçeriğin yaygınlaşmasıyla, Open Montage'ı kullanan YouTube creator'lar ciddi zaman tasarrufu sağlıyor. Kendisi de videolarında kullanıyor.

## Özet

Open Montage, video editing'i **kodlaştırıyor** (infrastructure as code misali). Sıkıcı, zaman alan editing işini otomatikleştiren S-tier skill.

YouTube, TikTok, Instagram content üreteceğiniz her dönem: Open Montage mutlaka açın.

**Bonus:** Remotion sayesinde, video production'ı Git'te version control edebilir, ci/CD'de otomatikleştirebilirsiniz.
