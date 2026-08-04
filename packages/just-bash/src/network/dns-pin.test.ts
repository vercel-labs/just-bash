import dns from "node:dns";
import { describe, expect, it } from "vitest";
import {
  _createPinnedLookup,
  createPinnedConnectionOwner,
  type PinnedAddress,
} from "./dns-pin.js";

function lookup(
  pin: PinnedAddress,
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
  it("returns the first reviewed address", async () => {
    await expect(
      lookup(
        {
          hostname: "API.Example",
          addresses: [{ address: "93.184.216.34", family: 4 }],
        },
        "api.example",
      ),
    ).resolves.toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("returns every reviewed address for all=true", async () => {
    await expect(
      lookup(
        {
          hostname: "api.example",
          addresses: [
            { address: "2001:4860:4860::8888", family: 6 },
            { address: "8.8.8.8", family: 4 },
          ],
        },
        "api.example",
        { all: true },
      ),
    ).resolves.toEqual({
      address: [
        { address: "2001:4860:4860::8888", family: 6 },
        { address: "8.8.8.8", family: 4 },
      ],
      family: undefined,
    });
  });

  it("selects the requested family from a dual-stack review", async () => {
    const pin: PinnedAddress = {
      hostname: "dualstack.example",
      addresses: [
        { address: "2001:4860:4860::8888", family: 6 },
        { address: "8.8.8.8", family: 4 },
      ],
    };

    await expect(
      lookup(pin, "dualstack.example", { family: 4 }),
    ).resolves.toEqual({ address: "8.8.8.8", family: 4 });
    await expect(
      lookup(pin, "dualstack.example", { family: 6 }),
    ).resolves.toEqual({ address: "2001:4860:4860::8888", family: 6 });
  });

  it("filters all=true results by the requested family", async () => {
    await expect(
      lookup(
        {
          hostname: "api.example",
          addresses: [
            { address: "2001:4860:4860::8888", family: 6 },
            { address: "8.8.8.8", family: 4 },
            { address: "1.1.1.1", family: 4 },
          ],
        },
        "api.example",
        { family: 4, all: true },
      ),
    ).resolves.toEqual({
      address: [
        { address: "8.8.8.8", family: 4 },
        { address: "1.1.1.1", family: 4 },
      ],
      family: undefined,
    });
  });

  it("fails closed for another hostname or an unavailable family", async () => {
    const pin: PinnedAddress = {
      hostname: "api.example",
      addresses: [{ address: "1.1.1.1", family: 4 }],
    };
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
        {
          hostname: "same.example",
          addresses: [{ address: "1.1.1.1", family: 4 }],
        },
        "same.example",
      ),
      lookup(
        {
          hostname: "same.example",
          addresses: [{ address: "8.8.8.8", family: 4 }],
        },
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
    const pin: PinnedAddress = {
      hostname: "pool.example",
      addresses: [{ address: "93.184.216.34", family: 4 }],
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
