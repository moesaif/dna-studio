import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => {
  const model = () => ({
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  });
  return { prisma: { photoshoot: model() } };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(), getSession: vi.fn() }));

import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { GET as listShoots, POST as createShoot } from "@/app/api/photoshoots/route";
import {
  GET as getShoot,
  PATCH as patchShoot,
  DELETE as deleteShoot,
} from "@/app/api/photoshoots/[id]/route";

const photoshoot = vi.mocked(prisma.photoshoot);
const session = vi.mocked(requireSession);

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (body: unknown) =>
  new Request("http://localhost/api/photoshoots", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  session.mockResolvedValue({ user: { id: "user_1", email: "a@b.c" } } as never);
});

describe("GET /api/photoshoots", () => {
  it("lists the user's shoots newest first", async () => {
    photoshoot.findMany.mockResolvedValue([{ id: "ps_1" }] as never);

    const response = await listShoots();

    expect(response.status).toBe(200);
    expect(photoshoot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user_1" },
        orderBy: { createdAt: "desc" },
      })
    );
  });

  it("does not return the uploaded product image in the list", async () => {
    photoshoot.findMany.mockResolvedValue([] as never);
    await listShoots();

    const select = (photoshoot.findMany.mock.calls[0][0] as { select: Record<string, boolean> }).select;
    expect(select).not.toHaveProperty("productImage");
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(new Error("Unauthorized"));
    expect((await listShoots()).status).toBe(401);
  });

  it("answers 500 when the database fails", async () => {
    photoshoot.findMany.mockRejectedValue(new Error("db down"));
    expect((await listShoots()).status).toBe(500);
  });
});

describe("POST /api/photoshoots", () => {
  beforeEach(() => {
    photoshoot.create.mockResolvedValue({ id: "ps_1" } as never);
  });

  it("creates a shoot owned by the signed-in user and answers 201", async () => {
    const response = await createShoot(
      request({ productImage: "data:image/png;base64,x", productDescription: "A mug", templates: ["studio"], results: [{ url: "a" }] })
    );

    expect(response.status).toBe(201);
    expect(photoshoot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user_1",
        productImage: "data:image/png;base64,x",
        productDescription: "A mug",
        templates: ["studio"],
        status: "generating",
      }),
    });
  });

  it("stores nulls rather than undefined for the optional fields", async () => {
    await createShoot(request({ templates: [], results: [] }));

    expect(photoshoot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ productImage: null, productDescription: null }),
    });
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(new Error("Unauthorized"));
    expect((await createShoot(request({}))).status).toBe(401);
    expect(photoshoot.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/photoshoots/[id]", () => {
  it("returns a shoot the user owns", async () => {
    photoshoot.findFirst.mockResolvedValue({ id: "ps_1" } as never);

    const response = await getShoot(new Request("http://localhost"), params("ps_1"));

    expect(response.status).toBe(200);
    expect(photoshoot.findFirst).toHaveBeenCalledWith({
      where: { id: "ps_1", userId: "user_1" },
    });
  });

  it("answers 404 for someone else's shoot", async () => {
    photoshoot.findFirst.mockResolvedValue(null as never);
    expect((await getShoot(new Request("http://localhost"), params("ps_1"))).status).toBe(404);
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(new Error("Unauthorized"));
    expect((await getShoot(new Request("http://localhost"), params("ps_1"))).status).toBe(401);
  });
});

describe("PATCH /api/photoshoots/[id]", () => {
  beforeEach(() => {
    photoshoot.findFirst.mockResolvedValue({ id: "ps_1", status: "generating" } as never);
    photoshoot.update.mockResolvedValue({ id: "ps_1" } as never);
  });

  it("saves new results and status", async () => {
    await patchShoot(request({ results: [{ url: "b" }], status: "complete" }), params("ps_1"));

    expect(photoshoot.update).toHaveBeenCalledWith({
      where: { id: "ps_1" },
      data: { results: [{ url: "b" }], status: "complete" },
    });
  });

  it("keeps the existing status when the body omits it", async () => {
    await patchShoot(request({ results: [] }), params("ps_1"));

    expect(photoshoot.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "generating" }) })
    );
  });

  it("answers 404 without updating someone else's shoot", async () => {
    photoshoot.findFirst.mockResolvedValue(null as never);

    const response = await patchShoot(request({ results: [] }), params("ps_1"));

    expect(response.status).toBe(404);
    expect(photoshoot.update).not.toHaveBeenCalled();
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(new Error("Unauthorized"));
    expect((await patchShoot(request({}), params("ps_1"))).status).toBe(401);
  });
});

describe("DELETE /api/photoshoots/[id]", () => {
  it("deletes a shoot the user owns", async () => {
    photoshoot.findFirst.mockResolvedValue({ id: "ps_1" } as never);
    photoshoot.delete.mockResolvedValue({} as never);

    const response = await deleteShoot(new Request("http://localhost"), params("ps_1"));

    expect(response.status).toBe(200);
    expect(photoshoot.delete).toHaveBeenCalledWith({ where: { id: "ps_1" } });
  });

  it("answers 404 without deleting someone else's shoot", async () => {
    photoshoot.findFirst.mockResolvedValue(null as never);

    const response = await deleteShoot(new Request("http://localhost"), params("ps_1"));

    expect(response.status).toBe(404);
    expect(photoshoot.delete).not.toHaveBeenCalled();
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(new Error("Unauthorized"));
    expect((await deleteShoot(new Request("http://localhost"), params("ps_1"))).status).toBe(401);
  });
});
