# Rangkai

Puzzle foto kolaboratif untuk browser. Situs statis ini berjalan di Vercel, dengan Supabase untuk autentikasi tamu, penyimpanan foto, state puzzle, dan Realtime.

## Fitur

- Buat puzzle dari tiga gambar contoh atau foto sendiri (JPG, PNG, WEBP).
- Pilih sekitar 24, 48, 96, atau 150 keping; jumlah akhir menyesuaikan rasio gambar.
- Bagikan tautan room. Pemain masuk dengan nama tanpa registrasi email.
- Cursor bernama dan keping yang sedang diseret terlihat secara realtime. Cursor diperhalus dengan interpolasi setiap frame; laju pengiriman menyesuaikan jumlah pemain.
- Posisi akhir keping disimpan di database. Klaim keping mencegah dua pemain menaruh keping yang sama sekaligus.
- Papan bisa digeser dan di-zoom dengan mouse atau sentuhan.

## Jalankan lokal

Tanpa Supabase, aplikasi berjalan dalam **mode demo lokal**. Room hanya tersimpan di browser yang sama; buka dua tab untuk mencoba cursor dan sinkronisasi.

```sh
npm run dev
```

Buka `http://localhost:3000`. Tidak ada paket npm yang perlu diinstal.

## Aktifkan multiplayer online

1. Buat proyek Supabase Free.
2. Di **Authentication → Providers**, aktifkan **Anonymous Sign-Ins**.
3. Di **Realtime → Settings**, matikan **Allow public access** agar channel privat memakai kebijakan akses dalam skema.
4. Jalankan seluruh isi [`supabase/schema.sql`](supabase/schema.sql) di **SQL Editor**. Skema membuat tabel, bucket privat, RPC, dan RLS.
5. Buat `.env` dari `.env.example`, isi `SUPABASE_URL` dan `SUPABASE_PUBLISHABLE_KEY`. Kunci ini memang kunci publik untuk browser. **Jangan masukkan service role key**.
6. Jalankan `npm run dev` lagi. Badge di kanan atas akan berubah dari demo lokal menjadi status koneksi.

Untuk pengguna publik, aktifkan CAPTCHA atau Turnstile pada anonymous sign-in melalui pengaturan Supabase agar akun tamu tidak mudah disalahgunakan. Room menggunakan UUID acak sebagai link undangan: siapa pun yang memegang link dapat bergabung. Foto berada di bucket privat dan URL unduhan yang diberikan ke anggota berlaku satu jam.

## Deploy ke Vercel

1. Push proyek ini ke GitHub lalu **Import Project** di Vercel.
2. Tambahkan `SUPABASE_URL` dan `SUPABASE_PUBLISHABLE_KEY` di **Project Settings → Environment Variables** untuk Production dan Preview.
3. Build command `npm run build`, output directory `dist` sudah ada di `vercel.json`.
4. Deploy. Buka URL Vercel, buat room, dan uji link dari browser atau perangkat lain.

Vercel Hobby cocok untuk proyek pribadi nonkomersial. Free tier Supabase memiliki batas pesan Realtime; aplikasi menahan laju pengiriman cursor sekitar 4–10 pesan per detik per pemain sesuai jumlah pemain, lalu menganimasikan gerakannya di browser. Jika room ramai atau dipakai lama, pantau metrik pesan dan storage di dashboard Supabase.

## Struktur

- `public/app.js`: alur UI, room, upload foto, dan sinkronisasi.
- `public/game.js`: gambar papan dan keping, input drag, snap, zoom, animasi cursor.
- `public/supabase.js`: API Supabase, autentikasi anonim, Realtime, demo lokal.
- `supabase/schema.sql`: database dan kebijakan akses.
- `scripts/build.mjs`: menghasilkan situs statis di `dist` dengan konfigurasi publik.

## Batas saat ini

- Keping menempel ke posisi akhir di papan. Rotasi dan penggabungan kelompok keping bebas belum tersedia.
- Mode demo hanya menyinkronkan antar-tab pada browser/origin yang sama. Multiplayer antar-perangkat memerlukan konfigurasi Supabase.
- Foto custom dalam mode demo disimpan di localStorage; ruang lama bisa hilang jika data browser dihapus.
