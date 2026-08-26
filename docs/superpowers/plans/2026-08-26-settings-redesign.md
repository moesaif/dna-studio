# Settings Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure Settings into Providers / Connections / Account sub-routes, make video generation configurable, show where each credential resolves from, and let a key be tested before it is relied on.

**Architecture:** A provider registry (`src/lib/providers/registry.ts`) becomes the single source of user-facing provider metadata. `resolveSettings` gains an extracted `resolveCredential` helper that both it and the settings API use, so the UI can never claim a resolution the resolver would not perform. Three sub-route pages render from the registry under a shared settings layout.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind v4, Prisma 6, Zod 4, Vitest 4, bcryptjs.

**Spec:** `docs/superpowers/specs/2026-08-26-settings-redesign-design.md`

## Global Constraints

- Tests live in `tests/`, mirroring `src/`. Vitest, node environment, `npm test`.
- Coverage gate: 80% lines/statements/branches/functions over `src/lib/**` and `src/app/api/**` (`vitest.config.mts`). New code falls inside it.
- `beforeEach(() => mock.mockResolvedValue(x))` is forbidden — the arrow returns the mock and Vitest treats a returned function as a teardown callback. Always use a block body.
- API routes follow the existing shape: 401 when signed out, 400 on Zod failure, 500 without leaking the underlying error.
- Raw API keys are never returned by any endpoint, never logged, never echoed in an error.
- Masking is `first4 + "••••" + last4`, or `"••••"` for values of 8 characters or fewer. A submitted value containing `••••` must not overwrite a stored key.
- Registry `test()` functions use `fetch` only — no SDK imports. `resolve.ts` imports the registry, and pulling four AI SDKs into the resolver's import graph is unacceptable.
- Palette, typography and card language are unchanged. This is a restructure, not a restyle.
- Do not modify `src/lib/llm/client.ts`, `src/lib/image/client.ts`, or `src/lib/video/client.ts`. Their provider switches stay as they are (spec non-goal).

## Spec deviation resolved during planning

The spec sketches `resolveCredential(field, userSettings, env)`. That signature is insufficient: the environment variable backing `llmApiKey` depends on which provider is selected (`OPENAI_API_KEY` vs `ANTHROPIC_API_KEY` vs `GOOGLE_API_KEY`). The helper therefore takes the provider id as well, and reads the variable name from the registry:

```ts
resolveCredential(field, providerId, userSettings, env)
```

Consequence: `src/lib/settings/resolve.ts` imports `src/lib/providers/registry.ts`. This is intentional and bounded — the registry becomes the single source for **environment variable names** only. Provider defaults and model defaults stay in `resolve.ts` exactly as they are.

## File Structure

**Create**
- `src/lib/providers/registry.ts` — provider metadata + per-provider `test()`
- `src/lib/providers/cooldown.ts` — in-memory per-user throttle
- `src/app/api/settings/providers/test/route.ts` — POST test endpoint
- `src/app/api/account/route.ts` — GET/PATCH name + email
- `src/app/api/account/password/route.ts` — POST set/change password
- `src/app/settings/layout.tsx` — sub-nav chrome
- `src/app/settings/page.tsx` — redirect to `/settings/providers`
- `src/app/settings/providers/page.tsx`
- `src/app/settings/account/page.tsx`
- `src/components/settings/provider-section.tsx` — one registry-driven section
- `src/components/settings/settings-nav.tsx`

**Modify**
- `src/lib/settings/resolve.ts` — extract `resolveCredential`
- `src/app/api/settings/route.ts` — GET returns `sources`; PUT merges
- `src/app/settings/connections/page.tsx` — strip its own header/shell, keep connections only
- `src/components/layout/sidebar.tsx:75` — Settings href → `/settings/providers`
- `CONTRIBUTING.md` — adding a provider now includes a registry entry

---

### Task 1: Provider registry

**Files:**
- Create: `src/lib/providers/registry.ts`
- Test: `tests/lib/providers/registry.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type ProviderKind = "llm" | "image" | "video"`
  - `type CredentialField = "llmApiKey" | "imageApiKey" | "videoApiKey" | "ollamaUrl"`
  - `interface ProviderDef { id, kind, label, modelLabel, credential: { field, type, envVar?, placeholder }, test(credential: string): Promise<void> }`
  - `const PROVIDERS: ProviderDef[]`
  - `providersOfKind(kind): ProviderDef[]`
  - `findProvider(kind, id): ProviderDef | undefined`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/providers/registry.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROVIDERS, providersOfKind, findProvider } from "@/lib/providers/registry";

