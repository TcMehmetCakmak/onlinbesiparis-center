# UYGULAMA ADIMLARI

1. Önce `sql/app-settings-phone-multitenant.sql` dosyasını ORTAK operasyon Supabase projesinde çalıştırın:
   `otxzntnfpkgeqlfswzcb`

2. ZIP içindeki `root/index.html`, `root/admin.html`, `root/platform-config.js`
   dosyalarını GitHub reposunun ANA DİZİNİNDEKİ dosyalarla değiştirin.

3. Ana dizindeki mevcut `supabase-config.js` dosyasını DEĞİŞTİRMEYİN.

4. `cakmak-tatlici/` klasöründe:
   - Eski büyük `index.html` dosyasını silin/değiştirin.
   - ZIP'teki küçük `cakmak-tatlici/index.html` dosyasını koyun.
   - ZIP'teki `cakmak-tatlici/admin.html` dosyasını koyun.
   - `cakmak-tatlici/platform-config.js` artık gerekli değil, silinebilir.
   - `cakmak-tatlici/supabase-config.js` artık gerekli değil, silinebilir.

5. İsterseniz `/durumcu/` URL'si de çalışsın diye ZIP'teki `durumcu/` klasörünü ekleyin.
   Root URL doğrudan açıldığında zaten varsayılan `durumcu` çalışır.

6. Git commit/push yapın.

7. Test:
   Müşteri:
   https://tcmehmetcakmak.github.io/onlinbesiparis-center/cakmak-tatlici/

   Admin:
   https://tcmehmetcakmak.github.io/onlinbesiparis-center/cakmak-tatlici/admin.html

8. Admin > Genel Ayarlar'da Çakmak Tatlıcı telefon/WhatsApp numarasını girip kaydedin.

NOT:
- Dükkan adı değiştirme talebi şimdilik güvenlik amacıyla devre dışıdır.
- Sonraki adımda request-shop-name-change Edge Function ortak multi-tenant hale getirilecek.
