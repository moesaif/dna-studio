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