describe("provider registry", () => {
  it("covers every provider the clients support", () => {
    expect(providersOfKind("llm").map((p) => p.id).sort()).toEqual(
      ["anthropic", "gemini", "ollama", "openai"]
    );
    expect(providersOfKind("image").map((p) => p.id).sort()).toEqual(
      ["gemini", "openai", "replicate", "stability"]
    );
    expect(providersOfKind("video").map((p) => p.id).sort()).toEqual(
      ["did", "heygen", "veo"]
    );
  });

  it("gives every provider an id unique within its kind", () => {
    for (const kind of ["llm", "image", "video"] as const) {
      const ids = providersOfKind(kind).map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  // This is the check that would have caught video generation going missing.
  it("documents every environment variable it references in .env.example", () => {
    const envExample = readFileSync(".env.example", "utf8");
    const missing = PROVIDERS
      .map((p) => p.credential.envVar)
      .filter((v): v is string => Boolean(v))
      .filter((v) => !envExample.includes(v));
    expect(missing).toEqual([]);
  });

  it("routes each kind to its own settings field", () => {
    expect(providersOfKind("image").every((p) => p.credential.field === "imageApiKey")).toBe(true);
    expect(providersOfKind("video").every((p) => p.credential.field === "videoApiKey")).toBe(true);
  });

  it("gives ollama a url credential and no api key", () => {
    const ollama = findProvider("llm", "ollama")!;
    expect(ollama.credential.type).toBe("url");
    expect(ollama.credential.field).toBe("ollamaUrl");
    expect(ollama.credential.envVar).toBe("OLLAMA_BASE_URL");
  });

  it("returns undefined for an unknown provider", () => {
    expect(findProvider("llm", "hal9000")).toBeUndefined();
  });

  it("gives every provider a label, model label and placeholder", () => {
    for (const p of PROVIDERS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.modelLabel.length).toBeGreaterThan(0);
      expect(p.credential.placeholder.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/providers/registry.test.ts`
Expected: FAIL — cannot resolve `@/lib/providers/registry`

- [ ] **Step 3: Write the registry**

```ts
// src/lib/providers/registry.ts
export type ProviderKind = "llm" | "image" | "video";

export type CredentialField =
  | "llmApiKey"
  | "imageApiKey"
  | "videoApiKey"
  | "ollamaUrl";

export interface ProviderDef {
  id: string;
  kind: ProviderKind;
  label: string;
  modelLabel: string;
  credential: {
    field: CredentialField;
    type: "apiKey" | "url";
    envVar?: string;
    placeholder: string;
  };
  /** Cheap read-only call. Resolves if the credential works, throws a human message if not. */
  test(credential: string): Promise<void>;
}

/** Turns a fetch response into the message a user should read. */
async function assertOk(res: Response, provider: string): Promise<void> {
  if (res.ok) return;
  if (res.status === 401 || res.status === 403) {
    throw new Error(`${provider} rejected that key.`);
  }
  if (res.status === 429) {
    throw new Error(`${provider} is rate limiting this key right now.`);
  }
  throw new Error(`${provider} answered ${res.status}.`);
}

async function getWithHeaders(
  url: string,
  headers: Record<string, string>,
  provider: string
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch {
    throw new Error(`Could not reach ${provider}.`);
  }
  await assertOk(res, provider);
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: "openai",
    kind: "llm",
    label: "OpenAI",
    modelLabel: "GPT-4o",
    credential: { field: "llmApiKey", type: "apiKey", envVar: "OPENAI_API_KEY", placeholder: "sk-..." },
    test: (key) => getWithHeaders("https://api.openai.com/v1/models", { Authorization: `Bearer ${key}` }, "OpenAI"),
  },
  {
    id: "anthropic",
    kind: "llm",
    label: "Anthropic",
    modelLabel: "Claude Sonnet",
    credential: { field: "llmApiKey", type: "apiKey", envVar: "ANTHROPIC_API_KEY", placeholder: "sk-ant-..." },
    test: (key) =>
      getWithHeaders("https://api.anthropic.com/v1/models", { "x-api-key": key, "anthropic-version": "2023-06-01" }, "Anthropic"),
  },
  {
    id: "gemini",
    kind: "llm",
    label: "Google Gemini",
    modelLabel: "Gemini 2.0 Flash",
    credential: { field: "llmApiKey", type: "apiKey", envVar: "GOOGLE_API_KEY", placeholder: "AIza..." },
    test: (key) =>
      getWithHeaders("https://generativelanguage.googleapis.com/v1beta/models", { "x-goog-api-key": key }, "Google Gemini"),
  },
  {
    id: "ollama",
    kind: "llm",
    label: "Ollama",
    modelLabel: "Llama 3.1 · local",
    credential: { field: "ollamaUrl", type: "url", envVar: "OLLAMA_BASE_URL", placeholder: "http://localhost:11434" },
    test: (url) => getWithHeaders(`${url.replace(/\/$/, "")}/api/tags`, {}, "Ollama"),
  },
  {
    id: "openai",
    kind: "image",
    label: "OpenAI",
    modelLabel: "DALL·E 3",
    credential: { field: "imageApiKey", type: "apiKey", envVar: "OPENAI_API_KEY", placeholder: "sk-..." },
    test: (key) => getWithHeaders("https://api.openai.com/v1/models", { Authorization: `Bearer ${key}` }, "OpenAI"),
  },
  {
    id: "stability",
    kind: "image",
    label: "Stability AI",
    modelLabel: "Stable Diffusion 3.5",
    credential: { field: "imageApiKey", type: "apiKey", envVar: "STABILITY_API_KEY", placeholder: "sk-..." },
    test: (key) => getWithHeaders("https://api.stability.ai/v1/user/account", { Authorization: `Bearer ${key}` }, "Stability AI"),
  },
  {
    id: "gemini",
    kind: "image",
    label: "Google Gemini",
    modelLabel: "Native image generation",
    credential: { field: "imageApiKey", type: "apiKey", envVar: "GOOGLE_API_KEY", placeholder: "AIza..." },
    test: (key) =>
      getWithHeaders("https://generativelanguage.googleapis.com/v1beta/models", { "x-goog-api-key": key }, "Google Gemini"),
  },
  {
    id: "replicate",
    kind: "image",
    label: "Replicate",
    modelLabel: "Flux Schnell",
    credential: { field: "imageApiKey", type: "apiKey", envVar: "REPLICATE_API_TOKEN", placeholder: "r8_..." },
    test: (key) => getWithHeaders("https://api.replicate.com/v1/account", { Authorization: `Token ${key}` }, "Replicate"),
  },
  {
    id: "veo",
    kind: "video",
    label: "Google Veo",
    modelLabel: "veo-3.1",
    credential: { field: "videoApiKey", type: "apiKey", envVar: "GOOGLE_API_KEY", placeholder: "AIza..." },
    test: (key) =>
      getWithHeaders("https://generativelanguage.googleapis.com/v1beta/models", { "x-goog-api-key": key }, "Google Veo"),
  },
  {
    id: "heygen",
    kind: "video",
    label: "HeyGen",
    modelLabel: "Avatars",
    credential: { field: "videoApiKey", type: "apiKey", envVar: "HEYGEN_API_KEY", placeholder: "Your HeyGen key" },
    test: (key) => getWithHeaders("https://api.heygen.com/v2/avatars", { "X-Api-Key": key }, "HeyGen"),
  },
  {
    id: "did",
    kind: "video",
    label: "D-ID",
    modelLabel: "Presenters",
    credential: { field: "videoApiKey", type: "apiKey", envVar: "DID_API_KEY", placeholder: "Your D-ID key" },
    test: (key) => getWithHeaders("https://api.d-id.com/clips/presenters", { Authorization: `Basic ${key}` }, "D-ID"),
  },
];

export function providersOfKind(kind: ProviderKind): ProviderDef[] {
  return PROVIDERS.filter((p) => p.kind === kind);
}

export function findProvider(kind: ProviderKind, id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.kind === kind && p.id === id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/lib/providers/registry.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 5: Add tests for the test() functions**

```ts
// append to tests/lib/providers/registry.test.ts
import { beforeEach, vi } from "vitest";

describe("provider test()", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  it("resolves when the provider accepts the key", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await expect(findProvider("llm", "openai")!.test("sk-good")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      { headers: { Authorization: "Bearer sk-good" } }
    );
  });

  it.each([
    [401, /rejected that key/],
    [403, /rejected that key/],
    [429, /rate limiting/],
    [500, /answered 500/],
  ])("maps status %i to a human message", async (status, pattern) => {
    fetchMock.mockResolvedValue({ ok: false, status });
    await expect(findProvider("llm", "openai")!.test("sk-bad")).rejects.toThrow(pattern);
  });

  it("reports an unreachable host rather than a raw network error", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(findProvider("llm", "ollama")!.test("http://nope:11434")).rejects.toThrow(
      "Could not reach Ollama."
    );
  });

  it("never puts the credential in the thrown message", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    const err = await findProvider("llm", "openai")!.test("sk-supersecret").catch((e: Error) => e.message);
    expect(err).not.toContain("sk-supersecret");
  });

  it("normalises a trailing slash on the ollama url", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await findProvider("llm", "ollama")!.test("http://localhost:11434/");
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:11434/api/tags", { headers: {} });
  });
});
```

- [ ] **Step 6: Run and verify**

Run: `npm test -- tests/lib/providers/registry.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/providers/registry.ts tests/lib/providers/registry.test.ts
git commit -m "feat: add a provider registry for the settings surface"
```

---

### Task 2: Extract resolveCredential

**Files:**
- Modify: `src/lib/settings/resolve.ts`
- Test: `tests/lib/settings/resolve-credential.test.ts`

**Interfaces:**
- Consumes: `findProvider`, `CredentialField` from Task 1
- Produces:
  - `type CredentialOrigin = "user" | "env" | "none"`
  - `interface ResolvedCredential { value: string; origin: CredentialOrigin; envVar?: string }`
  - `export function resolveCredential(field: CredentialField, providerId: string, userSettings: UserSettings, env?: NodeJS.ProcessEnv): ResolvedCredential`
  - `export type { UserSettings }` (was private)

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/settings/resolve-credential.test.ts
import { describe, expect, it } from "vitest";
import { resolveCredential } from "@/lib/settings/resolve";

describe("resolveCredential", () => {
  it("prefers a value the user saved", () => {
    expect(resolveCredential("llmApiKey", "openai", { llmApiKey: "sk-user" }, { OPENAI_API_KEY: "sk-env" }))
      .toEqual({ value: "sk-user", origin: "user", envVar: "OPENAI_API_KEY" });
  });

  it("falls back to the provider's own environment variable", () => {
    expect(resolveCredential("llmApiKey", "anthropic", {}, { ANTHROPIC_API_KEY: "sk-ant" }))
      .toEqual({ value: "sk-ant", origin: "env", envVar: "ANTHROPIC_API_KEY" });
  });

  it("does not borrow another provider's key", () => {
    expect(resolveCredential("llmApiKey", "anthropic", {}, { OPENAI_API_KEY: "sk-openai" }).origin)
      .toBe("none");
  });

  // The rule the UI must not overstate: image does NOT inherit a saved text key.
  it("does not inherit a saved llm key into the image field", () => {
    expect(resolveCredential("imageApiKey", "openai", { llmApiKey: "sk-user-text" }, {}).origin)
      .toBe("none");
  });

  it("does inherit the shared env var when both providers use it", () => {
    expect(resolveCredential("imageApiKey", "openai", {}, { OPENAI_API_KEY: "sk-env" }))
      .toEqual({ value: "sk-env", origin: "env", envVar: "OPENAI_API_KEY" });
  });

  it("reports none when nothing is configured", () => {
    expect(resolveCredential("videoApiKey", "heygen", {}, {}))
      .toEqual({ value: "", origin: "none", envVar: "HEYGEN_API_KEY" });
  });

  it("resolves the ollama url like any other credential", () => {
    expect(resolveCredential("ollamaUrl", "ollama", {}, { OLLAMA_BASE_URL: "http://ollama:11434" }))
      .toEqual({ value: "http://ollama:11434", origin: "env", envVar: "OLLAMA_BASE_URL" });
  });

  it("reports none for an unknown provider rather than throwing", () => {
    expect(resolveCredential("llmApiKey", "hal9000", {}, {}).origin).toBe("none");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/settings/resolve-credential.test.ts`
Expected: FAIL — `resolveCredential is not a function`

- [ ] **Step 3: Add the helper to resolve.ts**

Add near the top of `src/lib/settings/resolve.ts`, after the existing imports:

```ts
import { findProvider, type CredentialField, type ProviderKind } from "@/lib/providers/registry";

export type CredentialOrigin = "user" | "env" | "none";

export interface ResolvedCredential {
  value: string;
  origin: CredentialOrigin;
  envVar?: string;
}

const KIND_OF_FIELD: Record<CredentialField, ProviderKind> = {
  llmApiKey: "llm",
  ollamaUrl: "llm",
  imageApiKey: "image",
  videoApiKey: "video",
};

/**
 * Resolve one credential the way the app actually consumes it: a value saved
 * in settings wins, otherwise the environment variable that backs the selected
 * provider. Never borrows another provider's key.
 */
export function resolveCredential(
  field: CredentialField,
  providerId: string,
  userSettings: UserSettings,
  env: NodeJS.ProcessEnv = process.env
): ResolvedCredential {
  const provider = findProvider(KIND_OF_FIELD[field], providerId);
  const envVar = provider?.credential.envVar;

  const saved = userSettings[field];
  if (saved) return { value: saved, origin: "user", envVar };

  const fromEnv = envVar ? env[envVar] : undefined;
  if (fromEnv) return { value: fromEnv, origin: "env", envVar };

  return { value: "", origin: "none", envVar };
}
```

Also change `interface UserSettings` to `export interface UserSettings` on the same file.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/lib/settings/resolve-credential.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 5: Verify the existing resolver still passes**

Run: `npm test -- tests/lib/settings/resolve.test.ts`
Expected: PASS, 16 tests

- [ ] **Step 6: Make `resolveSettings` use the helper**

The spec requires one code path, not two implementations of the same rule — leaving both is the drift this work exists to remove. Replace the three credential switch blocks in `resolveSettings` with calls to the helper. The 16 tests from Step 5 are the proof that behaviour did not change; do not edit them.

```ts
// inside resolveSettings, replacing the llmApiKey switch
const llmApiKey = resolveCredential("llmApiKey", llmProvider, userSettings).value;

// replacing the imageApiKey switch
const imageApiKey = resolveCredential("imageApiKey", imageProvider, userSettings).value;

// replacing the videoApiKey switch
const videoApiKey = resolveCredential("videoApiKey", videoProvider, userSettings).value;

// replacing the ollamaUrl fallback chain
const ollamaUrl =
  resolveCredential("ollamaUrl", "ollama", userSettings).value || "http://localhost:11434";
```

Provider defaults (`userSettings.llmProvider || process.env.LLM_PROVIDER || "openai"`) and the model defaults stay exactly as they are — the helper covers credentials only.

- [ ] **Step 7: Run both suites to prove behaviour is unchanged**

Run: `npm test -- tests/lib/settings`
Expected: PASS — all 16 original `resolveSettings` tests plus the 8 new helper tests

- [ ] **Step 8: Commit**

```bash
git add src/lib/settings/resolve.ts tests/lib/settings/resolve-credential.test.ts
git commit -m "feat: extract resolveCredential so the API and resolver share one rule"
```

---

### Task 3: GET reports sources, PUT merges

**Files:**
- Modify: `src/app/api/settings/route.ts`
- Test: `tests/api/settings.test.ts` (extend; do not rewrite existing cases)

**Interfaces:**
- Consumes: `resolveCredential`, `UserSettings` (Task 2); `PROVIDERS` (Task 1)
- Produces: `GET` response `{ settings, sources }`; `PUT` merge semantics

- [ ] **Step 1: Write the failing tests**

```ts
// append to tests/api/settings.test.ts
describe("GET /api/settings sources", () => {
  it("reports a saved key as coming from the user, without the value", async () => {
    user.findUnique.mockResolvedValue({
      settings: { llmProvider: "openai", llmApiKey: "sk-abcdefghijkl" },
    } as never);

    const body = await (await getSettings()).json();

    expect(body.sources.llmApiKey).toMatchObject({ source: "user", envVar: "OPENAI_API_KEY" });
    expect(JSON.stringify(body)).not.toContain("sk-abcdefghijkl");
  });

  it("reports an environment key as coming from the environment", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-env");
    user.findUnique.mockResolvedValue({ settings: { llmProvider: "anthropic" } } as never);

    const body = await (await getSettings()).json();

    expect(body.sources.llmApiKey).toMatchObject({ source: "env", envVar: "ANTHROPIC_API_KEY" });
    expect(JSON.stringify(body)).not.toContain("sk-ant-env");
  });

  it("reports nothing configured as none", async () => {
    user.findUnique.mockResolvedValue({ settings: {} } as never);
    const body = await (await getSettings()).json();
    expect(body.sources.videoApiKey.source).toBe("none");
  });
});

describe("PUT /api/settings merge", () => {
  it("persists a video provider, which the old six-field rebuild could not", async () => {
    user.findUnique.mockResolvedValue({ settings: { llmProvider: "openai" } } as never);
    user.update.mockResolvedValue({} as never);

    await putSettings(put({ videoProvider: "heygen", videoApiKey: "hg-key" }));

    const saved = (user.update.mock.calls[0][0] as unknown as {
      data: { settings: Record<string, unknown> };
    }).data.settings;
    expect(saved.videoProvider).toBe("heygen");
    expect(saved.videoApiKey).toBe("hg-key");
    expect(saved.llmProvider).toBe("openai");
  });

  it("rejects an unknown field rather than storing it", async () => {
    user.findUnique.mockResolvedValue({ settings: {} } as never);
    const response = await putSettings(put({ isAdmin: true }));
    expect(response.status).toBe(400);
    expect(user.update).not.toHaveBeenCalled();
  });

  it("rejects a provider id that is not in the registry", async () => {
    user.findUnique.mockResolvedValue({ settings: {} } as never);
    expect((await putSettings(put({ llmProvider: "hal9000" }))).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/api/settings.test.ts`
Expected: FAIL — `body.sources` is undefined; unknown fields are silently ignored rather than rejected

- [ ] **Step 3: Rewrite the route**

Delete the route's own `export interface UserSettings` and import the shared one instead — two interfaces of the same name describing the same document is how `videoProvider` came to exist in one and not the other. Check for other importers first (`grep -rn 'from "@/app/api/settings/route"' src/`) and repoint any to `@/lib/settings/resolve`.

```ts
// src/app/api/settings/route.ts — replace the PUT body and extend GET
import { z } from "zod";
import { PROVIDERS, type CredentialField } from "@/lib/providers/registry";
import { resolveCredential, type UserSettings } from "@/lib/settings/resolve";

const CREDENTIAL_FIELDS: CredentialField[] = [
  "llmApiKey",
  "imageApiKey",
  "videoApiKey",
  "ollamaUrl",
];

const idsOf = (kind: "llm" | "image" | "video") =>
  PROVIDERS.filter((p) => p.kind === kind).map((p) => p.id) as [string, ...string[]];

const settingsPatchSchema = z
  .object({
    llmProvider: z.enum(idsOf("llm")),
    llmApiKey: z.string(),
    llmModel: z.string(),
    ollamaUrl: z.string(),
    imageProvider: z.enum(idsOf("image")),
    imageApiKey: z.string(),
    videoProvider: z.enum(idsOf("video")),
    videoApiKey: z.string(),
  })
  .partial()
  .strict();

/** A submitted value that still carries the mask must not overwrite the stored key. */
function keepIfMasked(submitted: string | undefined, stored: string | undefined) {
  if (!submitted || submitted.includes("••••")) return stored;
  return submitted;
}

function buildSources(settings: UserSettings) {
  const sources: Record<string, unknown> = {};
  for (const field of CREDENTIAL_FIELDS) {
    const providerId =
      field === "imageApiKey" ? settings.imageProvider ?? "openai"
      : field === "videoApiKey" ? settings.videoProvider ?? "veo"
      : settings.llmProvider ?? "openai";

    const { origin, envVar, value } = resolveCredential(field, providerId, settings);
    sources[field] = {
      source: origin,
      envVar,
      masked: value ? maskKey(value) : undefined,
    };
  }
  return sources;
}
```

GET returns `{ settings: masked, sources: buildSources(settings) }`.

PUT becomes:

```ts
const patch = settingsPatchSchema.parse(await request.json());

const updated: UserSettings = {
  ...current,
  ...patch,
  llmApiKey: keepIfMasked(patch.llmApiKey, current.llmApiKey),
  imageApiKey: keepIfMasked(patch.imageApiKey, current.imageApiKey),
  videoApiKey: keepIfMasked(patch.videoApiKey, current.videoApiKey),
};
```

Add the Zod branch to the catch, before the 500:

```ts
if (error instanceof z.ZodError) {
  return NextResponse.json({ error: "Invalid settings", issues: error.issues }, { status: 400 });
}
```

- [ ] **Step 4: Run the whole settings suite**

Run: `npm test -- tests/api/settings.test.ts`
Expected: PASS — the new cases plus all 18 existing ones, including the masked-placeholder preservation tests

- [ ] **Step 5: Commit**

```bash
git add src/app/api/settings/route.ts tests/api/settings.test.ts
git commit -m "fix: merge settings on PUT and report where each credential resolves from"
```

---

### Task 4: Provider test endpoint

**Files:**
- Create: `src/lib/providers/cooldown.ts`, `src/app/api/settings/providers/test/route.ts`
- Test: `tests/lib/providers/cooldown.test.ts`, `tests/api/provider-test.test.ts`

**Interfaces:**
- Consumes: `findProvider` (Task 1), `resolveCredential` (Task 2)
- Produces: `checkCooldown(userId, now?): { allowed: boolean; retryAfterSeconds: number }`

- [ ] **Step 1: Write the failing cooldown test**

```ts
// tests/lib/providers/cooldown.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { checkCooldown, __resetCooldowns } from "@/lib/providers/cooldown";

describe("checkCooldown", () => {
  beforeEach(() => {
    __resetCooldowns();
  });

  it("allows the first attempt", () => {
    expect(checkCooldown("user_1", 0).allowed).toBe(true);
  });

  it("blocks a second attempt within three seconds", () => {
    checkCooldown("user_1", 0);
    const second = checkCooldown("user_1", 2_000);
    expect(second.allowed).toBe(false);
    expect(second.retryAfterSeconds).toBe(1);
  });

  it("allows again once the gap has passed", () => {
    checkCooldown("user_1", 0);
    expect(checkCooldown("user_1", 3_000).allowed).toBe(true);
  });

  it("throttles per user, not globally", () => {
    checkCooldown("user_1", 0);
    expect(checkCooldown("user_2", 0).allowed).toBe(true);
  });

  it("caps at twenty attempts an hour", () => {
    let now = 0;
    for (let i = 0; i < 20; i++) {
      expect(checkCooldown("user_1", now).allowed).toBe(true);
      now += 3_000;
    }
    expect(checkCooldown("user_1", now).allowed).toBe(false);
  });

  it("forgets attempts older than an hour", () => {
    checkCooldown("user_1", 0);
    expect(checkCooldown("user_1", 3_600_001).allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/lib/providers/cooldown.test.ts`
Expected: FAIL — cannot resolve `@/lib/providers/cooldown`

- [ ] **Step 3: Write the cooldown**

```ts
// src/lib/providers/cooldown.ts
const MIN_GAP_MS = 3_000;
const HOURLY_LIMIT = 20;
const HOUR_MS = 3_600_000;

const attempts = new Map<string, number[]>();

export interface CooldownResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * In-memory throttle for the provider test endpoint, which makes authenticated
 * outbound calls with user-supplied credentials. Bounds abuse; not an audit
 * control — counters reset when the process does.
 */
export function checkCooldown(userId: string, now: number = Date.now()): CooldownResult {
  const recent = (attempts.get(userId) ?? []).filter((t) => now - t < HOUR_MS);

  const last = recent[recent.length - 1];
  if (last !== undefined && now - last < MIN_GAP_MS) {
    return { allowed: false, retryAfterSeconds: Math.ceil((MIN_GAP_MS - (now - last)) / 1000) };
  }

  if (recent.length >= HOURLY_LIMIT) {
    const oldest = recent[0];
    return { allowed: false, retryAfterSeconds: Math.ceil((HOUR_MS - (now - oldest)) / 1000) };
  }

  recent.push(now);
  attempts.set(userId, recent);
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Test hook. */
export function __resetCooldowns(): void {
  attempts.clear();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/lib/providers/cooldown.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Write the failing route test**

```ts
// tests/api/provider-test.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique: vi.fn() } } }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(), getSession: vi.fn() }));

import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { __resetCooldowns } from "@/lib/providers/cooldown";
import { POST as testProvider } from "@/app/api/settings/providers/test/route";

const user = vi.mocked(prisma.user);
const session = vi.mocked(requireSession);
const fetchMock = vi.fn();

const post = (body: unknown) =>
  new Request("http://localhost/api/settings/providers/test", {
    method: "POST",
    body: JSON.stringify(body),
  });

beforeEach(() => {
  __resetCooldowns();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({ ok: true, status: 200 });
  session.mockResolvedValue({ user: { id: "user_1", email: "a@b.c" } } as never);
  user.findUnique.mockResolvedValue({ settings: {} } as never);
});

describe("POST /api/settings/providers/test", () => {
  it("reports ok when the provider accepts the supplied credential", async () => {
    const response = await testProvider(post({ kind: "llm", providerId: "openai", credential: "sk-good" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("reports a human message when the provider rejects it", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    const body = await (await testProvider(post({ kind: "llm", providerId: "openai", credential: "sk-bad" }))).json();
    expect(body).toEqual({ ok: false, message: "OpenAI rejected that key." });
  });

  it("never echoes the credential", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    const body = await (await testProvider(post({ kind: "llm", providerId: "openai", credential: "sk-supersecret" }))).json();
    expect(JSON.stringify(body)).not.toContain("sk-supersecret");
  });

  it("falls back to the resolved credential when none is supplied", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-from-env");
    await testProvider(post({ kind: "llm", providerId: "openai" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      { headers: { Authorization: "Bearer sk-from-env" } }
    );
  });

  it("answers 400 when nothing is configured and nothing was supplied", async () => {
    const response = await testProvider(post({ kind: "llm", providerId: "openai" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });

  it("answers 400 for a provider that is not in the registry", async () => {
    expect((await testProvider(post({ kind: "llm", providerId: "hal9000", credential: "x" }))).status).toBe(400);
  });

  it("answers 429 on a second attempt inside the cooldown", async () => {
    await testProvider(post({ kind: "llm", providerId: "openai", credential: "sk-good" }));
    const second = await testProvider(post({ kind: "llm", providerId: "openai", credential: "sk-good" }));
    expect(second.status).toBe(429);
    await expect(second.json()).resolves.toMatchObject({ ok: false });
  });

  it("answers 401 when signed out and does not call the provider", async () => {
    session.mockRejectedValue(new Error("Unauthorized"));
    expect((await testProvider(post({ kind: "llm", providerId: "openai", credential: "x" }))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm test -- tests/api/provider-test.test.ts`
Expected: FAIL — cannot resolve the route module

- [ ] **Step 7: Write the route**

```ts
// src/app/api/settings/providers/test/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { findProvider } from "@/lib/providers/registry";
import { checkCooldown } from "@/lib/providers/cooldown";
import { resolveCredential, type UserSettings } from "@/lib/settings/resolve";

const schema = z.object({
  kind: z.enum(["llm", "image", "video"]),
  providerId: z.string().min(1),
  credential: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const { kind, providerId, credential } = schema.parse(await request.json());

    const provider = findProvider(kind, providerId);
    if (!provider) {
      return NextResponse.json({ ok: false, message: "Unknown provider" }, { status: 400 });
    }

    const gate = checkCooldown(session.user.id);
    if (!gate.allowed) {
      return NextResponse.json(
        { ok: false, message: `Too many tests. Try again in ${gate.retryAfterSeconds}s.` },
        { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } }
      );
    }

    let value = credential;
    if (!value) {
      const stored = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { settings: true },
      });
      const settings = (stored?.settings as unknown as UserSettings) || {};
      value = resolveCredential(provider.credential.field, providerId, settings).value;
    }

    if (!value) {
      return NextResponse.json(
        { ok: false, message: "Nothing to test — no key saved here or in the environment." },
        { status: 400 }
      );
    }

    try {
      await provider.test(value);
    } catch (error) {
      // provider.test throws messages that never contain the credential
      return NextResponse.json(
        { ok: false, message: error instanceof Error ? error.message : "Test failed" },
        { status: 200 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, message: "Invalid request" }, { status: 400 });
    }
    return NextResponse.json({ ok: false, message: "Test failed" }, { status: 500 });
  }
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npm test -- tests/api/provider-test.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 9: Commit**

```bash
git add src/lib/providers/cooldown.ts src/app/api/settings/providers/test/route.ts tests/lib/providers/cooldown.test.ts tests/api/provider-test.test.ts
git commit -m "feat: add a throttled provider credential test endpoint"
```

---

### Task 5: Settings layout, sub-nav and redirect

**Files:**
- Create: `src/components/settings/settings-nav.tsx`, `src/app/settings/layout.tsx`, `src/app/settings/page.tsx`
- Modify: `src/app/settings/connections/page.tsx`, `src/components/layout/sidebar.tsx`

**Interfaces:**
- Produces: settings pages render inside `AppShell` + sub-nav; children supply only their own content

- [ ] **Step 1: Write the sub-nav**

```tsx
// src/components/settings/settings-nav.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/settings/providers", label: "Providers" },
  { href: "/settings/connections", label: "Connections" },
  { href: "/settings/account", label: "Account" },
];

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="w-40 shrink-0 space-y-1">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            "block rounded-lg px-3 py-2 text-sm transition-colors",
            pathname === tab.href
              ? "bg-card text-foreground"
              : "text-muted hover:text-foreground hover:bg-card/60"
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Write the layout and the redirect**

```tsx
// src/app/settings/layout.tsx
import { AppShell } from "@/components/layout/app-shell";
import { SettingsNav } from "@/components/settings/settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <div className="max-w-4xl mx-auto flex gap-10">
        <SettingsNav />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </AppShell>
  );
}
```

```tsx
// src/app/settings/page.tsx
import { redirect } from "next/navigation";

export default function SettingsIndex() {
  redirect("/settings/providers");
}
```

- [ ] **Step 3: Strip the connections page back to connections**

In `src/app/settings/connections/page.tsx`: remove the `AppShell` wrapper, the centred `Settings` header block, and the AI Provider / Image Generation sections along with the save button and the settings state they used. What remains is the connections list and its loading state, wrapped in a plain `<div>`. Its heading becomes a left-aligned `<h1>` reading "Connections" with the subtitle "Publish straight to your social accounts."

Delete from that file: `settings`, `saving`, `saved` state, the `save` handler, and the now-unused `Input`, `ImageIcon`, `Check` imports.

- [ ] **Step 4: Point the sidebar at the useful page**

In `src/components/layout/sidebar.tsx`, change the Settings nav entry:

```tsx
{ href: "/settings/providers", label: "Settings", icon: Settings },
```

- [ ] **Step 5: Verify by hand**

```bash
npm run dev
```

Visit `/settings` — expect a redirect to `/settings/providers` (404 until Task 6; that is expected).
Visit `/settings/connections` — expect the connections list inside the new two-column layout, with the sub-nav highlighting Connections.

- [ ] **Step 6: Run lint, typecheck and the suite**

Run: `npm run lint && npx tsc --noEmit && npm test`
Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add src/app/settings src/components/settings src/components/layout/sidebar.tsx
git commit -m "refactor: give settings a shared layout and sub-navigation"
```

---

### Task 6: Providers page

**Files:**
- Create: `src/components/settings/provider-section.tsx`, `src/app/settings/providers/page.tsx`
- Modify: `CONTRIBUTING.md`

**Interfaces:**
- Consumes: `providersOfKind` (Task 1); `GET`/`PUT /api/settings` (Task 3); test endpoint (Task 4)
- Produces: the page a user lands on from the sidebar

- [ ] **Step 1: Write the section component**

```tsx
// src/components/settings/provider-section.tsx
"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { providersOfKind, type ProviderKind } from "@/lib/providers/registry";

export interface SourceInfo {
  source: "user" | "env" | "none";
  envVar?: string;
  masked?: string;
}

interface Props {
  kind: ProviderKind;
  title: string;
  blurb: string;
  feature: string;
  selectedId: string;
  credential: string;
  touched: boolean;
  source: SourceInfo;
  onSelect: (id: string) => void;
  onCredentialChange: (value: string) => void;
}

export function ProviderSection({
  kind, title, blurb, feature, selectedId, credential, touched, source,
  onSelect, onCredentialChange,
}: Props) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);

  const providers = providersOfKind(kind);
  const selected = providers.find((p) => p.id === selectedId) ?? providers[0];
  const isUrl = selected.credential.type === "url";

  async function runTest() {
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch("/api/settings/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Omit the credential when untouched so an env key needs no retyping.
        body: JSON.stringify({
          kind,
          providerId: selected.id,
          ...(touched && credential ? { credential } : {}),
        }),
      });
      setResult(await res.json());
    } catch {
      setResult({ ok: false, message: "Could not reach the server." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card className="p-6">
      <div className="mb-1 text-xs tracking-wide text-muted">{title}</div>
      <p className="mb-4 text-xs text-muted/70">{blurb}</p>

      <div className="mb-4 grid grid-cols-2 gap-2">
        {providers.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => { onSelect(p.id); setResult(null); }}
            className={cn(
              "rounded-lg border px-3 py-2.5 text-left transition-colors cursor-pointer",
              p.id === selected.id
                ? "border-accent bg-accent-muted"
                : "border-border bg-surface hover:border-accent/30"
            )}
          >
            <span className="block text-sm">{p.label}</span>
            <span className="block text-xs text-muted">{p.modelLabel}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          type={isUrl ? "text" : "password"}
          value={credential}
          placeholder={source.masked ?? selected.credential.placeholder}
          onChange={(e) => { onCredentialChange(e.target.value); setResult(null); }}
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted/40 focus:border-accent/50 focus:outline-none"
        />
        <Button variant="secondary" size="sm" loading={testing} onClick={runTest}>
          Test
        </Button>
      </div>

      <p className="mt-2 text-xs">
        {result ? (
          <span className={result.ok ? "text-success" : "text-danger"}>
            {result.ok ? "✓ Verified just now" : `✕ ${result.message}`}
          </span>
        ) : source.source === "user" ? (
          <span className="text-success">✓ saved here</span>
        ) : source.source === "env" ? (
          <span className="text-success">✓ from your environment ({source.envVar})</span>
        ) : (
          <span className="text-warning">
            ⚠ Not configured — {feature} will fail until this is set
          </span>
        )}
      </p>
    </Card>
  );
}
```

- [ ] **Step 2: Write the page**

```tsx
// src/app/settings/providers/page.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ProviderSection, type SourceInfo } from "@/components/settings/provider-section";

interface SettingsPayload {
  settings: Record<string, string | undefined>;
  sources: Record<string, SourceInfo>;
}

const SECTIONS = [
  { kind: "llm" as const, title: "TEXT", blurb: "Campaigns, scripts and brand analysis", feature: "campaign generation", providerField: "llmProvider", credentialField: "llmApiKey" },
  { kind: "image" as const, title: "IMAGES", blurb: "Photoshoot and campaign visuals", feature: "image generation", providerField: "imageProvider", credentialField: "imageApiKey" },
  { kind: "video" as const, title: "VIDEO", blurb: "UGC Studio", feature: "UGC Studio", providerField: "videoProvider", credentialField: "videoApiKey" },
];

const DEFAULT_PROVIDER: Record<string, string> = {
  llmProvider: "openai", imageProvider: "openai", videoProvider: "veo",
};

export default function ProvidersPage() {
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/settings");
    setData(await res.json());
    setDraft({});
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!data) {
    return <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />;
  }

  const valueOf = (field: string) =>
    draft[field] ?? data.settings[field] ?? DEFAULT_PROVIDER[field] ?? "";
  const set = (field: string, value: string) => setDraft((d) => ({ ...d, [field]: value }));
  const dirty = Object.keys(draft).length > 0;

  async function save() {
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-[family-name:var(--font-heading)] italic">Providers</h1>
      <p className="mb-8 text-sm text-muted">
        Which models generate your content. Keys saved here override your environment.
      </p>

      <div className="space-y-5 pb-24">
        {SECTIONS.map((s) => (
          <ProviderSection
            key={s.kind}
            kind={s.kind}
            title={s.title}
            blurb={s.blurb}
            feature={s.feature}
            selectedId={valueOf(s.providerField)}
            credential={draft[s.credentialField] ?? ""}
            touched={s.credentialField in draft}
            source={data.sources[s.credentialField]}
            onSelect={(id) => set(s.providerField, id)}
            onCredentialChange={(v) => set(s.credentialField, v)}
          />
        ))}
      </div>

      {dirty && (
        <div className="sticky bottom-0 -mx-8 flex items-center justify-between border-t border-border bg-surface px-8 py-3">
          <span className="text-xs text-accent">Unsaved changes</span>
          <Button size="sm" loading={saving} onClick={save}>Save</Button>
        </div>
      )}
    </div>
  );
}
```

Note the Ollama case: its credential field is `ollamaUrl`, not `llmApiKey`. Handle it by reading `providersOfKind("llm").find(p => p.id === valueOf("llmProvider"))!.credential.field` rather than the hardcoded `credentialField` above when the selected LLM provider is Ollama.

- [ ] **Step 3: Verify by hand against a real provider**

```bash
npm run dev
```

- `/settings/providers` lists all three sections, video included.
- With `OPENAI_API_KEY` set in `.env`, the TEXT status reads "from your environment (OPENAI_API_KEY)".
- Test on that provider returns a green result; corrupt the key in `.env`, restart, and Test reports "OpenAI rejected that key."
- The video section shows the warning state on a fresh account.
- Selecting HeyGen, pasting a key and saving persists across a reload — the bug this whole plan exists to fix.

- [ ] **Step 4: Update the contributor docs**

In `CONTRIBUTING.md`, under "Adding a New LLM Provider" and "Adding a New Image Provider", add a step:

```markdown
5. Add an entry to `src/lib/providers/registry.ts` so the provider appears in
   Settings, with its `envVar` and a `test()` that makes one cheap read-only
   call. The registry test asserts every `envVar` is documented in
   `.env.example`.
```

Add the equivalent "Adding a New Video Provider" section, which does not exist today.

- [ ] **Step 5: Run everything**

Run: `npm run lint && npx tsc --noEmit && npm test && npm run build`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/app/settings/providers src/components/settings/provider-section.tsx CONTRIBUTING.md
git commit -m "feat: add the providers settings page, including video generation"
```

> **Shippable checkpoint.** Tasks 1–6 stand alone: settings are restructured, video is configurable, sources are shown and keys are testable. Task 7 onward adds account management and can land separately.

---

### Task 7: Account API

**Files:**
- Create: `src/app/api/account/route.ts`, `src/app/api/account/password/route.ts`
- Test: `tests/api/account.test.ts`

**Interfaces:**
- Produces: `GET`/`PATCH /api/account`, `POST /api/account/password`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/api/account.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() } },
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(), getSession: vi.fn() }));
vi.mock("bcryptjs", () => ({
  default: { compare: vi.fn(), hash: vi.fn(async (v: string) => `hashed:${v}`) },
}));

import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import bcrypt from "bcryptjs";
import { GET as getAccount, PATCH as patchAccount } from "@/app/api/account/route";
import { POST as changePassword } from "@/app/api/account/password/route";

const user = vi.mocked(prisma.user);
const session = vi.mocked(requireSession);
const compare = vi.mocked(bcrypt.compare);

const patch = (body: unknown) =>
  new Request("http://localhost/api/account", { method: "PATCH", body: JSON.stringify(body) });
const pw = (body: unknown) =>
  new Request("http://localhost/api/account/password", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  session.mockResolvedValue({ user: { id: "user_1", email: "ada@example.com" } } as never);
  user.findUnique.mockResolvedValue({
    id: "user_1", name: "Ada", email: "ada@example.com", password: "hashed",
  } as never);
  user.findFirst.mockResolvedValue(null as never);
  user.update.mockResolvedValue({ id: "user_1", name: "Ada", email: "ada@example.com" } as never);
  compare.mockResolvedValue(true as never);
});

describe("GET /api/account", () => {
  it("returns the profile without the password hash", async () => {
    const body = await (await getAccount()).json();
    expect(body).toEqual({ name: "Ada", email: "ada@example.com", hasPassword: true });
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(new Error("Unauthorized"));
    expect((await getAccount()).status).toBe(401);
  });
});

describe("PATCH /api/account", () => {
  it("changes the name with no password required", async () => {
    const response = await patchAccount(patch({ name: "Ada Lovelace" }));
    expect(response.status).toBe(200);
    expect(user.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { name: "Ada Lovelace" },
      select: { name: true, email: true },
    });
  });

  it("requires the current password to change the email", async () => {
    const response = await patchAccount(patch({ email: "new@example.com" }));
    expect(response.status).toBe(401);
    expect(user.update).not.toHaveBeenCalled();
  });

  it("rejects a wrong current password", async () => {
    compare.mockResolvedValue(false as never);
    const response = await patchAccount(patch({ email: "new@example.com", currentPassword: "nope" }));
    expect(response.status).toBe(401);
    expect(user.update).not.toHaveBeenCalled();
  });

  it("changes the email when the password checks out", async () => {
    const response = await patchAccount(patch({ email: "new@example.com", currentPassword: "pw" }));
    expect(response.status).toBe(200);
    expect(user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { email: "new@example.com" } })
    );
  });

  it("answers 409 when the email is taken", async () => {
    user.findFirst.mockResolvedValue({ id: "someone_else" } as never);
    const response = await patchAccount(patch({ email: "taken@example.com", currentPassword: "pw" }));
    expect(response.status).toBe(409);
    expect(user.update).not.toHaveBeenCalled();
  });

  it("answers 400 for a malformed email", async () => {
    expect((await patchAccount(patch({ email: "nope", currentPassword: "pw" }))).status).toBe(400);
  });
});

describe("POST /api/account/password", () => {
  it("changes the password when the current one is right", async () => {
    const response = await changePassword(pw({ currentPassword: "old", newPassword: "correct horse battery" }));
    expect(response.status).toBe(200);
    expect(user.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { password: "hashed:correct horse battery" },
    });
  });

  it("rejects a wrong current password", async () => {
    compare.mockResolvedValue(false as never);
    const response = await changePassword(pw({ currentPassword: "wrong", newPassword: "correct horse battery" }));
    expect(response.status).toBe(401);
    expect(user.update).not.toHaveBeenCalled();
  });

  it("lets a Google-only account set its first password without one", async () => {
    user.findUnique.mockResolvedValue({ id: "user_1", name: "Ada", email: "a@b.c", password: null } as never);
    const response = await changePassword(pw({ newPassword: "correct horse battery" }));
    expect(response.status).toBe(200);
    expect(compare).not.toHaveBeenCalled();
  });

  it("still requires the current password when the account has one", async () => {
    expect((await changePassword(pw({ newPassword: "correct horse battery" }))).status).toBe(401);
  });

  it("answers 400 for a password under eight characters", async () => {
    expect((await changePassword(pw({ currentPassword: "old", newPassword: "short" }))).status).toBe(400);
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(new Error("Unauthorized"));
    expect((await changePassword(pw({ newPassword: "correct horse battery" }))).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/api/account.test.ts`
Expected: FAIL — cannot resolve the route modules

- [ ] **Step 3: Write both routes**

`src/app/api/account/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  currentPassword: z.string().optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, email: true, password: true },
    });
    return NextResponse.json({
      name: user?.name ?? null,
      email: user?.email ?? null,
      hasPassword: Boolean(user?.password),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireSession();
    const { name, email, currentPassword } = patchSchema.parse(await request.json());

    const data: { name?: string; email?: string } = {};
    if (name) data.name = name;

    if (email) {
      const account = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { password: true },
      });
      const ok =
        Boolean(currentPassword) &&
        Boolean(account?.password) &&
        (await bcrypt.compare(currentPassword!, account!.password!));
      if (!ok) {
        return NextResponse.json({ error: "Current password required" }, { status: 401 });
      }

      const taken = await prisma.user.findFirst({ where: { email, NOT: { id: session.user.id } } });
      if (taken) {
        return NextResponse.json({ error: "Email already registered" }, { status: 409 });
      }
      data.email = email;
    }

    const updated = await prisma.user.update({
      where: { id: session.user.id },
      data,
      select: { name: true, email: true },
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", issues: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

`src/app/api/account/password/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

const schema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8),
});

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const { currentPassword, newPassword } = schema.parse(await request.json());

    const account = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { password: true },
    });

    // Accounts created through Google have no password to prove. Setting the
    // first one from an authenticated session is not an escalation.
    if (account?.password) {
      const ok = Boolean(currentPassword) && (await bcrypt.compare(currentPassword!, account.password));
      if (!ok) {
        return NextResponse.json({ error: "Current password required" }, { status: 401 });
      }
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { password: await bcrypt.hash(newPassword, 12) },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", issues: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/api/account.test.ts`
Expected: PASS, 15 tests

- [ ] **Step 5: Commit**

```bash
git add src/app/api/account tests/api/account.test.ts
git commit -m "feat: add account name, email and password endpoints"
```

---

### Task 8: Account page

**Files:**
- Create: `src/app/settings/account/page.tsx`

**Interfaces:**
- Consumes: `GET`/`PATCH /api/account`, `POST /api/account/password` (Task 7)

- [ ] **Step 1: Write the page**

```tsx
// src/app/settings/account/page.tsx
"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Account { name: string | null; email: string | null; hasPassword: boolean }

export default function AccountPage() {
  const [account, setAccount] = useState<Account | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/account").then((r) => r.json()).then((a: Account) => {
      setAccount(a);
      setName(a.name ?? "");
      setEmail(a.email ?? "");
    });
  }, []);

  if (!account) {
    return <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />;
  }

  async function send(url: string, method: string, body: unknown, okText: string) {
    setNote(null);
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    if (res.ok) {
      setNote({ ok: true, text: okText });
      return true;
    }
    const text =
      res.status === 409 ? "That email is already registered."
      : res.status === 401 ? "Current password required."
      : payload.error ?? "Something went wrong.";
    setNote({ ok: false, text });
    return false;
  }

  const emailChanged = email !== (account.email ?? "");

  return (
    <div className="space-y-5">
      <h1 className="mb-1 text-2xl font-[family-name:var(--font-heading)] italic">Account</h1>
      <p className="mb-6 text-sm text-muted">Your name, sign-in email and password.</p>

      <Card className="space-y-4 p-6">
        <div className="text-xs tracking-wide text-muted">PROFILE</div>
        <Input label="Display name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button size="sm" onClick={() => send("/api/account", "PATCH", { name }, "Name saved.")}>
          Save name
        </Button>
      </Card>

      <Card className="space-y-4 p-6">
        <div className="text-xs tracking-wide text-muted">EMAIL</div>
        <Input label="Sign-in email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        {emailChanged && (
          <Input
            label="Current password"
            type="password"
            value={emailPassword}
            onChange={(e) => setEmailPassword(e.target.value)}
          />
        )}
        <Button
          size="sm"
          disabled={!emailChanged}
          onClick={() =>
            send("/api/account", "PATCH", { email, currentPassword: emailPassword }, "Email updated.")
          }
        >
          Save email
        </Button>
      </Card>

      <Card className="space-y-4 p-6">
        <div className="text-xs tracking-wide text-muted">
          {account.hasPassword ? "CHANGE PASSWORD" : "SET A PASSWORD"}
        </div>
        {!account.hasPassword && (
          <p className="text-xs text-muted">
            You signed in with Google, so this account has no password yet.
          </p>
        )}
        {account.hasPassword && (
          <Input label="Current password" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        )}
        <Input label="New password" type="password" value={next} onChange={(e) => setNext(e.target.value)} />
        <Input
          label="Confirm new password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={confirm && confirm !== next ? "Passwords do not match" : undefined}
        />
        <Button
          size="sm"
          disabled={!next || next !== confirm}
          onClick={async () => {
            const ok = await send(
              "/api/account/password",
              "POST",
              account.hasPassword ? { currentPassword: current, newPassword: next } : { newPassword: next },
              "Password updated."
            );
            if (ok) { setCurrent(""); setNext(""); setConfirm(""); setAccount({ ...account, hasPassword: true }); }
          }}
        >
          {account.hasPassword ? "Change password" : "Set password"}
        </Button>
      </Card>

      {note && (
        <p className={note.ok ? "text-xs text-success" : "text-xs text-danger"}>{note.text}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify by hand**

```bash
npm run dev
```

- Change the display name; reload; it persists.
- Change the email without a password → the form asks for one.
- Change the email with a wrong password → "Current password required".
- Change the password, sign out, sign in with the new one.

- [ ] **Step 3: Run everything**

Run: `npm run lint && npx tsc --noEmit && npm test && npm run build`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add src/app/settings/account
git commit -m "feat: add the account settings page"
```

---

## Final verification

- [ ] `npm test` — the suite, including the ~50 new cases, passes
- [ ] `npm run test:coverage` — all four thresholds still met over `src/lib` and `src/app/api`
- [ ] `npm run lint && npx tsc --noEmit && npm run build`
- [ ] `docker compose up -d --build` reaches healthy, and `/settings/providers` renders in the container
- [ ] `/settings/connections` still resolves — the old URL was not broken
