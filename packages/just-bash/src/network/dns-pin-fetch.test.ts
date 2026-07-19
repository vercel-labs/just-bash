import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DnsPinningUnavailableError,
  type PinnedAddress,
  type PinnedConnectionOwnerFactory,
} from "./dns-pin.js";
import { createSecureFetch } from "./fetch.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function fakeOwners(
  responder: (
    url: string,
    init: RequestInit,
    pin: PinnedAddress,
    ownerId: number,
  ) => Promise<Response> | Response,
): {
  factory: PinnedConnectionOwnerFactory;
  pins: PinnedAddress[];
  closed: number[];
} {
  const pins: PinnedAddress[] = [];
  const closed: number[] = [];
  const factory: PinnedConnectionOwnerFactory = async (pin) => {
    const ownerId = pins.push(pin);
    return {
      fetch: async (url, init) => responder(url, init, pin, ownerId),
      async close() {
        closed.push(ownerId);
      },
    };
  };
  return { factory, pins, closed };
}

function publicDns(address = "93.184.216.34") {
  return async () => [{ address, family: 4 as const }];
}

describe("secureFetch request-owned connection binding", () => {
  it("does not reuse a pre-populated global origin pool", async () => {
    const globalFetch = vi.fn(async () => new Response("wrong pool"));
    globalThis.fetch = globalFetch as typeof fetch;
    const owners = fakeOwners(
      async () => new Response("bound", { status: 200 }),
    );
    const secureFetch = createSecureFetch({
      dangerouslyAllowFullInternetAccess: true,
      denyPrivateRanges: true,
      _dnsResolve: publicDns(),
      _createConnectionOwner: owners.factory,
    });

    const result = await secureFetch("https://same-origin.example/data");

    expect(new TextDecoder().decode(result.body)).toBe("bound");
    expect(globalFetch).not.toHaveBeenCalled();
    expect(owners.pins).toEqual([
      {
        hostname: "same-origin.example",
        address: "93.184.216.34",
        family: 4,
      },
    ]);
    expect(owners.closed).toEqual([1]);
  });

  it("keeps concurrent pins for the same hostname in separate owners", async () => {
    let resolution = 0;
    const owners = fakeOwners(
      async (_url, _init, pin) => new Response(pin.address),
    );
    const secureFetch = createSecureFetch({
      dangerouslyAllowFullInternetAccess: true,
      denyPrivateRanges: true,
      _dnsResolve: async () => [
        {
          address: ++resolution === 1 ? "1.1.1.1" : "8.8.8.8",
          family: 4,
        },
      ],
      _createConnectionOwner: owners.factory,
    });

    const results = await Promise.all([
      secureFetch("https://concurrent.example/first"),
      secureFetch("https://concurrent.example/second"),
    ]);

    expect(
      results.map((result) => new TextDecoder().decode(result.body)),
    ).toEqual(["1.1.1.1", "8.8.8.8"]);
    expect(owners.pins.map((pin) => pin.address)).toEqual([
      "1.1.1.1",
      "8.8.8.8",
    ]);
    expect(owners.closed.sort()).toEqual([1, 2]);
  });

  it("creates and disposes a new bound owner for every redirect hop", async () => {
    const owners = fakeOwners(async (url, _init, pin) => {
      if (url.includes("first.example")) {
        return new Response("", {
          status: 302,
          headers: { location: "https://second.example/landing" },
        });
      }
      return new Response(pin.address);
    });
    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: ["https://first.example", "https://second.example"],
      denyPrivateRanges: true,
      _dnsResolve: async (hostname) => [
        {
          address: hostname === "first.example" ? "8.8.8.8" : "1.1.1.1",
          family: 4,
        },
      ],
      _createConnectionOwner: owners.factory,
    });

    const result = await secureFetch("https://first.example/start");

    expect(new TextDecoder().decode(result.body)).toBe("1.1.1.1");
    expect(owners.pins.map((pin) => pin.address)).toEqual([
      "8.8.8.8",
      "1.1.1.1",
    ]);
    expect(owners.closed).toEqual([1, 2]);
  });

  it("fails closed before transport use when binding is unavailable", async () => {
    const transport = vi.fn();
    const secureFetch = createSecureFetch({
      dangerouslyAllowFullInternetAccess: true,
      denyPrivateRanges: true,
      _dnsResolve: publicDns(),
      _createConnectionOwner: async () => {
        throw new DnsPinningUnavailableError();
      },
    });
    globalThis.fetch = transport as typeof fetch;

    await expect(secureFetch("https://attacker.example/path")).rejects.toThrow(
      "Network access denied: DNS pinning unavailable for private IP enforcement",
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it("uses one cumulative deadline across slow redirect hops", async () => {
    let calls = 0;
    const owners = fakeOwners(async (_url, init) => {
      calls++;
      await new Promise<void>((resolve, reject) => {
        const id = setTimeout(resolve, 20);
        init.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(id);
            reject(init.signal?.reason);
          },
          { once: true },
        );
      });
      return new Response("", {
        status: 302,
        headers: { location: `/hop-${calls}` },
      });
    });
    const secureFetch = createSecureFetch({
      dangerouslyAllowFullInternetAccess: true,
      denyPrivateRanges: true,
      timeoutMs: 35,
      _dnsResolve: publicDns(),
      _createConnectionOwner: owners.factory,
    });

    await expect(
      secureFetch("https://slow.example/start"),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(2);
    expect(owners.closed).toEqual([1, 2]);
  });

  it("parent abort closes the live owner and prevents later effects", async () => {
    const controller = new AbortController();
    let laterEffect = false;
    let requestSignal: AbortSignal | undefined;
    const owners = fakeOwners(async (_url, init) => {
      requestSignal = init.signal ?? undefined;
      return await new Promise<Response>((resolve, reject) => {
        const id = setTimeout(() => {
          laterEffect = true;
          resolve(new Response("late"));
        }, 40);
        init.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(id);
            reject(init.signal?.reason);
          },
          { once: true },
        );
      });
    });
    const secureFetch = createSecureFetch({
      dangerouslyAllowFullInternetAccess: true,
      denyPrivateRanges: true,
      _dnsResolve: publicDns(),
      _createConnectionOwner: owners.factory,
    });

    const pending = secureFetch("https://abort.example/slow", {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(new Error("parent stopped")), 5);

    await expect(pending).rejects.toThrow("parent stopped");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requestSignal?.aborted).toBe(true);
    expect(owners.closed).toEqual([1]);
    expect(laterEffect).toBe(false);
  });

  it("closes an owner whose factory fulfills after parent abort", async () => {
    const controller = new AbortController();
    let fetchCalled = false;
    let closeCalls = 0;
    const secureFetch = createSecureFetch({
      dangerouslyAllowFullInternetAccess: true,
      denyPrivateRanges: true,
      _dnsResolve: publicDns(),
      _createConnectionOwner: async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return {
          async fetch() {
            fetchCalled = true;
            return new Response("late");
          },
          async close() {
            closeCalls++;
          },
        };
      },
    });

    const pending = secureFetch("https://late-owner.example/slow", {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(new Error("parent stopped")), 5);

    await expect(pending).rejects.toThrow("parent stopped");
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(fetchCalled).toBe(false);
    expect(closeCalls).toBe(1);
  });
});
