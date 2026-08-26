# Settings redesign

**Date:** 2026-08-26
**Status:** Approved, ready for implementation planning

## Problem

Settings is one 352-line page at `/settings/connections` rendering a 1714px
scroll. Four concrete problems, in the order a user meets them:

1. **It opens with four things you cannot use.** Social Connections occupies the
   first ~450px and every entry is `Coming Soon`. The setting that makes the app
   work at all — AI provider and key — is below the fold.

2. **Video generation is unreachable from the UI.** `resolveSettings` reads
   `videoProvider` and `videoApiKey`, but the settings page has zero mentions of
   video and `PUT /api/settings` rebuilds the stored object from six hardcoded
   fields that exclude them. UGC Studio is advertised in the sidebar and can only
   be configured through environment variables. Nothing writes those fields
   today, so no data is being lost — they are simply unreachable.

3. **Configured and unconfigured look identical.** With keys in `.env`, the input
   renders empty beneath "Leave blank to use environment variable fallback" — a
   claim the UI cannot verify, because `GET /api/settings` returns only saved
   user settings and knows nothing about the environment.

4. **A bad key surfaces late.** There is no validation; you discover a wrong key
   as a failed campaign generation somewhere else in the app.

### Root cause of (2)

Provider metadata is hardcoded in seven places: the settings page,
`src/lib/settings/resolve.ts`, the three provider clients (`llm`, `image`,
`video`), `.env.example`, and `docker-compose.yml`. Video was added to
`resolve.ts` and the video client, and the settings page — the fourth copy — was
never updated. The next provider will go missing the same way.

## Goals

- Make the settings that matter reachable and legible.
- Make video generation configurable from the UI.
- Tell the user what is configured and where it came from.
- Let a key be verified before it is relied on.
- Stop provider metadata multiplying, at least across the user-facing surface.
- Give the account details a UI at all — name, email and password exist on the
  `User` model with no way to change any of them.

## Non-goals

- Restyling. Palette, typography and card language stay as they are; this is a
  restructure.
- Per-provider model dropdowns. Model override remains an environment concern.
- Usage or cost reporting. Nothing tracks that today.
- Email verification. The project has no mail transport and adding one is its
  own project. `User.emailVerified` stays unused.
- Rewiring `resolve.ts` or the provider clients to read from the registry. That
  is the right end state but turns a settings change into a core-library change;
  it is a follow-up once the registry has proven itself.
- Component tests for the new pages, consistent with the current coverage gate
  scoped to `src/lib` and `src/app/api`.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Navigation | Sub-routes | Deep-linkable, each page loads only its own data, retires the odd `/settings/connections` URL for the whole page |
| Sections | Providers, Connections, Account | Account has no UI today; adding it while restructuring is cheaper than a second pass |
| Provider metadata | Registry for the settings surface only | Fixes duplication where it caused the bug, without touching load-bearing clients |
| Config transparency | Report source, and allow testing | The two complaints that cost users real time |
| Account guards | Current password for email and password changes | Standard guard against a hijacked session taking over the account |

## Routes and navigation

```
src/app/settings/
  layout.tsx            shared sub-nav + heading chrome
  providers/page.tsx    AI / image / video configuration
  connections/page.tsx  social accounts (moved, largely unchanged)
  account/page.tsx      name, email, password
  page.tsx              redirect -> /settings/providers
```

- The sidebar's Settings link changes from `/settings/connections` to
  `/settings/providers` — the page that actually does something.
- `/settings` redirects to `/settings/providers`.
- `/settings/connections` keeps working at its existing URL, so bookmarks and
  any external links survive. Its content moves into the new layout.

## Provider registry

One entry per provider in `src/lib/providers/registry.ts`:

```ts
export type ProviderKind = "llm" | "image" | "video";

export interface ProviderDef {
  id: string;                    // "openai"
  kind: ProviderKind;            // which section it renders in
  label: string;                 // "OpenAI"
  modelLabel: string;            // "GPT-4o" — display only
  credential: {
    field: "llmApiKey" | "imageApiKey" | "videoApiKey" | "ollamaUrl";
    type: "apiKey" | "url";      // url swaps the input and the test semantics
    envVar?: string;             // "OPENAI_API_KEY" — reported as the source
    placeholder: string;
  };
  test(credential: string): Promise<void>;  // cheap read-only call; throws a human message
}

export const PROVIDERS: ProviderDef[];
export function providersOfKind(kind: ProviderKind): ProviderDef[];
export function findProvider(kind: ProviderKind, id: string): ProviderDef | undefined;
```

`test` is a function per entry rather than a declarative HTTP shape: verifying
OpenAI is `GET /v1/models`, Stability is a different endpoint, and Ollama is
"is the server reachable". Three short functions beat a config language that
has to express all of them.

Entries required at implementation time, matching what the clients already
support:

- **llm** — openai, anthropic, gemini, ollama
- **image** — openai, stability, gemini, replicate
- **video** — veo, heygen, did

## Page anatomy

Each of the three provider sections renders identically from its registry
entries:

