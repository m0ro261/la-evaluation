# LA Tickets Analyzer & Rules Recommender — Design Spec

- **Date:** 2026-04-27
- **Status:** Draft for user review → implementation
- **Source:** Handoff document from user (2026-04-27) + empirical API exploration against `creativesites.ladesk.com`

## 1. Purpose

Local web app that pulls historical LiveAgent tickets, finds patterns in how the team classifies them (ZP / TP / BUG / URGENT BUG), and proposes deterministic rules for the LA Rules engine. The output is argumentation material: show that ~90% of the manual "Zhodnotenie TL" step can be automated without AI.

## 2. Users and success criteria

- **Primary user:** Helpdesk Team Leader (the project owner). Single user, single LA tenant.
- **Success:** user opens the app, downloads the last 6 months of tickets once, and walks through the dashboard producing a defensible list of candidate rules with confidence/coverage stats and an export bundle for a stakeholder meeting.
- **Hard requirement:** runs locally on `npm install && npm start`, opens at `http://localhost:3001`, no external services besides LA API.

## 3. Stack

- **Runtime:** Node.js 20+, no build step
- **Server:** Express (matches sister `la-gitlab-mvp` project)
- **HTTP client:** built-in `fetch`
- **Config:** `dotenv` (`.env`, gitignored; `.env.example` committed)
- **Storage:** JSON files on disk under `data/` (gitignored). No SQLite — avoids native bindings on Windows.
- **Frontend:** vanilla HTML + CSS + JS, no framework, no bundler
- **Charts:** Chart.js via CDN
- **Language of UI:** Slovak

## 4. LiveAgent API — confirmed integration details

These corrections override the handoff (which had several wrong assumptions). All confirmed empirically against the live tenant.

| Topic | Truth |
|---|---|
| Tickets endpoint | `GET /api/v3/tickets` (NOT `/conversations`) |
| Auth | Header `apikey: <key>` |
| Paging | `_page` (1-indexed), `_perPage` (max 100). No total count anywhere — paginate until empty array. |
| Date filter | `_filters=[["date_created","D>=","YYYY-MM-DD HH:MM:SS"]]` — array of arrays, date operator has `D` prefix (`D>=`, `D<=`, `D>`, `D<`, `DP`) |
| Sort | `_sortField=date_created`, `_sortDir=ASC` |
| Tags in ticket | Returned as **IDs** (e.g. `"6vy2"`), not names. Resolve via `GET /api/v3/tags`. |
| `includeRelated` | No effect on `/tickets` listing — ignored. |
| `custom_fields` | Returned as `[]` for all sampled tickets in this tenant; ignored for now. |
| Messages | `GET /api/v3/tickets/{id}/messages` returns groups: `[{userid, messages:[{type, format, message}]}]`. Headers are `type:"H"` (Subject:, From:, To:); body is `type:"M"`, usually `format:"H"` (HTML). System auto-replies have `userid:"system00"`. |
| First customer message | First group whose `userid` is **not** `"system00"` and **not** in the agent list (from `GET /api/v3/agents`); within that group take the message where `type=="M"`. Strip HTML to plain text for analysis. |
| Rate limit | LA documents ~100 req/min. Implementation: 200ms delay between requests + exponential backoff on HTTP 429. |
| Charset | UTF-8, diakritika passes through correctly. |

Confirmed classification tag IDs in this tenant:

- `6vy2` = `0 - Zákaznícka podpora` → ZP
- `hp5o` = `0 - Technická podpora` → TP
- `24g7` = `0 - BUG/Incident` → BUG
- `v0bm` = `0 - URGENT BUG` → URGENT_BUG

## 5. Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Browser (vanilla JS, Chart.js)                          │
│   Setup · Download · Tag categorization · Dashboard     │
└──────────────────┬──────────────────────────────────────┘
                   │ JSON over HTTP (localhost:3001)
┌──────────────────▼──────────────────────────────────────┐
│ Express server                                          │
│  ┌────────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ la-client  │→ │ storage  │← │ analyzer │← │ rules  │ │
│  │ (paging,   │  │ (JSON    │  │ (kw,     │  │ (gen+  │ │
│  │  retry)    │  │  cache)  │  │  TF-IDF) │  │  score)│ │
│  └────────────┘  └──────────┘  └──────────┘  └────────┘ │
└─────────────────────────────────────────────────────────┘
```

Each module has a single concern and no cross-imports outside its layer.

## 6. File layout

```
la-evaluation/
├── package.json
├── .env.example
├── .gitignore
├── README.md
├── data/                           ← gitignored
│   ├── tickets-{timestamp}.json    ← cached download
│   ├── tag-categories.json         ← user's classification of tags
│   └── stopwords-sk.json           ← editable stop-word list
├── server/
│   ├── app.js                      ← Express bootstrap, routes
│   ├── la-client.js                ← LA API wrapper
│   ├── storage.js                  ← read/write JSON, latest-cache lookup
│   ├── text-utils.js               ← HTML strip, tokenize, stop-words
│   ├── analyzer.js                 ← keyword stats, TF-IDF, domain/customer agg
│   └── rule-generator.js           ← candidate rules + confidence/coverage
└── public/
    ├── index.html                  ← single-page UI with section panels
    ├── app.js                      ← fetch + render, Chart.js
    └── style.css
