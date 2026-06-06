import AsyncStorage from "@react-native-async-storage/async-storage";

// One saved reminder, kept on the phone so the "My Reminders" list survives
// app restarts.
export type SavedReminder = {
  id: string; // our local id (timestamp)
  eventId: string; // the calendar event id (so we can delete it too)
  item: string;
  actionLabel: string;
  actionDate: string; // YYYY-MM-DD
  vendor: string | null;
  category: string;
  savedTo: string; // which calendar it was added to
  createdAt: string; // ISO timestamp of when it was saved
};

const KEY = "reminders";

export async function loadReminders(): Promise<SavedReminder[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedReminder[]) : [];
  } catch {
    return [];
  }
}

export async function addReminder(r: SavedReminder): Promise<SavedReminder[]> {
  const all = await loadReminders();
  const next = [r, ...all]; // newest first
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export async function deleteReminder(id: string): Promise<SavedReminder[]> {
  const all = await loadReminders();
  const next = all.filter((r) => r.id !== id);
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export async function deleteReminders(ids: string[]): Promise<SavedReminder[]> {
  const all = await loadReminders();
  const idSet = new Set(ids);
  const next = all.filter((r) => !idSet.has(r.id));
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
