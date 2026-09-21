import type { LocalNotificationsPlugin } from "@capacitor/local-notifications";

/**
 * Local notifications wrapper (PLAN.md §10, Milestone 7's third exit
 * criterion), used for the one plausible native use case this app has:
 * telling the user a story is available when the app is backgrounded and
 * `BackgroundPositionSource` (not the UI) is what noticed a nearby place.
 * Deliberately thin — a single `notify` call plus the permission check it
 * needs — rather than a general notification-scheduling abstraction, since
 * nothing else in this app schedules a notification for later.
 */
export class NearbyStoryNotifier {
  constructor(private readonly plugin: LocalNotificationsPlugin) {}

  async ensurePermission(): Promise<boolean> {
    const current = await this.plugin.checkPermissions();
    if (current.display === "granted") return true;
    const requested = await this.plugin.requestPermissions();
    return requested.display === "granted";
  }

  async notify(id: number, title: string, body: string): Promise<void> {
    await this.plugin.schedule({
      notifications: [{ id, title, body }],
    });
  }
}
