# OpsCalc

ClickHouse'da **Logs + Traces + Metrics** saqlash uchun disk (SSD), throughput va IOPS kalkulyatori. TypeScript va Vite'da yozilgan web UI. Har bir natija yonida qanday hisoblangani (formula) ko'rsatiladi.

## Ishga tushirish
```bash
npm install
npm run dev      # http://localhost:5173
npm test         # hisoblash testlari
npm run build    # dist/ ga statik sayt
```

## Bo'limlar
1. **Trafik**: request/soat, peak koeffitsienti
2. **Logs**: qator/request, qator hajmi, siqish
3. **Traces**: span/request, span hajmi, sampling, siqish
4. **Metrics**: aktiv seriyalar, scrape interval, sample hajmi, siqish
5. **Saqlash**: retention, replika, shard, disk to'lish chegarasi, o'sish
6. **I/O**: write amplification, blok hajmi, so'rovlar yuki

## Formulalar
```
hodisa/s       = request/soat ÷ 3600 × hodisa/request     (metrics: seriya ÷ interval)
xom/kun        = hodisa/s × bayt × 86400
siqilgan/kun   = xom/kun ÷ siqish
saqlanadi      = siqilgan/kun × (retention + 1 kun)
node diski     = jami ÷ shard ÷ to'lish chegarasi
klaster diski  = jami × replika ÷ to'lish chegarasi
yozish MB/s    = siqilgan ingest × write amplification (peak bilan)
o'qish MB/s    = skan GB ÷ javob vaqti × parallel so'rovlar
IOPS           = (yozish + o'qish) MB/s ÷ blok hajmi
```
Hisoblash mantig'i: `src/clickhouse/calc.ts`.

## Yangi kalkulyator qo'shish
1. `src/calculators.ts` ga yozuv qo'shing (`slug`, `title`, `desc`, `ready: true`).
2. `<slug>/index.html` sahifa va `src/<slug>/main.ts` yarating (`clickhouse/` namuna).
Home page va build avtomatik yangilanadi.

## GitHub Pages
`main` ga push qilinganda `.github/workflows/pages.yml` saytni avtomatik deploy qiladi.
Bir martalik sozlash: repo **Settings → Pages → Source: GitHub Actions**.
Manzil: https://bakhod1r.github.io/opsclac/
