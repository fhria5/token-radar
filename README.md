# Token Radar — token-radar-01

A token launch radar: pre-token protocols ranked by implied value, built
for the make.fun `token-radar-01` bounty.

## What it does

`main.ts` (Node 22, standard library only, no network) reads the sealed
snapshot at `/input/snapshot.json` and writes to `/output`:

- `board.json` — 226 ranked rows: all 40 watchlist protocols plus 186
  pre-token protocols below the watchlist floor, by TVL.
- `dashboard/` — a sortable, filterable board with a per-protocol detail
  view, the model's formula, and its comparables table.
- `screenshots/` — board, protocol detail, and filtered views.
- `dossier.json` — the judge's dossier, built with
  `vendor/makefun-board.ts`.

## The value model (radar-2)

```
implied = round( tvl_usd × comparableRatio(category)
               × growthMultiplier(change_7d)
               × ageMultiplier(age_days)
               × chainMultiplier(chains) )
```

- **comparableRatio** — the median mcap/TVL of tokenized protocols in
  the same category (128 tokenized protocols with a real market cap;
  global median 0.214), shrunk toward the global median when a category
  has few peers, clamped to 0.02–2.50.
- **growthMultiplier** — a damped log response to seven-day TVL growth,
  so one hot week can never dominate.
- **ageMultiplier** — pent-up value: longer listed with no token on
  record means more value waiting, capped at 1.20.
- **chainMultiplier** — a 3% premium per extra chain, up to four.

No protocol name is special-cased. Token-trading protocols are set aside
in the Live view at the market's own value. A protocol "records no
token" when the snapshot carries no market cap, CoinGecko id or symbol
for it — a record, not proof it has none.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Two runs write byte-identical output.
