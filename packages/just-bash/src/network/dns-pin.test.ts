import dns from "node:dns";
import { describe, expect, it } from "vitest";
import { _createPinnedLookup, createPinnedConnectionOwner } from "./dns-pin.js";

function lookup(
  pin: { hostname: string; address: string; family: 4 | 6 },
  hostname: string,
  options: { family?: number; all?: boolean } = {},
): Promise<{
  address?: string | { address: string; family: number }[];
  family?: number;
}> {
  return new Promise((resolve, reject) => {
    _createPinnedLookup(pin)(hostname, options, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
}

describe("request-owned DNS connector lookup", () => {
  it("returns only the reviewed address", async () => {
    await expect(
      lookup(
        { hostname: "API.Example", address: "93.184.216.34", family: 4 },
        "api.example",
      ),
    ).resolves.toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("supports all=true without adding alternate addresses", async () => {
    await expect(
      lookup(
        { hostname: "api.example", address: "2001:4860:4860::8888", family: 6 },
        "api.example",
        { all: true },
      ),
    ).resolves.toEqual({
      address: [{ address: "2001:4860:4860::8888", family: 6 }],
      family: undefined,
    });
  });

  it("fails closed for another hostname or address family", async () => {
    const pin = {
      hostname: "api.example",
      address: "1.1.1.1",
      family: 4,
    } as const;
    await expect(lookup(pin, "other.example")).rejects.toMatchObject({
      code: "ENOTFOUND",
    });
    await expect(
      lookup(pin, "api.example", { family: 6 }),
    ).rejects.toMatchObject({ code: "ENOTFOUND" });
  });

  it("keeps concurrent decisions independent", async () => {
    const [first, second] = await Promise.all([
      lookup(
        { hostname: "same.example", address: "1.1.1.1", family: 4 },
        "same.example",
      ),
      lookup(
        { hostname: "same.example", address: "8.8.8.8", family: 4 },
        "same.example",
      ),
    ]);
    expect([first, second]).toEqual([
      { address: "1.1.1.1", family: 4 },
      { address: "8.8.8.8", family: 4 },
    ]);
  });

  it("creates independent pools without patching process-global DNS", async () => {
    const originalLookup = dns.lookup;
    const pin = {
      hostname: "pool.example",
      address: "93.184.216.34",
      family: 4 as const,
    };
    const [first, second] = await Promise.all([
      createPinnedConnectionOwner(pin),
      createPinnedConnectionOwner(pin),
    ]);
    try {
      expect(first).not.toBe(second);
      expect(dns.lookup).toBe(originalLookup);
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });
});
