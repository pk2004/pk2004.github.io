// Scheduled function: records every connected car's odometer once a day.
// This builds the history without the app being opened, and it keeps BMW's
// two-week refresh token alive by rotating it daily.
import { getUser, listUserIds } from "../lib/store.mjs";
import { syncUser } from "../lib/sync.mjs";

export const config = { schedule: "17 5 * * *" };

export default async function handler() {
  for (const id of await listUserIds()) {
    const user = await getUser(id);
    if (!user?.bmw?.refreshToken) continue;
    try {
      await syncUser(user);
      console.log(`Synced ${id}`);
    } catch (err) {
      console.warn(`Sync failed for ${id}: ${err.message}`);
    }
  }
}
