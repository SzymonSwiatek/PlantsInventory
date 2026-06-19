import { describe, expect, it, vi } from "vitest";

import { removePhotos } from "./storage";

type StorageClient = Parameters<typeof removePhotos>[0];

function makeClient(removeMock: ReturnType<typeof vi.fn>): StorageClient {
  return { storage: { from: () => ({ remove: removeMock }) } } as unknown as StorageClient;
}

describe("removePhotos", () => {
  it("is a no-op on empty input — remove is never called", async () => {
    const removeMock = vi.fn();
    await removePhotos(makeClient(removeMock), []);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("swallows Storage errors without throwing", async () => {
    const removeMock = vi.fn().mockResolvedValue({ error: new Error("Storage failure") });
    await expect(removePhotos(makeClient(removeMock), ["user/plant/photo.jpg"])).resolves.toBeUndefined();
  });
});
