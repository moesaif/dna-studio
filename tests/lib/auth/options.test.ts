import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique: vi.fn() } } }));
vi.mock("@next-auth/prisma-adapter", () => ({ PrismaAdapter: vi.fn(() => ({})) }));
vi.mock("bcryptjs", () => ({ default: { compare: vi.fn() } }));

import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";

const user = vi.mocked(prisma.user);
const compare = vi.mocked(bcrypt.compare);

type Authorize = (c?: { email: string; password: string }) => Promise<unknown>;

async function loadOptions() {
  vi.resetModules();
  const { authOptions } = await import("@/lib/auth/options");
  return authOptions;
}

async function loadAuthorize(): Promise<Authorize> {
  const options = await loadOptions();
  const credentials = options.providers.find((p) => p.id === "credentials")!;
  return (credentials as unknown as { options: { authorize: Authorize } }).options.authorize;
}

beforeEach(() => {
  compare.mockResolvedValue(true as never);
  user.findUnique.mockResolvedValue({
    id: "user_1",
    email: "ada@example.com",
    name: "Ada",
    password: "hashed",
  } as never);
});

describe("authOptions", () => {
  it("uses stateless JWT sessions and the custom login page", async () => {
    const options = await loadOptions();
    expect(options.session?.strategy).toBe("jwt");
    expect(options.pages?.signIn).toBe("/login");
  });

  it("omits the Google provider unless it is configured", async () => {
    const options = await loadOptions();
    expect(options.providers.map((p) => p.id)).toEqual(["credentials"]);
  });

  it("adds the Google provider when GOOGLE_CLIENT_ID is set", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-secret");

    const options = await loadOptions();

    expect(options.providers.map((p) => p.id)).toContain("google");
  });
});

describe("credentials authorize", () => {
  it("returns the user when the password matches", async () => {
    const authorize = await loadAuthorize();

    await expect(authorize({ email: "ada@example.com", password: "pw" })).resolves.toEqual({
      id: "user_1",
      email: "ada@example.com",
      name: "Ada",
    });
  });

  it("never returns the password hash", async () => {
    const authorize = await loadAuthorize();
    const result = await authorize({ email: "ada@example.com", password: "pw" });
    expect(result).not.toHaveProperty("password");
  });

  it("compares against the stored hash rather than the raw value", async () => {
    const authorize = await loadAuthorize();
    await authorize({ email: "ada@example.com", password: "pw" });
    expect(compare).toHaveBeenCalledWith("pw", "hashed");
  });

  it.each([
    ["no credentials at all", undefined],
    ["a missing email", { email: "", password: "pw" }],
    ["a missing password", { email: "ada@example.com", password: "" }],
  ])("rejects %s", async (_label, credentials) => {
    const authorize = await loadAuthorize();
    await expect(authorize(credentials)).rejects.toThrow("Missing credentials");
    expect(user.findUnique).not.toHaveBeenCalled();
  });

  it("gives the same error for an unknown email as for a wrong password", async () => {
    const authorize = await loadAuthorize();

    user.findUnique.mockResolvedValue(null as never);
    const unknownEmail = await authorize({ email: "nobody@example.com", password: "pw" }).catch(
      (e: Error) => e.message
    );

    user.findUnique.mockResolvedValue({ id: "u", email: "a", name: "A", password: "hashed" } as never);
    compare.mockResolvedValue(false as never);
    const wrongPassword = await authorize({ email: "ada@example.com", password: "nope" }).catch(
      (e: Error) => e.message
    );

    expect(unknownEmail).toBe("Invalid credentials");
    expect(wrongPassword).toBe("Invalid credentials");
  });

  it("rejects an account that has no password set, such as a Google-only user", async () => {
    user.findUnique.mockResolvedValue({ id: "u", email: "a", name: "A", password: null } as never);
    const authorize = await loadAuthorize();

    await expect(authorize({ email: "a", password: "pw" })).rejects.toThrow("Invalid credentials");
    expect(compare).not.toHaveBeenCalled();
  });
});

describe("callbacks", () => {
  it("puts the user id on the session", async () => {
    const options = await loadOptions();

    const session = await options.callbacks!.session!({
      session: { user: { email: "a@b.c" }, expires: "" },
      token: { sub: "user_1" },
    } as never);

    expect((session.user as { id: string }).id).toBe("user_1");
  });

  it("leaves the session alone when the token has no subject", async () => {
    const options = await loadOptions();

    const session = await options.callbacks!.session!({
      session: { user: { email: "a@b.c" }, expires: "" },
      token: {},
    } as never);

    expect(session.user).not.toHaveProperty("id");
  });

  it("copies the user id onto the token at sign-in", async () => {
    const options = await loadOptions();

    const token = await options.callbacks!.jwt!({
      token: {},
      user: { id: "user_1" },
    } as never);

    expect(token.sub).toBe("user_1");
  });

  it("leaves the token untouched on later requests", async () => {
    const options = await loadOptions();

    const token = await options.callbacks!.jwt!({ token: { sub: "existing" } } as never);

    expect(token.sub).toBe("existing");
  });
});
