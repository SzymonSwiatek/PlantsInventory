# 10xPlantsInventory

An AI-vision plant cataloging app. Photograph your plants across multiple locations — home, office, garden plot — and an AI provider suggests the species and care details from the photo. The app then turns that catalog into actionable care work, scheduling watering and winterization reminders so plants don't get forgotten. You can also ask the AI to diagnose a sick plant from a photo.

Built as a ~3-week MVP. See [`context/foundation/prd.md`](context/foundation/prd.md) for the full product spec.

## Features

- **AI-assisted cataloging** — snap a photo, get a suggested species and care profile (watering cadence, sunlight, winterization) you can accept or edit before saving.
- **AI plant diagnosis** — a multi-turn chat that diagnoses a sick plant from a photo (`/ask`), with per-conversation cost ceilings on the AI provider.
- **Multi-location organization** — group plants by physical location and browse each location's collection.
- **Photo storage** — plant photos are uploaded to Supabase Storage via signed upload URLs.
- **Care reminders** — a daily scheduled worker computes which plants are due for watering or winterization and emails reminders.
- **Quick care actions** — mark a plant watered or winterized (with undo), or snooze a reminder, straight from the daily view.
- **Reminder preferences** — toggle reminder emails on or off in settings, with a signed one-click unsubscribe link in every email.
- **Passwordless auth** — magic-link sign-in via Supabase OTP (no passwords).

## Tech Stack

