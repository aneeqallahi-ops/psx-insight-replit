# PSX Insight

## Overview

Pakistan Stock Exchange (PSX) market dashboard — a dark-themed financial terminal built on a pnpm monorepo with a Vite+React frontend and an Express API backend.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Frontend**: Vite + React + TypeScript + Tailwind v4 + Recharts + wouter + @tanstack/react-query
- **Backend**: Express 5 + TypeScript, bundled with esbuild
- **Data source**: `https://psxterminal.com` API (no API key required)
- **News scraping**: Mettis Global (`https://mettisglobal.news`) via cheerio
- **AI**: Anthropic Claude Sonnet 4.6 via Replit AI Integrations (no API key) — `@workspace/integrations-anthropic-ai`
- **Database**: Postgres (Drizzle ORM) — `portfolio_holdings`, `tax_profiles`, `agent_reports`, `notifications`, `notification_preferences`, `notification_cursors`. News still cached in `data/news/articles.json`.

## Artifacts

| Artifact | Port env | Preview path | Description |
|---|---|---|---|
| `artifacts/psx-insight` | `PORT` | `/` | Vite React frontend |
| `artifacts/api-server` | `PORT` (8080) | `/api` | Express API backend |

## Key Routes (API)

| Route | Description |
|---|---|
| `GET /api/market/status` | Market open/closed status |
| `GET /api/market/overview` | KSE-100 stats summary |
| `GET /api/market/sectors` | Sector breakdown |
| `GET /api/market/ticks?symbols=` | Bulk tick data from stats |
| `GET /api/markets?scope=kse100\|all` | Symbol list with mover data |
| `GET /api/markets/enrich?symbols=` | Fundamentals for visible rows |
| `GET /api/stock/detail?symbol=&timeframe=` | Full stock detail |
| `GET /api/stock/tick?symbol=` | Price from fundamentals |
| `GET /api/stock/klines?symbol=&timeframe=` | OHLCV klines |
| `GET /api/news/latest?limit=` | Scraped news from Mettis |
| `POST /api/agent/analyze/:symbol` | SSE-stream Buy/Hold/Sell verdict from 3 analysts + synthesizer (24h cache) |
| `POST /api/agent/portfolio-review` | AI portfolio review across all session holdings (7d cache, `?force=1` to bypass) |
| `GET /api/agent/daily-report` | Latest cached daily market briefing (auto-generated post 16:30 PKT) |
| `POST /api/agent/daily-report/refresh` | Force-regenerate today's daily briefing |
| `GET /api/notifications` | List session's portfolio alerts (newest first, with `unreadCount`) — needs `X-Portfolio-Key` |
| `POST /api/notifications/mark-read` | Mark notifications read by `ids[]` or `all=true` |
| `GET/PUT /api/notifications/preferences` | Per-session category filter, email opt-in, in-app toggle |
| `POST /api/notifications/poll-now` | Force the notifications scheduler to run immediately |

## Frontend Pages

| Route | Component | Description |
|---|---|---|
| `/` | `MarketDashboardPage` | Overview with stats, sectors, top movers |
| `/markets` | `MarketsPage` | Sortable/filterable symbol table |
| `/stock?symbol=` | `StockPage` | Stock detail with chart and fundamentals |
| `/watchlist` | `PortfolioPage` | Portfolio tracker with dividend/WHT calc |
| `/news` | `NewsPage` | Mettis news feed |
| `/analysis` | `AnalysisPage` | Daily AI market briefing (`<DailyReportView/>`) |
| `/events` | `EventsPage` | PSX corporate announcements (filter by symbol/category) |
| `/alerts` | `AlertsPage` | Portfolio-driven alerts inbox + preferences (category filter, email opt-in) |

## Theme Colors

- Canvas background: `#0d1117` (`bg-canvas`)
- Panel background: `#111827` (`bg-panel`)
- Border/line: `#263244` (`border-line`)
- Accent: `#22d3ee` (cyan-400)
- Gainers: emerald-300
- Losers: rose-300

## AI Analytics Agent (TradingAgents-style)

Three specialist analysts feed a synthesizer that issues a single verdict.

