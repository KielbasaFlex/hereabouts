import { describe, expect, it, vi } from "vitest";
import type { LocalNotificationsPlugin } from "@capacitor/local-notifications";
import { NearbyStoryNotifier } from "./notifications.js";

function fakePlugin(overrides: Partial<LocalNotificationsPlugin> = {}): LocalNotificationsPlugin {
  return {
    checkPermissions: vi.fn(async () => ({ display: "prompt" as const })),
    requestPermissions: vi.fn(async () => ({ display: "granted" as const })),
    schedule: vi.fn(async () => ({ notifications: [] })),
    ...overrides,
  } as unknown as LocalNotificationsPlugin;
}

describe("NearbyStoryNotifier", () => {
  it("ensurePermission() returns true immediately when already granted, without re-requesting", async () => {
    const plugin = fakePlugin({ checkPermissions: vi.fn(async () => ({ display: "granted" as const })) });
    const notifier = new NearbyStoryNotifier(plugin);
    await expect(notifier.ensurePermission()).resolves.toBe(true);
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
  });

  it("ensurePermission() requests permission when not yet granted", async () => {
    const plugin = fakePlugin();
    const notifier = new NearbyStoryNotifier(plugin);
    await expect(notifier.ensurePermission()).resolves.toBe(true);
    expect(plugin.requestPermissions).toHaveBeenCalled();
  });

  it("ensurePermission() returns false when the user denies", async () => {
    const plugin = fakePlugin({ requestPermissions: vi.fn(async () => ({ display: "denied" as const })) });
    const notifier = new NearbyStoryNotifier(plugin);
    await expect(notifier.ensurePermission()).resolves.toBe(false);
  });

  it("notify() schedules a single notification with the given id, title, and body", async () => {
    const plugin = fakePlugin();
    const notifier = new NearbyStoryNotifier(plugin);
    await notifier.notify(42, "Nearby story", "There's history near you");
    expect(plugin.schedule).toHaveBeenCalledWith({
      notifications: [{ id: 42, title: "Nearby story", body: "There's history near you" }],
    });
  });
});
