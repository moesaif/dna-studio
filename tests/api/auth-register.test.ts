import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: vi.fn(), create: vi.fn() } },
}));
vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn(async (value: string) => `hashed:${value}`) },
}));

import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import { POST as register } from "@/app/api/auth/register/route";

const user = vi.mocked(prisma.user);
const hash = vi.mocked(bcrypt.hash);

const post = (body: unknown) =>
  new Request("http://localhost/api/auth/register", {
    method: "POST",
    body: JSON.stringify(body),
  });

const valid = { name: "Ada", email: "ada@example.com", password: "correct horse battery" };

beforeEach(() => {
  user.findUnique.mockResolvedValue(null as never);
  user.create.mockResolvedValue({ id: "user_1", name: "Ada", email: "ada@example.com" } as never);
});

describe("POST /api/auth/register", () => {
  it("creates the account and returns it without the password", async () => {
    const response = await register(post(valid));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "user_1",
      name: "Ada",
      email: "ada@example.com",
    });
  });

  it("never stores the password in the clear", async () => {
    await register(post(valid));

    const data = (user.create.mock.calls[0][0] as { data: { password: string } }).data;
    expect(data.password).not.toBe(valid.password);
    expect(data.password).toBe(`hashed:${valid.password}`);
    expect(hash).toHaveBeenCalledWith(valid.password, 12);
  });

  it("answers 409 for an email that is already registered", async () => {
    user.findUnique.mockResolvedValue({ id: "existing" } as never);

    const response = await register(post(valid));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Email already registered" });
    expect(user.create).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing name", { ...valid, name: "" }],
    ["a malformed email", { ...valid, email: "not-an-email" }],
    ["a password under eight characters", { ...valid, password: "short" }],
    ["a missing body", {}],
  ])("answers 400 for %s", async (_label, body) => {
    const response = await register(post(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Invalid input" });
    expect(user.create).not.toHaveBeenCalled();
  });

  it("answers 500 when the database fails, without leaking the error", async () => {
    user.create.mockRejectedValue(new Error("connection refused"));

    const response = await register(post(valid));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Internal server error" });
  });
});