```

## 7. Data model

### 7.1 Cached ticket (after enrichment)

```json
{
  "id": "kin1vthj",
  "code": "WCP-QDQCZ-170",
  "subject": "otázočka",
  "date_created": "2026-04-27 13:48:27",
  "status": "N",
  "channel_type": "E",
  "owner": {
    "email": "novotna@temperance.sk",
    "name": "Monika Novotna",
    "domain": "temperance.sk"
  },
  "agentid": "93lqhv8s",
  "tag_ids": ["6vy2"],
  "tag_names": ["0 - Zákaznícka podpora"],
  "classification": "ZP",
  "first_customer_message": {
    "raw_html": "<...>",
    "plain_text": "Dobrý deň, chcem sa informovať..."
  }
}
```

### 7.2 Tag categorization (`data/tag-categories.json`)

```json
{
  "version": 1,
  "updated_at": "2026-04-27T...",
  "categories": {
    "6vy2": "classification",
    "hp5o": "classification",
    "24g7": "classification",
    "v0bm": "classification",
    "8byf": "internal",
    "y4f2": "ignored"
  }
}
```

Categories: `classification | client | topic | status | internal | ignored`. The 4 known classification tag IDs are auto-pre-filled.

### 7.3 Candidate rule

```json
{
  "id": "rule_001",
  "type": "keyword_subject | keyword_body | sender_domain | sender_email | combined",
  "human_readable": "Ak subject obsahuje 'nefunguje', klasifikuj ako BUG",
  "condition": { "field": "subject", "operator": "contains", "value": "nefunguje" },
  "action": { "classification": "BUG", "tag_to_add": "0 - BUG/Incident" },
  "stats": {
    "matches_total": 87,
    "coverage_percent": 4.2,
    "true_positives": 79,
    "false_positives": 8,
    "confidence_percent": 90.8
  },
  "examples": [{ "ticket_id": "abc", "subject": "...", "actual_classification": "BUG" }],
  "false_positive_examples": [{ "ticket_id": "xyz", "subject": "...", "actual_classification": "TP" }]
}
```

## 8. Functional flow

### 8.1 First-run setup (F1)

1. UI shows form: LA endpoint, API key (password input), test button.
2. Test button → `GET /api/v3/agents?_perPage=1` (works regardless of role; we already verified `/agents/me` 404s on this tenant). 200 → green; 401/403 → red with the exact API message.
3. Save → write `.env` via server. Reload state.

### 8.2 Download (F2)

1. User picks date range (default: last 180 days), max ticket safeguard (default 5000).
2. Before paging, fetch and cache the agent list once (`GET /api/v3/agents?_perPage=100`) — needed to identify customer messages.
3. Server pages through `/tickets` with date filter, 100 per page, 200ms delay, exponential backoff on 429.
4. For each ticket: skip if id is already in current cache (deduplication for restart-after-cancel).
5. After all listings done, fetch tags once and resolve `tag_ids → tag_names`.
6. For each ticket, fetch `/tickets/{id}/messages`, extract first customer message (using cached agent list to filter out agent groups), strip HTML.
7. Write `data/tickets-{timestamp}.json` (timestamp is ISO compact like `20260427T161500Z`). Update `data/latest.json` pointer with metadata: range, count, the cached agent map, and `tag_id_to_name` map.
8. Cache validity: 24h. Re-download offered before that only if user explicitly clicks.
9. UI: live progress (`stiahnutých X / pokračuje…`, no total), cancel button. On cancel the partial file is kept and re-runnable picks up via dedup.

### 8.3 Tag categorization (F3)

After download, dashboard prompts user to categorize any tag not yet in `tag-categories.json`. The 4 known classification tags are pre-filled. UI: list of unknown tags with usage counts and a select dropdown per row.

### 8.4 Analysis (F4) — runs in-memory, takes <2s for 3k tickets

Sections rendered:

- **A. Overview:** total, classification distribution (pie), trend per week (line), unclassified count.
- **B. Top keywords:** per classification, top 30 in subject and top 30 in body. **Differential score** uses log-likelihood ratio (Dunning's G²) — single most useful score for "this word is unusually frequent in BUG vs others". Sortable, with example tickets.
- **C. Top customers:** top 20 by ticket count, classification distribution per customer, flag those with >80% in one class as auto-routing candidates.
- **D. Top sender domains:** top 20 domains, classification distribution, auto-flag of public domains (gmail.com, outlook.com, …) for "typically end-customer = ZP" hint.
- **E. Candidate rules:** generated by rule-generator, see §9.
- **F. Edge cases:** sample of tickets uncovered by any high-confidence rule + sample of disagreements.

### 8.5 Rule generation algorithm (§E core)

Inputs: enriched tickets, tag categorization.

For each classification class C:

1. **Keyword rules:** for each unigram and bigram in top differential words (G² score above threshold) appearing in subject:
   - Rule: "if subject contains <token> → C"
   - Compute matches, true_positives, false_positives, coverage, confidence.
   - Keep if `confidence >= 70%` and `coverage >= 1%`.
2. **Body keyword rules:** same as above but on `first_customer_message.plain_text`. Lower coverage threshold (0.5%) since body is noisier.
3. **Sender domain rules:** for each domain D where ≥10 tickets and ≥80% are in class C:
   - Rule: "if sender domain is D → C"
4. **Sender email rules:** for each individual sender E with ≥5 tickets and ≥90% in class C.
5. **Combined rules (bonus):** subject keyword + sender domain — only if it materially raises confidence over either component alone (>5 pp gain).

Dedup: drop a rule if a more general rule covers a superset of its matches with comparable confidence.

Sort: by `coverage_percent DESC` (most impactful first), with confidence as tiebreaker.

### 8.6 Export (F5)

- **Markdown** export: human-readable list of rules with stats, ready to paste into a meeting doc.
- **JSON** export: machine-readable, structured per §7.3, ready as starting point for LA Rules import (manual transcription, since LA Rules engine isn't programmatic).
- **CSV** export of enriched tickets (id, subject, classification, sender_domain, agent, date) for ad-hoc analysis.

### 8.7 Re-analysis (F6)

When user changes tag categorization, server invalidates analysis cache and recomputes from already-downloaded tickets. No new API calls.

## 9. Text utilities

- **HTML strip:** strip tags via regex `/<[^>]+>/g`, then decode entities (`&nbsp;`, `&amp;`, etc.) via a small map. We don't need full DOM parsing — false negatives on edge cases are fine.
- **Tokenization:** lowercase → strip punctuation → split on whitespace → drop tokens shorter than 3 chars or longer than 30, drop pure numbers.
- **Slovak normalization:** keep diacritics (they distinguish meaning); do **not** lowercase-fold them away.
- **Stop-words:** load from `data/stopwords-sk.json`, seeded from the handoff list. User can edit the file; reanalysis re-reads it.
- **Subject prefix strip:** drop leading `Re:`, `Fwd:`, `Fw:` (case-insensitive) before tokenization.

## 10. Error handling

- LA API 401 → "API kľúč je neplatný"
- LA API 403 → "API kľúč nemá dostatočné práva pre tento endpoint"
- LA API 429 → backoff (1s → 2s → 4s → 8s, max 4 retries), then surface "Rate-limited, skúste neskôr"
- LA API 5xx → 1 retry then surface
- Network error → surface as "Nedostupné API, skontrolujte internet a endpoint"
- Empty response from `/messages` for a ticket → store ticket with `first_customer_message: null`, exclude from body keyword analysis but include everywhere else
- Corrupted cache file → log and treat as empty cache, do not crash

## 11. Out of scope (explicit non-goals)

- ML/LLM classification (the whole point is to show it isn't needed)
- Real-time integration / webhooks
- Auto-deploying rules back to LA (only export)
- Multi-tenant
- App-level auth (it's a localhost utility)
- Attachments, screenshots, sentiment analysis
- Resume from interrupted download (handled via re-run + dedup, not real resume)

## 12. Acceptance criteria

- [ ] `npm install && npm start` works on Windows; app at `http://localhost:3001`
- [ ] Setup screen tests connection via `/agents` and shows green/red with the actual error message
- [ ] Download of 1000–3000 tickets over 6 months completes without crash, with progress UI and cancel
- [ ] Cache is reused for 24h; cancel + re-run dedups by ticket id
- [ ] Tag categorization screen shows unknown tags with usage counts
- [ ] Dashboard sections A–F render with real data, charts visible
- [ ] Candidate rules show coverage + confidence and a "false positives" expand
- [ ] Markdown + JSON + CSV export buttons each produce a downloadable file
- [ ] Changing tag categorization triggers re-analysis without re-downloading
- [ ] README has setup, troubleshooting, list of LA endpoints used and the corrected filter syntax

## 13. Open questions / future work

- If `custom_fields` ever appear in this tenant, add a Section G "Custom field distribution" + rule type "field_X equals Y → class".
- LA Rules import format (programmatic): out of scope; if LA opens an import API, machine-readable export is already structured for it.
- Resume from cancel point with a true cursor: skipped; dedup via ticket id is good enough for the size we deal with.