| Layer | Module | Output |
|---|---|---|
| Technical analyst | `lib/agent/analysts/technical.ts` | SMA20/50 + RSI(14) + MACD over 1d klines → `{summary, signals, confidence}` |
| Fundamental analyst | `lib/agent/analysts/fundamental.ts` | P/E, yield, dividends, sector, free float → `{summary, signals, confidence}` |
| News analyst | `lib/agent/analysts/news.ts` | Top 10 cached articles tagged with symbol → `{summary, signals, confidence}` |
| Synthesizer | `lib/agent/analysts/synthesizer.ts` | Streams JSON `{verdict: Buy\|Hold\|Sell, confidence, headline, rationale, citations}` |
| Portfolio review | `lib/agent/portfolio-review.ts` | Across all holdings: health score, per-position notes, risks, rebalance suggestions |
| Daily report | `lib/agent/daily-report.ts` | End-of-day briefing: top picks, sector rotation, breadth, macro/news take |
| Scheduler | `lib/agent/scheduler.ts` | Every 30 min on weekdays; auto-generates daily report after 16:30 Asia/Karachi |

## Portfolio Alerts (`lib/notifications/`)

- `scheduler.ts` ticks every 15 minutes (plus once at boot). For every distinct symbol across all `portfolio_holdings`, fetches `/api/announcements?symbol=…` page 1, classifies via shared `lib/announcement-classifier.ts`, and inserts a row into `notifications` for each watching session whose `notification_preferences` allow that category.
- A per-symbol `notification_cursors.last_announcement_id` watermark prevents resurfacing old items. First observation seeds the cursor without inserting (avoids backlog spam on cold start).
- Bell icon (`components/notification-bell.tsx`) lives in the header and shows unread count + recent items dropdown.
- Email delivery is best-effort via SendGrid (uses `SENDGRID_API_KEY`, `NOTIFY_FROM_EMAIL`, `NOTIFY_FROM_NAME` env vars). When unconfigured the alert is still stored in-app and a log line is emitted.

**Guardrails (`lib/agent/llm.ts`)**:
- Model: `claude-sonnet-4-6`, max_tokens 8192
- Per-attempt 60s timeout; `pRetry` 5x exponential backoff
- In-memory token bucket: 10 LLM calls / minute (clear error when exceeded)
- `extractJson()` tolerates ```fenced code or preamble``` around the JSON

**Caching (`agent_reports` table, scope/key UNIQUE)**:
- `stock` scope: keyed by `SYMBOL:YYYY-MM-DD` (PKT) — 24h TTL
- `portfolio` scope: keyed by `sessionId:hash(symbols+shares+avgPrice)` — 7d TTL (`?force=1` to bypass)
- `market` scope: keyed by `YYYY-MM-DD` (PKT) — 24h TTL; falls back to last 7 days when expired

## Known Limitations

- `dps.psx.com.pk` blocks server requests (DDoS protection — error 462) — KSE-100 constituent list is sourced from the sectors endpoint instead
- Individual stock ticks (`/api/ticks/REG/SYMBOL`) return a protocol error from psxterminal.com — price data uses fundamentals endpoint as fallback
- Mettis news scraping takes ~30-60s on first run (article-by-article with delays); subsequent requests use cache
- AI agent does not currently propagate `AbortController` into in-flight Anthropic calls when the SSE client disconnects mid-analysis — the analysts run to completion. This is acceptable for a single-user dashboard but would need cancellation wiring at scale.
- News content embedded into prompts is untrusted (scraped); no prompt-injection delimitation is applied. The synthesizer JSON schema still validates, but the surface exists.

## Design System (Terminal Brutalism)

- Dark canvas (`#0a0a0a`) + panel (`#0f0f0f`) with hairline coral grid (`#FF4F3A` @ 22% alpha).
- Fonts: **Anton** for display headlines (`.font-display`), **IBM Plex Mono** for body/labels.
- Section tags use the pattern `NNN //` + uppercase title, e.g. `001 // MARKET PULSE`.
- Cards use `clip-notch` (8px diagonal corner cut) on `border-line bg-panel`.
- Status timestamps render in PKT as `AS OF FRI 01 MAY 2026 · 16:30 PKT`.
- Live tape uses `.animate-marquee` (45s loop, paused under `prefers-reduced-motion`).
- Movers panel supports Today / 1W / 1M ranges via `GET /market/movers?range=...`. 1W/1M ranges are computed on demand from 1d klines for the union of today's top gainers + losers (no separate cached snapshot store) — intentional simplification, documented for future revisit.
- KSE-100 hero pulls close + day change + as-of timestamp from `GET /market/index`.
- Daily Briefing & Portfolio Review history sidebars filter by ALL/7D/30D + date picker.

## Key Commands

- `pnpm --filter @workspace/api-server run dev` — run API server
- `pnpm --filter @workspace/psx-insight run dev` — run frontend
- `pnpm run typecheck` — full typecheck across all packages
