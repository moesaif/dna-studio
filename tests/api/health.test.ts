import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { $queryRaw: vi.fn() } }));

import { prisma } from "@/lib/db";
import { GET as health } from "@/app/api/health/route";

const queryRaw = vi.mocked(prisma.$queryRaw);

beforeEach(() => {
  queryRaw.mockResolvedValue([{ "?column?": 1 }] as never);
});

describe("GET /api/health", () => {
  it("reports ok when the database answers", async () => {
    const response = await health();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", database: "reachable" });
  });

  it("actually queries the database rather than answering blind", async () => {
    await health();
    expect(queryRaw).toHaveBeenCalled();
  });

  it("reports 503 when the database is unreachable, so the container is marked unhealthy", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    queryRaw.mockRejectedValue(new Error("connection refused"));

    const response = await health();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "error",
      database: "unreachable",
    });
  });

  it("does not leak the database error to the caller", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    queryRaw.mockRejectedValue(new Error("password authentication failed for user"));

    const body = await (await health()).json();

    expect(JSON.stringify(body)).not.toContain("password");
  });
});
