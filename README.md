<p align="center">
  <img src="public/logo.svg" alt="DNA Studio" width="80" />
</p>

<h1 align="center">DNA Studio</h1>

<p align="center">
  <strong>Self-hosted AI marketing platform. Like Google Pomelli, but open source, model-agnostic, and actually ships to your social media.</strong>
</p>

<p align="center">
  <a href="#features">Features</a> &bull;
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#configuration">Configuration</a> &bull;
  <a href="#troubleshooting">Troubleshooting</a> &bull;
  <a href="#comparison">Comparison</a> &bull;
  <a href="#roadmap">Roadmap</a> &bull;
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <a href="https://github.com/moesaif/dna-studio/actions/workflows/ci.yml"><img src="https://github.com/moesaif/dna-studio/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome" />
  <img src="https://img.shields.io/badge/docker-ready-2496ED.svg" alt="Docker" />
</p>

---

## What is DNA Studio?

DNA Studio analyzes any website URL to extract a **Brand DNA** profile — colors, fonts, tone of voice, target audience, and industry — then uses AI to generate on-brand marketing content across all major social platforms.

**Paste a URL. Get a complete marketing campaign. Publish it.**

<!-- To add a demo GIF: upload it via a GitHub issue to get a CDN URL (max 10MB recommended) -->
<!-- ![DNA Studio Demo](https://github.com/user-attachments/assets/YOUR-ASSET-ID) -->

## Features

- **Brand DNA Extraction** — Paste any URL. Playwright crawls the site and extracts colors, fonts, tone, audience, industry, and more. AI analyzes the content for deeper insights.

- **Multi-Platform Campaign Generation** — Generate platform-specific content for Instagram, LinkedIn, Facebook, and X/Twitter. Each asset respects platform conventions (character limits, tone, hashtag strategy).

- **Model-Agnostic AI** — Switch between OpenAI (GPT-4o), Anthropic (Claude), Google Gemini, or local models via Ollama. One env var to change.

- **Direct Social Publishing** — Connect your social accounts via OAuth. Publish immediately or schedule posts for later via BullMQ job queue.

- **Multi-Language Support** — Generate campaigns in English, Spanish, French, Arabic, Chinese, Japanese, and more.

- **Self-Hosted** — One `docker compose up -d` and you're running. Your data stays on your infrastructure. No vendor lock-in. MIT licensed.

- **AI Photoshoot Studio** — Upload a product image, choose from 29 templates across 6 categories (General, Beauty, Fashion, Food, Home, Tech), and generate up to 4 styled product shots in parallel. Sessions are saved and browsable.

- **AI Image Generation** — Supports OpenAI DALL-E, Google Gemini native image generation, Stability AI, and Replicate Flux. Provider-agnostic — switch with one setting.

- **UGC Video Generation** — Pick a creator avatar, write or generate a script, and produce a short user-generated-content style video. Provider-agnostic across Google Veo, HeyGen, and D-ID.

- **Smart Campaign Suggestions** — AI analyzes your brand DNA and generates tailored campaign ideas. Cached per brand for instant load.

- **In-App Settings** — Configure AI providers, API keys, and image generation from the dashboard. No need to restart the server.

- **Streaming UX** — Real-time progress for brand analysis and content generation. See results as they're produced.

## Quick Start

### Docker (Recommended)

```bash
# Clone the repo
git clone https://github.com/moesaif/dna-studio.git
cd dna-studio

# Copy environment config
cp .env.example .env
# Edit .env with your API keys

# Launch everything
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000) and create your first brand.

### Local Development

```bash
# Prerequisites: Node 20+, PostgreSQL, Redis

# Install dependencies
npm install

# Set up database
cp .env.example .env.local
# Edit .env.local with your DATABASE_URL and API keys

npx prisma migrate dev

# Start dev server
npm run dev

# In another terminal, start the worker (for scheduled publishing)
npm run worker
```

## Configuration

All configuration is done via environment variables. See [`.env.example`](.env.example) for the full list.

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `REDIS_URL` | Redis connection string | Yes |
| `NEXTAUTH_SECRET` | Random secret for session encryption | Yes |
| `LLM_PROVIDER` | AI provider: `openai`, `anthropic`, `ollama`, `gemini` | Yes |
| `OPENAI_API_KEY` | OpenAI API key (if using OpenAI) | Conditional |
| `ANTHROPIC_API_KEY` | Anthropic API key (if using Anthropic) | Conditional |
| `GOOGLE_API_KEY` | Google API key (if using Gemini) | Conditional |
| `OLLAMA_BASE_URL` | Ollama server URL (if using local models) | Conditional |
| `IMAGE_PROVIDER` | Image generation: `openai`, `gemini`, `stability`, `replicate` | No (defaults to `openai`) |
| `VIDEO_PROVIDER` | UGC video generation: `veo`, `heygen`, `did` | No (defaults to `veo`) |

## Troubleshooting

### Is it running?

The app exposes a health endpoint, which the container healthcheck uses:

```bash
curl http://localhost:3000/api/health
# {"status":"ok","database":"reachable"}
```

`docker compose ps` reports the app as `healthy` only once it is serving
requests *and* can reach the database.

### The app container keeps restarting

Read the logs — the app prints the underlying Prisma error and exits, rather
than retrying a failure that cannot succeed:

```bash
docker compose logs app
```

Genuine "the database is not up yet" failures are retried (10 attempts, 5s
apart — tune with `MIGRATE_MAX_ATTEMPTS` and `MIGRATE_RETRY_DELAY`). Anything
else stops the container with the real error.

### `P3009: migrate found failed migrations in the target database`

A migration is recorded as failed, which blocks every migration after it.

Releases before this fix shipped a migration ordering bug ([#8](https://github.com/moesaif/dna-studio/issues/8))
that put **every** fresh install into this state, so if you tried DNA Studio
earlier and it never came up, this is why.

Inspect the history:

```bash
docker compose exec app node node_modules/prisma/build/index.js migrate status
```

Postgres rolls a failed migration back, so the failed entry almost always
represents no schema change at all. Clear it and let migrations run again:

```bash
docker compose exec app node node_modules/prisma/build/index.js \
  migrate resolve --rolled-back 20260317_add_settings_suggestions
docker compose restart app
```

If the database holds nothing you need, starting clean is simpler:

```bash
docker compose down -v && docker compose up -d
```

## Comparison

| Feature | DNA Studio | Google Pomelli | Canva AI |
|---------|:----------:|:--------------:|:--------:|
| Self-hosted | Yes | No | No |
| Model-agnostic | Yes | No | No |
| Brand DNA extraction | Yes | Yes | No |
| Multi-platform generation | Yes | Yes | Yes |
| Direct social publishing | Yes | No | Yes |
| Multi-language | Yes | No | Yes |
| Open source | Yes | No | No |
| Free tier | Yes (unlimited) | No | Limited |

## Tech Stack

- **Runtime**: Node.js 20+
- **Frontend**: Next.js 16 + React 19 + TypeScript 5 + Tailwind CSS v4 + Framer Motion
- **Backend**: Next.js API Routes + Prisma 6 ORM
- **Database**: PostgreSQL 16
- **Queue**: BullMQ + Redis 7
- **Web Scraping**: Playwright (headless Chromium)
- **AI**: Provider-agnostic — text (OpenAI, Anthropic, Gemini, Ollama), image (OpenAI, Gemini, Stability, Replicate), video (Veo, HeyGen, D-ID)
- **Auth**: NextAuth.js (credentials + Google OAuth)
- **Deployment**: Docker Compose

## Project Structure

```
dna-studio/
├── src/
│   ├── app/            # Next.js pages and API routes
│   ├── components/     # React components
│   └── lib/
│       ├── brand-dna/  # Brand DNA crawler and extractors
│       ├── llm/        # Unified LLM client + providers
│       ├── image/      # Image generation client + providers
│       ├── campaigns/  # Campaign generator and prompts
│       ├── settings/   # User settings resolution
│       ├── social/     # Social media API integrations
│       └── auth/       # NextAuth configuration
├── prisma/             # Database schema and migrations
├── workers/            # BullMQ background workers
├── docker/             # Container entrypoint (+ its tests)
├── docker-compose.yml  # One-command deployment
└── Dockerfile
```

## Roadmap

### Shipped in v0.1.0

- [x] Brand DNA extraction from any URL (colors, fonts, tone, audience, industry)
- [x] Multi-platform campaign generation (Instagram, LinkedIn, Facebook, X/Twitter)
- [x] Model-agnostic LLM support (OpenAI, Anthropic, Gemini, Ollama)
- [x] AI image generation (OpenAI DALL-E, Google Gemini, Stability AI, Replicate Flux)
- [x] AI Photoshoot — upload a product, pick templates, generate styled shots
- [x] Photoshoot persistence — sessions saved and browsable in gallery
- [x] Smart campaign suggestions — AI-generated, cached per brand
- [x] Settings UI — configure AI providers and API keys from the dashboard
- [x] Vision-powered product analysis — AI describes uploaded product images
- [x] Favicon-based brand logo fallback
- [x] Docker Compose one-command deployment
- [x] UGC video generation with creator avatars (Veo, HeyGen, D-ID)
- [x] Health endpoint (`/api/health`) and container healthcheck
- [x] CI on every pull request — migrations, entrypoint, build, and a full `docker compose` boot

### Up Next

- [ ] Test suite for the application code (providers, API routes, campaign generation)

- [ ] A/B testing for campaign variants
- [ ] Analytics dashboard (post performance tracking)
- [ ] Calendar view for scheduled posts
- [ ] Team collaboration (multi-user workspaces)
- [ ] Brand style guide PDF export
- [ ] Webhook integrations (Zapier, n8n)
- [ ] Chrome extension for one-click brand analysis
- [ ] Mobile app (React Native)

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, code style guidelines, and how to add new AI providers.

Quick start:

```bash
git clone https://github.com/YOUR_USERNAME/dna-studio.git
cd dna-studio && npm install
cp .env.example .env
npx prisma migrate dev
npm run dev
```

### Development Tips

- Run `npx prisma studio` to browse the database
- The LLM client supports hot-switching providers via the `LLM_PROVIDER` env var
- Use Ollama for free local development without API keys
- Brand DNA extraction works best on marketing/landing pages

## License

MIT License. See [LICENSE](LICENSE) for details.

---

<p align="center">
  Built with Next.js, Prisma, and a lot of AI. Star the repo if you find it useful.
</p>
