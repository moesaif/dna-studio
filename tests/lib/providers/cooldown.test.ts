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
