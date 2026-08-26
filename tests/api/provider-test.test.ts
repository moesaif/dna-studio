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

  it("answers 400 for a request that fails schema validation", async () => {
    const response = await testProvider(post({ kind: "hal9000", providerId: "openai", credential: "x" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });

  it("answers 500 without leaking the underlying error when the credential lookup fails", async () => {
    user.findUnique.mockRejectedValue(new Error("db down"));
    const response = await testProvider(post({ kind: "llm", providerId: "openai" }));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("db down");
  });
});