- A chip grid of the providers of that kind, one selected.
- A credential row: input plus a **Test** button.
- A status line, one of:
  - `✓ saved here` — a user-supplied value is stored
  - `✓ from your environment (OPENAI_API_KEY)` — no stored value, env resolves
  - `⚠ Not configured — <feature> will fail until this is set`
- Section headings name the job, not the jargon: "TEXT — campaigns, scripts,
  brand analysis", "IMAGES — photoshoot, campaign visuals", "VIDEO — UGC Studio".
- Where two sections resolve from the same environment variable — image and text
  both on OpenAI, say — the status line names that variable in both, rather than
  presenting a second unexplained "OpenAI API Key". Note the actual rule, which
  the UI must not overstate: an unset `imageApiKey` falls back to
  `OPENAI_API_KEY` in the environment, **not** to a key the user saved for text.
  Saving a text key in settings does not populate image. The status line
  therefore reports the environment variable, never "uses your text key".
- Ollama renders a base-URL field instead of a key field, driven by
  `credential.type`.
- A sticky save bar appears only when the form is dirty.

## API surface

### `GET /api/settings` (changed)

Returns the existing masked settings plus a `sources` map, keyed by credential
field:

```ts
{
  settings: UserSettings,          // unchanged, keys masked
  sources: {
    llmApiKey:   { source: "user" | "env" | "none", envVar?: string, masked?: string },
    imageApiKey: { ... },
    videoApiKey: { ... },
    ollamaUrl:   { ... },
  }
}
```

Raw keys are never returned. The existing test asserting keys never come back in
the clear continues to guard this.

`sources` must be derived from the same code path as `resolveSettings`, not a
parallel reimplementation of the fallback rules — otherwise the UI becomes an
eighth copy of the provider metadata and can drift into telling the user
something the resolver would not do. Extract the per-field resolution into a
helper (`resolveCredential(field, userSettings, env)` returning value plus
origin) and have both `resolveSettings` and this endpoint call it. This is the
one place the registry work does touch `resolve.ts`, and it is a pure
extraction: existing behaviour and its tests are unchanged.

### `PUT /api/settings` (changed)

Stops rebuilding the stored object from six hardcoded fields; merges a
zod-validated partial over what is stored. This is the fix for problem (2) —
any field outside that list of six is unreachable by construction today.

The masked-placeholder rule is preserved exactly: a submitted value containing
the mask marker does not overwrite the stored key. There is already a test
pinning this behaviour.

### `POST /api/settings/providers/test` (new)

```ts
Request:  { kind: ProviderKind, providerId: string, credential?: string }
Response: { ok: true } | { ok: false, message: string }
```

Omitting `credential` tests whatever currently resolves for that provider — so
an environment key can be verified without retyping it. The credential is never
echoed in the response and never logged.

Guarded by a per-user cooldown held in memory: **one test per user per 3
seconds, and at most 20 per hour**, answering 429 with the seconds remaining.
The endpoint makes authenticated outbound calls with user-supplied credentials;
without a throttle it is a free proxy for probing keys against four vendors.
In-memory is sufficient at this scale — no new dependency, no Redis. The
counters reset on restart, which is acceptable: this bounds abuse, it is not an
audit control.

### `GET`/`PATCH /api/account` (new)

`PATCH` accepts `{ name?, email?, currentPassword? }`. Changing `name` alone
needs no password. Changing `email` requires `currentPassword`, and returns 409
if the address is taken.

### `POST /api/account/password` (new)

`{ currentPassword?, newPassword }`. `currentPassword` is required and verified
with bcrypt when the account has one. Accounts created through Google have
`password: null` and get a "set a password" flow with no current-password step:
there is no password to prove, and an authenticated session can already do
everything that account can do, so this is not an escalation. New passwords are
hashed at 12 rounds, matching registration.

## Error handling

- Provider test failures map to human messages — invalid key, network
  unreachable, rate limited — never a raw provider error body.
- Validation failures answer 400 with the field at fault, matching the seven
  routes that already use zod.
- Account guard failures answer 401 for a wrong current password and 409 for a
  taken email, distinct from the 400 used for malformed input.
- Every new route follows the existing shape: 401 when signed out, 500 without
  leaking the underlying error.

## Testing

Following the existing suite's patterns:

- **Registry** — every entry's `envVar` appears in `.env.example`; ids unique
  per kind; every kind has at least one entry. The first of these is the check
  that would have caught video going missing.
- **`PUT /api/settings`** — merge semantics: a field outside the old six
  survives a round trip; the masked-placeholder rule still holds.
- **`GET /api/settings`** — `sources` reports `user`, `env` and `none`
  correctly; no raw key in the payload under any branch.
- **Test endpoint** — success, provider failure mapped to a message, unknown
  provider rejected, cooldown enforced, credential absent from response.
- **Account routes** — happy path, wrong current password, taken email,
  `password: null` set-a-password path, signed-out.

Coverage thresholds stay at 80% for `src/lib` and `src/app/api`; the new
registry and routes fall inside that scope.

## Compatibility

- `/settings/connections` keeps working.
- Stored settings need no migration — `PUT` becomes a merge, so existing
  documents are read and written unchanged.
- No schema change. `User` already carries name, email and password.
- Environment variables keep their current precedence: a value saved in
  settings overrides the environment, exactly as `resolveSettings` behaves now.
