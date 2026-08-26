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
