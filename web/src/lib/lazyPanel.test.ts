import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { loadOrReload, StaleBuildError } from "./lazyPanel";

const module = { default: () => null };

let reload: Mock<() => void>;

beforeEach(() => {
  window.sessionStorage.clear();
  reload = vi.fn<() => void>();
});

describe("loadOrReload", () => {
  it("returns the module when the chunk loads", async () => {
    await expect(loadOrReload(async () => module, { reload })).resolves.toBe(module);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads the page once when a chunk is missing (a newer build replaced it)", async () => {
    const pending = loadOrReload(async () => Promise.reject(new TypeError("Failed to fetch dynamically imported module")), { reload });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    const settled = await Promise.race([pending.then(() => "settled"), new Promise((r) => setTimeout(() => r("pending"), 20))]);
    expect(settled).toBe("pending");
  });

  it("gives up with StaleBuildError if the chunk is still missing right after a reload", async () => {
    const fail = async () => Promise.reject(new TypeError("Failed to fetch dynamically imported module"));
    void loadOrReload(fail, { reload, now: () => 1_000 });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    await expect(loadOrReload(fail, { reload, now: () => 5_000 })).rejects.toBeInstanceOf(StaleBuildError);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("tries a reload again once the previous attempt is old", async () => {
    const fail = async () => Promise.reject(new TypeError("Failed to fetch dynamically imported module"));
    void loadOrReload(fail, { reload, now: () => 1_000 });
    void loadOrReload(fail, { reload, now: () => 120_000 });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
  });
});
