# LA Tickets Analyzer

Lokálna webová aplikácia na analýzu LiveAgent ticketov. Stiahne historické tickety, identifikuje patterny v klasifikácii (ZP / TP / BUG / URGENT BUG) a navrhne deterministické pravidlá pre LA Rules engine.

## Setup

1. `npm install`
2. Skopíruj `.env.example` na `.env` a doplň `LA_API_KEY` (Configuration → API → API keys v LA admine).
3. `npm start`
4. Otvor `http://localhost:3001/`.

## Použitie

1. **Setup** — overí pripojenie cez `GET /agents`.
2. **Stiahnuť** — vyber dátum od/do a kliknite Spustiť. Sťahovanie ide cez SSE s progresom.
3. **Tagy** — kategorizuj všetky tagy, ktoré sa v dátach objavili. Klasifikačné tagy ZP/TP/BUG/URGENT BUG sú pre-vyplnené.
4. **Dashboard** — sekcie A–F: overview, trend, top kľúčové slová s G² skóre, distribúcie podľa klientov a domén, navrhované pravidlá, edge cases.
5. **Export** — `rules.md`, `rules.json`, `tickets.csv`.

## Použité LA endpointy

| Endpoint | Účel |
|---|---|
| `GET /agents` | overenie pripojenia + zoznam agentov pre detekciu first customer message |
| `GET /tags` | mapovanie tag IDs na názvy |
| `GET /tickets` (paginovane, `_filters`) | listing ticketov v období |
| `GET /tickets/{id}/messages` | extrakcia prvej správy od klienta |

### LA API kvirky

- Endpoint je `/tickets`, **nie** `/conversations`.
- `_filters` syntax je **array of arrays**: `_filters=[["date_created","D>=","YYYY-MM-DD HH:MM:SS"]]`.
- Date operátory majú prefix `D` (`D>=`, `D<=`, atď.), nie `>=`.
- API nevrátia total count — paging končí pri prázdnej odpovedi.
- Tagy v ticketu sú **IDs**, nie názvy.
- System auto-replies majú `userid: "system00"`.

## Troubleshooting

- **HTTP 404 na `/agents/me`** — niektoré LA inštalácie tento endpoint nemajú; používame `/agents`.
- **HTTP 401** — neplatný `LA_API_KEY`.
- **HTTP 403 na `/tags`** — neudávať `_perPage`. Bez query parametra to ide.
- **HTTP 429** — klient implementuje retry (1s, 2s, 4s, 8s) a 200 ms throttling.
- **Diakritika je nečitateľná v UI** — skontroluj, že `index.html` má `<meta charset="utf-8">` a server odpovedá `application/json; charset=utf-8`.
- **SSE download nereaguje na cancel** — server detekuje cancel cez `res.on('close')` (nie `req.on('close')`, ktoré v moderných Node verziách falošne zhasína po prečítaní request body).

## Stack

- Node 20+ (ESM, žiadny build step)
- Express 4
- Chart.js (CDN, frontend-only)
- `node:test` runner pre unit testy

## Tests

```
npm test
```

Spúšťa unit testy pre všetky moduly v `server/`. Tests neberú API kľúč — používajú fake fetch.

## Spec a plán

- Design spec: `docs/superpowers/specs/2026-04-27-la-tickets-analyzer-design.md`
- Implementačný plán: `docs/superpowers/plans/2026-04-27-la-tickets-analyzer.md`

## Mimo rozsah

- AI/ML klasifikácia, real-time integrácia, auto-deploy do LA, autentifikácia samotnej aplikácie.
