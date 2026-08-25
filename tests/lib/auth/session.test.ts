import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth/options", () => ({ authOptions: { providers: [] } }));

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { getSession, requireSession } from "@/lib/auth/session";

const serverSession = vi.mocked(getServerSession);

beforeEach(() => {
  serverSession.mockResolvedValue(null as never);
});

describe("getSession", () => {
  it("reads the session using the app's auth options", async () => {
    await getSession();
    expect(serverSession).toHaveBeenCalledWith(authOptions);
  });

  it("returns whatever next-auth returns", async () => {
    serverSession.mockResolvedValue({ user: { id: "user_1" } } as never);
    await expect(getSession()).resolves.toEqual({ user: { id: "user_1" } });
  });
});

describe("requireSession", () => {
  it("returns the session when a user is signed in", async () => {
    serverSession.mockResolvedValue({ user: { id: "user_1", email: "a@b.c" } } as never);
    await expect(requireSession()).resolves.toMatchObject({ user: { id: "user_1" } });
  });

  it("throws Unauthorized when there is no session", async () => {
    await expect(requireSession()).rejects.toThrow("Unauthorized");
  });

  it("throws Unauthorized when the session carries no user", async () => {
    serverSession.mockResolvedValue({} as never);
    await expect(requireSession()).rejects.toThrow("Unauthorized");
  });
});
