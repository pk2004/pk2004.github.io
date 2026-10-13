// Persistence in Netlify Blobs. One JSON record per user, plus an index from
// the BMW account id (gcid) to the user, so a second device that signs in to
// the same BMW account lands on the same record.
import { getStore } from "@netlify/blobs";

const store = () => getStore({ name: "lease-mileage", consistency: "strong" });

export const getUser = (id) => store().get(`users/${id}`, { type: "json" });
export const saveUser = (user) => store().setJSON(`users/${user.id}`, { ...user, updatedAt: new Date().toISOString() });
export const deleteUser = (id) => store().delete(`users/${id}`);

export const getUserIdForAccount = (gcid) => store().get(`accounts/${gcid}`, { type: "text" });
export const linkAccount = (gcid, id) => store().set(`accounts/${gcid}`, id);
export const unlinkAccount = (gcid) => store().delete(`accounts/${gcid}`);

export async function listUserIds() {
  const { blobs } = await store().list({ prefix: "users/" });
  return blobs.map((b) => b.key.slice("users/".length));
}
