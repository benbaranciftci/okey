# 101 Masa

Eşli 101 Okey için ceza puanı tablosu. Dört oyuncu kendi telefonundan odaya girer; en düşük puan kazanır.

## Kullanım

1. Biri **Masa aç** → 4 harfli kod çıkar.
2. Diğerleri kodu yazıp **Otur**. Karşılıklı koltuklar eş.
3. Telefonsuz oyuncu varsa masa sahibi koltuğa isim yazar.
4. **Oyunu başlat**.
5. El bitince sahip **El bitti** der; herkes açış, kalan taş ve cezayı girer, **Kaydet**.
6. Sahip **Puanı yaz / kilitle**.

İnternet yoksa **Tek telefonda oyna**.

## Geliştirme

Node 20+.

```bash
npm install
npm run dev
```

```bash
npx wrangler login
npm run deploy
```

Yayın Cloudflare Workers üzerinde. Worker adı `okey`; adres `https://okey.elsayma.workers.dev`.
