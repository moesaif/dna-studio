import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => {
  const model = () => ({
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  });
  return { prisma: { brand: model(), campaign: model(), user: model() } };
});
vi.mock("@/lib/auth/session", () => ({
  requireSession: vi.fn(),
  getSession: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { GET as listBrands } from "@/app/api/brands/route";
import {
  GET as getBrand,
  PATCH as patchBrand,
  DELETE as deleteBrand,
} from "@/app/api/brands/[id]/route";

const brand = vi.mocked(prisma.brand);
const session = vi.mocked(requireSession);

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const patchRequest = (body: unknown) =>
  new Request("http://localhost/api/brands/brand_1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });

const UNAUTHORIZED = new Error("Unauthorized");

beforeEach(() => {
  session.mockResolvedValue({ user: { id: "user_1", email: "a@b.c" } } as never);
});

describe("GET /api/brands", () => {
  it("returns the signed-in user's brands, newest first", async () => {
    brand.findMany.mockResolvedValue([{ id: "brand_1" }] as never);

    const response = await listBrands();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([{ id: "brand_1" }]);
    expect(brand.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user_1" },
        orderBy: { createdAt: "desc" },
      })
    );
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(UNAUTHORIZED);

    const response = await listBrands();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(brand.findMany).not.toHaveBeenCalled();
  });

  it("answers 500 when the database fails, without leaking the error", async () => {
    brand.findMany.mockRejectedValue(new Error("connection refused"));

    const response = await listBrands();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Internal server error" });
  });
});

describe("GET /api/brands/[id]", () => {
  it("returns a brand the user owns", async () => {
    brand.findFirst.mockResolvedValue({ id: "brand_1", campaigns: [] } as never);

    const response = await getBrand(new Request("http://localhost"), params("brand_1"));

    expect(response.status).toBe(200);
    expect(brand.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "brand_1", userId: "user_1" } })
    );
  });

  it("answers 404 for a brand belonging to someone else", async () => {
    brand.findFirst.mockResolvedValue(null as never);

    const response = await getBrand(new Request("http://localhost"), params("brand_1"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Brand not found" });
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(UNAUTHORIZED);
    const response = await getBrand(new Request("http://localhost"), params("brand_1"));
    expect(response.status).toBe(401);
  });
});

describe("PATCH /api/brands/[id]", () => {
  beforeEach(() => {
    brand.findFirst.mockResolvedValue({ id: "brand_1", userId: "user_1" } as never);
    brand.update.mockResolvedValue({ id: "brand_1", name: "Renamed" } as never);
  });

  it("updates the fields a user is allowed to change", async () => {
    const response = await patchBrand(
      patchRequest({ name: "Renamed", tone: "playful" }),
      params("brand_1")
    );

    expect(response.status).toBe(200);
    expect(brand.update).toHaveBeenCalledWith({
      where: { id: "brand_1" },
      data: { name: "Renamed", tone: "playful" },
    });
  });

  it("ignores userId in the body so a brand cannot be reassigned", async () => {
    const response = await patchBrand(
      patchRequest({ name: "Renamed", userId: "someone_else" }),
      params("brand_1")
    );

    expect(response.status).toBe(200);
    expect(brand.update).toHaveBeenCalledWith({
      where: { id: "brand_1" },
      data: { name: "Renamed" },
    });
  });

  it("ignores an attempt to rewrite the primary key", async () => {
    await patchBrand(patchRequest({ id: "other_brand", name: "Renamed" }), params("brand_1"));

    expect(brand.update).toHaveBeenCalledWith({
      where: { id: "brand_1" },
      data: { name: "Renamed" },
    });
  });

  it("answers 400 for a field of the wrong type", async () => {
    const response = await patchBrand(patchRequest({ name: 42 }), params("brand_1"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Invalid request body" });
    expect(brand.update).not.toHaveBeenCalled();
  });

  it("answers 400 for a malformed url", async () => {
    const response = await patchBrand(patchRequest({ url: "not-a-url" }), params("brand_1"));
    expect(response.status).toBe(400);
  });

  it("answers 404 without updating when the brand is not the user's", async () => {
    brand.findFirst.mockResolvedValue(null as never);

    const response = await patchBrand(patchRequest({ name: "Renamed" }), params("brand_1"));

    expect(response.status).toBe(404);
    expect(brand.update).not.toHaveBeenCalled();
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(UNAUTHORIZED);
    const response = await patchBrand(patchRequest({ name: "Renamed" }), params("brand_1"));
    expect(response.status).toBe(401);
  });
});

describe("DELETE /api/brands/[id]", () => {
  it("deletes a brand the user owns", async () => {
    brand.findFirst.mockResolvedValue({ id: "brand_1" } as never);
    brand.delete.mockResolvedValue({} as never);

    const response = await deleteBrand(new Request("http://localhost"), params("brand_1"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(brand.delete).toHaveBeenCalledWith({ where: { id: "brand_1" } });
  });

  it("answers 404 without deleting when the brand is not the user's", async () => {
    brand.findFirst.mockResolvedValue(null as never);

    const response = await deleteBrand(new Request("http://localhost"), params("brand_1"));

    expect(response.status).toBe(404);
    expect(brand.delete).not.toHaveBeenCalled();
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(UNAUTHORIZED);
    const response = await deleteBrand(new Request("http://localhost"), params("brand_1"));
    expect(response.status).toBe(401);
  });
});