- [Astro](https://astro.build/) v6 — server-first rendering (`output: "server"`, every route SSR)
- [React](https://react.dev/) v19 — interactive islands only
- [TypeScript](https://www.typescriptlang.org/) v5 — strict, type-aware lint
- [Tailwind CSS](https://tailwindcss.com/) v4 — CSS-first via `@tailwindcss/vite` (no `tailwind.config`)
- [shadcn/ui](https://ui.shadcn.com/) — "new-york" style, `lucide-react` icons
- [Supabase](https://supabase.com/) — auth, Postgres (with RLS), and Storage
- [Resend](https://resend.com/) — transactional reminder emails
- [Cloudflare Workers](https://workers.cloudflare.com/) — edge deployment + scheduled (cron) triggers
- [Vitest](https://vitest.dev/) 3 + [Playwright](https://playwright.dev/) — unit/integration and E2E tests

## Prerequisites

- Node.js v22.14.0 (see `.nvmrc`)
- npm (comes with Node.js)
- [Docker](https://www.docker.com/) — only if you run Supabase locally

## Getting Started

1. Clone the repository:

```bash
git clone <your-fork-url>
cd 10xPlantsInventory
```

2. Install dependencies:

```bash
npm install
```

3. Set up Supabase and the environment variables — see [Configuration](#configuration) below.

4. Create local env files (the Node toolchain reads `.env`; the Cloudflare local runtime reads `.dev.vars`):

```bash
cp .env.example .env
cp .env.example .dev.vars
```

5. Run the development server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` — start the dev server (Cloudflare `workerd` runtime)
- `npm run build` — production SSR build via `@astrojs/cloudflare`
- `npm run preview` — preview the production build
- `npm run deploy` — build and deploy to Cloudflare Workers
- `npm run lint` / `npm run lint:fix` — ESLint with type-checked rules
- `npm run format` — Prettier (includes Astro + Tailwind plugins)
- `npm test` — Vitest in watch mode
- `npm run test:run` — Vitest once (CI)
- `npm run test:integration` — integration suite (`vitest.integration.config.ts`)
- `npm run test:e2e` — Playwright E2E tests
- `npx astro sync` — regenerate `astro:*` types (run after changing `astro.config.mjs` or content collections)

## Project Structure

```md
.
├── src/
│ ├── layouts/ # Astro layouts
│ ├── pages/ # Astro pages + routes (today, settings, ask, dashboard, ...)
│ │ ├── api/ # API endpoints (auth, locations, plants, AI suggest/diagnose, care actions, reminders, preferences)
│ │ ├── auth/ # Magic-link sign-in flow
│ │ ├── locations/ # Location detail + add-plant pages
│ │ └── plants/ # Plant detail page
│ ├── components/ # UI components (Astro & React islands) + shadcn/ui in ui/
│ ├── lib/ # Services & helpers (supabase, ai, reminders, storage, image, utils)
│ ├── db/ # Generated Supabase database types
│ ├── styles/ # Global Tailwind CSS
│ ├── middleware.ts # Resolves the user, guards PROTECTED_ROUTES
│ ├── worker.ts # Cloudflare Worker entry (HTTP + scheduled handler)
│ ├── types.ts # Shared types / DTOs
│ └── env.d.ts # Ambient types (incl. context.locals)
├── supabase/migrations/ # Schema + RLS + Storage bucket migrations
├── context/ # PRD, roadmap, and per-change planning docs
├── public/ # Static assets
└── wrangler.jsonc # Cloudflare Workers config (incl. cron triggers)
```

## Configuration

Environment variables are declared in `astro.config.mjs` via Astro's `astro:env` schema as **server-only secrets** — they are never exposed to the client and are imported only via `astro:env/server`. Every variable is optional, so the app boots (and degrades gracefully) even when unconfigured.

| Variable                    | Required for     | Description                                                 |
| --------------------------- | ---------------- | ----------------------------------------------------------- |
| `SUPABASE_URL`              | Auth & data      | Supabase project URL                                        |
| `SUPABASE_KEY`              | Auth & data      | Supabase `anon` public key                                  |
| `SUPABASE_SERVICE_ROLE_KEY` | Scheduled emails | Service-role key used by the reminder worker (bypasses RLS) |
| `AI_API_KEY`                | AI suggestions   | API key for the AI vision provider (Google Gemini)          |
| `RESEND_API_KEY`            | Reminder emails  | Resend API key for sending transactional emails             |
| `REMINDER_FROM_EMAIL`       | Reminder emails  | Verified `from` address for reminder emails                 |
| `REMINDER_UNSUBSCRIBE_SECRET` | Reminder emails | Secret for signing email unsubscribe links (`openssl rand -hex 32`) |
| `PUBLIC_SITE_URL`           | Email links      | Public base URL used to build links in reminder emails      |

### Supabase setup

This app uses Supabase for auth, the Postgres database, and photo storage. The core domain (`locations`, `plants`, `care_events`, and the `plant-photos` Storage bucket) is defined under `supabase/migrations/`, with row-level security enforcing per-user isolation.

**Local (no cloud project needed)** — requires Docker:

```bash
npx supabase start      # starts the local stack; prints credentials
npx supabase db reset   # applies migrations in supabase/migrations/
```

Copy the printed credentials into `.env` and `.dev.vars`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key from CLI output>
```

Local Studio is at `http://localhost:54323`. Stop the stack with `npx supabase stop`.

**Cloud project** — set `SUPABASE_URL` / `SUPABASE_KEY` from your project's Settings → API, then apply the migrations with `npx supabase db push`.

## Auth

Authentication is **passwordless magic-link** (Supabase OTP) — there is no password sign-in.

| Route               | Description                                                         |
| ------------------- | ------------------------------------------------------------------- |
| `/auth/signin`      | Enter your email to receive a magic link                            |
| `/auth/check-email` | "Check your inbox" confirmation page                                |
| `/auth/confirm`     | GET handler that verifies the magic-link token and sets the session |
| `/auth/signup`      | 308 redirect to `/auth/signin` (magic-link only)                    |

Route protection lives in `src/middleware.ts`: unauthenticated requests to any path in the `PROTECTED_ROUTES` array are redirected to `/auth/signin`. Add new protected paths there.

## Reminders

A Cloudflare cron trigger (`wrangler.jsonc`, daily at 18:00 UTC) invokes the Worker's scheduled handler, which computes plants due for watering or winterization and sends reminder emails via Resend. The scheduling logic lives in `src/lib/reminders/`.

Users can disable reminder emails from the settings page (`/api/preferences`), and every email carries a signed one-click unsubscribe link verified at `/api/reminders/unsubscribe` (signed with `REMINDER_UNSUBSCRIBE_SECRET`).

## Deployment

Deploys to [Cloudflare Workers](https://workers.cloudflare.com/) (entry: `src/worker.ts`).

```bash
npm run deploy        # astro build && wrangler deploy
```

Set the production secrets in Cloudflare via `npx wrangler secret put <NAME>` (or the dashboard) for each variable in the [Configuration](#configuration) table.

## CI

GitHub Actions runs `astro sync`, lint, and build on every push and PR to `main`. Configure the required secrets as repository secrets for the build step.

## License

MIT
