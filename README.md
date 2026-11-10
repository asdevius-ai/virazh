# Вираж

Тренажер маршрутів практичного іспиту з водіння. Відкриваєш маршрут ТСЦ на карті, натискаєш ▶ — машинка їде маршрутом, а ти бачиш, яка зараз вулиця, де перехід, світлофор чи знак.

**Сайт: https://asdevius-ai.github.io/virazh/**

Зараз є ТСЦ МВС № 6841 (Хмельницький, вул. Західно-Окружна, 11/1) — 20 маршрутів.

> Тільки для ознайомлення: фактичний маршрут залежить від екзаменатора.
> Маршрути відновлено з офіційних схем [hsc.gov.ua](https://hsc.gov.ua/m-hmelnitskij-vul-zahidno-okruzhna-11-1-tsts-mvs-6841/); неточності можливі — див. [docs/REVIEW.md](docs/REVIEW.md).

## Що вміє

- карта (темна тема, OpenStreetMap / OpenFreeMap), маршрут зі стрілками напрямку;
- машинка їде сама, камера стежить; пауза, швидкості 0,5× / 1× / 2× / 4×, перемотування;
- поточна вулиця і прогрес «N з M м»;
- підказка заздалегідь: «Далі: Пішохідний перехід — 40 м»;
- знаки й переходи на карті, тап — номер знака за ПДР;
- мінікарта всього маршруту;
- працює як PWA: можна додати на головний екран iPhone (Safari → Поділитися → На початковий екран).

## Стан маршрутів

20 маршрутів: 17 перевірених, 3 чернетки (№11, 18, 20 — схема суперечлива або неповна). Подробиці й усі сумнівні місця — у [docs/REVIEW.md](docs/REVIEW.md).

## Розробка

```bash
npm ci
npm run dev        # http://localhost:5173/virazh/
npm run build      # збірка в dist/
```

Деплой — автоматично на GitHub Pages після push у `main` (`.github/workflows/deploy.yml`).

### Дані

Сайт читає готові JSON із `public/data/`. Вони збираються локальним пайплайном у `tools/` (докладно — [tools/README.md](tools/README.md), формат — [docs/DATA.md](docs/DATA.md)):

```bash
npx tsx tools/fetch-osm.ts            # дороги й знаки з OpenStreetMap (раз)
node tools/routes-6841.mjs            # опорні точки → data/routes-src/*.yaml
npx tsx tools/build-route.ts --all    # маршрутизація OSRM → public/data/routes/*.json
npx tsx tools/build-index.ts          # списки ТСЦ і маршрутів
npx tsx tools/preview-route.ts 6841_1 # PNG для звірки зі схемою
```

Щоб виправити маршрут, зміни його опорні точки в `tools/routes-6841.mjs` (у dev-режимі є помічник `#/digitizer`: клік по карті → точка → «Копіювати YAML») і перезбери.

Щоб додати інший ТСЦ: запис у `data/centers-src.yaml`, схеми в `data/raw/<id>/`, файл опорних точок за зразком `tools/routes-6841.mjs`.

## Документи

- [PROGRESS.md](PROGRESS.md) — стан робіт
- [docs/DECISIONS.md](docs/DECISIONS.md) — ухвалені рішення
- [docs/REVIEW.md](docs/REVIEW.md) — що треба перевірити людині
- [docs/QA.md](docs/QA.md) — звіт тестування

## Ліцензії даних

Карта й дані про дороги та знаки — © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL). Тайли — [OpenFreeMap](https://openfreemap.org/), схема — OpenMapTiles. Маршрутизація під час підготовки даних — OSRM.
