import { describe, expect, it } from "vitest";
import { resolveShot, type Unit } from "../src/rules/index.ts";
import { describeIncoming, describeShot } from "../src/ui/text.ts";

const u = (id: string, type: Unit["type"], x: number, y: number): Unit => ({ id, type, x, y, upright: false, hits: 0 });

describe("shot descriptions", () => {
  it("names what happened to the shooter and to the victim", () => {
    const miss = resolveShot([], 5, 5, 1).result;
    expect(describeShot(miss)).toBe("Miss");
    expect(describeIncoming(miss)).toBe("missed");

    const wall = resolveShot([u("wall-1", "wall", 5, 5)], 5.5, 5.5, 1).result;
    expect(describeShot(wall)).toBe("Wall hit");

    const fort = resolveShot([u("fort-1", "fort", 5, 5)], 6.5, 6.5, 1).result;
    expect(describeShot(fort)).toBe("Fort damaged");
    expect(describeIncoming(fort)).toBe("damaged your fort");

    const two = resolveShot([u("infantry-1", "infantry", 5, 5), u("infantry-2", "infantry", 6, 5)], 6, 5.5, 1).result;
    expect(describeShot(two)).toBe("Destroyed: Infantry, Infantry");
    expect(describeIncoming(two)).toBe("destroyed your infantry, infantry");
  });
});
