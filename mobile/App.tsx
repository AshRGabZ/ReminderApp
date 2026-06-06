import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";
import * as Calendar from "expo-calendar";
import { SERVER_URL } from "./config";
import {
  loadReminders,
  addReminder as saveReminder,
  deleteReminder as removeReminder,
  deleteReminders as removeManyReminders,
  SavedReminder,
} from "./storage";

// ---- What the server sends back for a scanned bill ----
type ScanResult = {
  found_document: boolean;
  item: string;
  category: string;
  vendor: string | null;
  document_date: string | null;
  action_label: string;
  action_date: string | null;
  reasoning: string;
  confidence: "high" | "medium" | "low";
};

type ScanScreen = "home" | "loading" | "review" | "done";
type View_ = "scan" | "reminders";
type DateFilter = "all" | "upcoming" | "past";

// Filter the reminders list by a search query (matches item, label, vendor,
// category, and the date string) and a date filter (upcoming/past/all).
function filterReminders(
  list: SavedReminder[],
  query: string,
  dateFilter: DateFilter,
): SavedReminder[] {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  let out = list;
  if (dateFilter === "upcoming") out = out.filter((r) => r.actionDate >= today);
  else if (dateFilter === "past") out = out.filter((r) => r.actionDate < today);

  const needle = query.trim().toLowerCase();
  if (needle) {
    out = out.filter((r) =>
      [r.item, r.actionLabel, r.vendor ?? "", r.actionDate, r.category]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }
  return out;
}

export default function App() {
  const [view, setView] = useState<View_>("scan");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [reminders, setReminders] = useState<SavedReminder[]>([]);

  // My Reminders: search box, date filter, and multi-select delete
  const [query, setQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [scanScreen, setScanScreen] = useState<ScanScreen>("home");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);

  // Editable fields on the review screen (start from the AI's answer, user can fix)
  const [item, setItem] = useState("");
  const [actionLabel, setActionLabel] = useState("");
  const [actionDate, setActionDate] = useState("");
  const [savedTo, setSavedTo] = useState("");

  // Load saved reminders when the app starts
  useEffect(() => {
    loadReminders().then(setReminders);
  }, []);

  // -------- Step 1 & 2: take/pick a photo and send it to the server --------
  async function pickImage(fromCamera: boolean) {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== "granted") {
      Alert.alert("Permission needed", "Please allow access to continue.");
      return;
    }

    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"],
      quality: 0.6,
      base64: true,
    };
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

    if (res.canceled) return;
    const asset = res.assets[0];
    if (!asset.base64) {
      Alert.alert("Oops", "Could not read that image. Try another.");
      return;
    }

    setPhotoUri(asset.uri);
    await sendToServer(asset.base64, asset.mimeType ?? "image/jpeg");
  }

  async function sendToServer(base64: string, mimeType: string) {
    setScanScreen("loading");
    try {
      const res = await fetch(`${SERVER_URL}/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, mime_type: mimeType }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data: ScanResult = await res.json();

      if (!data.found_document) {
        setScanScreen("home");
        Alert.alert(
          "Couldn't read a bill",
          `That didn't look like a bill or receipt.\n\nAI note: ${data.reasoning || "(none)"}\n\nTry a clear photo of an actual bill, receipt, or report.`,
        );
        return;
      }

      setResult(data);
      setItem(data.item ?? "");
      setActionLabel(data.action_label ?? "Reminder");
      setActionDate(data.action_date ?? "");
      setScanScreen("review");
    } catch (e: any) {
      setScanScreen("home");
      Alert.alert(
        "Connection problem",
        `Couldn't reach the server.\n\n${e.message}\n\nIs the server running, and is SERVER_URL correct in config.ts?`,
      );
    }
  }

  // -------- Step 4 & 5: create the calendar reminder + save it locally --------
  async function addReminder() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(actionDate)) {
      Alert.alert("Check the date", "Use the format YYYY-MM-DD (e.g. 2026-12-01).");
      return;
    }
    // The regex above only checks the SHAPE — it passes impossible dates like
    // 2026-01-32. JS Date silently rolls those over (Jan 32 -> Feb 1), so verify
    // the parts survive a round-trip through Date to catch a non-real date.
    const [yy, mm, dd] = actionDate.split("-").map(Number);
    const probe = new Date(yy, mm - 1, dd);
    if (probe.getFullYear() !== yy || probe.getMonth() !== mm - 1 || probe.getDate() !== dd) {
      Alert.alert("Invalid date", `"${actionDate}" isn't a real calendar date. Check the month and day.`);
      return;
    }

    const perm = await Calendar.requestCalendarPermissionsAsync();
    if (perm.status !== "granted") {
      Alert.alert("Permission needed", "Please allow calendar access to add the reminder.");
      return;
    }

    // Prefer a Google-account calendar — those are the ones the Google Calendar
    // app actually shows. Local/device calendars won't appear there.
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const writable = calendars.filter((c) => c.allowsModifications);
    const isGoogle = (c: any) => {
      const name = (c.source?.name ?? "").toLowerCase();
      const type = String(c.source?.type ?? "").toLowerCase();
      return name.includes("@") || name.includes("google") || type.includes("google");
    };
    const chosen =
      writable.find((c) => isGoogle(c) && c.isPrimary) ||
      writable.find((c) => isGoogle(c)) ||
      writable.find((c) => c.isPrimary) ||
      writable[0];

    if (!chosen) {
      Alert.alert("No calendar", "No writable calendar found on this device.");
      return;
    }

    // 9:00 AM on the action date, alarm 2 days before
    const [y, m, d] = actionDate.split("-").map(Number);
    const start = new Date(y, m - 1, d, 9, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const calName = chosen.title + (chosen.source?.name ? ` · ${chosen.source.name}` : "");

    try {
      const eventId = await Calendar.createEventAsync(chosen.id, {
        title: `${actionLabel}: ${item}`,
        startDate: start,
        endDate: end,
        notes: result?.reasoning ?? "",
        alarms: [{ relativeOffset: -2 * 24 * 60 }], // 2 days (in minutes) before
      });

      // Remember it locally for the "My Reminders" list
      const next = await saveReminder({
        id: String(Date.now()),
        eventId,
        item,
        actionLabel,
        actionDate,
        vendor: result?.vendor ?? null,
        category: result?.category ?? "other",
        savedTo: calName,
        createdAt: new Date().toISOString(),
      });
      setReminders(next);
      setSavedTo(calName);
      setScanScreen("done");
    } catch (e: any) {
      Alert.alert("Couldn't add reminder", e.message);
    }
  }

  // Debug helper: show every calendar on the phone so we can see where events go.
  async function listCalendars() {
    const perm = await Calendar.requestCalendarPermissionsAsync();
    if (perm.status !== "granted") {
      Alert.alert("Permission needed", "Allow calendar access first.");
      return;
    }
    const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const lines = cals
      .map(
        (c) =>
          `• ${c.title}\n   writable: ${c.allowsModifications} | primary: ${c.isPrimary}\n   source: ${c.source?.name ?? "?"} (${c.source?.type ?? "?"})`,
      )
      .join("\n\n");
    Alert.alert(`Calendars on this phone (${cals.length})`, lines || "none found");
  }

  function resetScan() {
    setScanScreen("home");
    setPhotoUri(null);
    setResult(null);
  }

  function confirmDelete(r: SavedReminder) {
    Alert.alert("Delete reminder?", `${r.actionLabel} (${r.actionDate})`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            if (r.eventId) await Calendar.deleteEventAsync(r.eventId);
          } catch {
            // event may already be gone from the calendar — ignore
          }
          const next = await removeReminder(r.id);
          setReminders(next);
        },
      },
    ]);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleSelectMode() {
    setSelectMode((on) => {
      if (on) setSelectedIds([]); // leaving select mode clears the selection
      return !on;
    });
  }

  function deleteSelected() {
    if (selectedIds.length === 0) return;
    Alert.alert("Delete selected?", `${selectedIds.length} reminder(s) will be removed.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const toDelete = reminders.filter((r) => selectedIds.includes(r.id));
          for (const r of toDelete) {
            try {
              if (r.eventId) await Calendar.deleteEventAsync(r.eventId);
            } catch {
              // event may already be gone from the calendar — ignore
            }
          }
          const next = await removeManyReminders(selectedIds);
          setReminders(next);
          setSelectedIds([]);
          setSelectMode(false);
        },
      },
    ]);
  }

  function goTo(target: View_) {
    if (target === "reminders") loadReminders().then(setReminders);
    // Don't strand the user on the "Reminder set!" screen — start the scan tab fresh
    // once a reminder is finished. (In-progress scans/reviews are preserved.)
    if (target === "scan" && scanScreen === "done") resetScan();
    setSelectMode(false);
    setSelectedIds([]);
    setView(target);
    setDrawerOpen(false);
  }

  // ---------------- SCAN VIEW ----------------
  function renderScan() {
    if (scanScreen === "loading") {
      return (
        <View style={styles.center}>
          {photoUri && <Image source={{ uri: photoUri }} style={styles.preview} />}
          <ActivityIndicator size="large" color="#2563eb" style={{ marginTop: 24 }} />
          <Text style={styles.muted}>Reading your bill…</Text>
        </View>
      );
    }

    if (scanScreen === "review" && result) {
      return (
        <ScrollView contentContainerStyle={styles.screen}>
          <Text style={styles.h1}>Check the details</Text>
          <Text style={styles.muted}>The AI read your bill. Fix anything below, then add the reminder.</Text>

          {photoUri && <Image source={{ uri: photoUri }} style={styles.previewSmall} />}

          <Text style={styles.label}>What it is</Text>
          <TextInput style={styles.input} value={item} onChangeText={setItem} />

          <Text style={styles.label}>Reminder</Text>
          <TextInput style={styles.input} value={actionLabel} onChangeText={setActionLabel} />

          <Text style={styles.label}>Due date (YYYY-MM-DD)</Text>
          <TextInput
            style={styles.input}
            value={actionDate}
            onChangeText={setActionDate}
            placeholder="2026-12-01"
            autoCapitalize="none"
          />

          <View style={styles.infoBox}>
            <Text style={styles.infoText}>💡 {result.reasoning}</Text>
            <Text style={styles.infoMuted}>
              Confidence: {result.confidence}
              {result.vendor ? ` · ${result.vendor}` : ""}
            </Text>
            <Text style={styles.infoMuted}>You'll be reminded 2 days before.</Text>
          </View>

          <TouchableOpacity style={styles.primaryBtn} onPress={addReminder}>
            <Text style={styles.primaryBtnText}>Add reminder to calendar</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.linkBtn} onPress={resetScan}>
            <Text style={styles.linkBtnText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      );
    }

    if (scanScreen === "done") {
      return (
        <View style={styles.center}>
          <Text style={styles.bigEmoji}>✅</Text>
          <Text style={styles.h1}>Reminder set!</Text>
          <Text style={styles.muted}>
            Date: {actionDate}{"\n"}
            Calendar: {savedTo || "default"}{"\n\n"}
            You'll get an alert 2 days before — even with the app closed.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={resetScan}>
            <Text style={styles.primaryBtnText}>Scan another bill</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.linkBtn} onPress={() => goTo("reminders")}>
            <Text style={styles.linkBtnText}>See my reminders</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // home
    return (
      <View style={styles.center}>
        <Text style={styles.bigEmoji}>🧾</Text>
        <Text style={styles.h1}>Bill Reminder</Text>
        <Text style={styles.muted}>
          Snap a bill, receipt, or report. AI figures out when you need to act and reminds you.
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => pickImage(true)}>
          <Text style={styles.primaryBtnText}>📷 Take a photo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => pickImage(false)}>
          <Text style={styles.secondaryBtnText}>🖼️ Upload from gallery</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkBtn} onPress={listCalendars}>
          <Text style={styles.linkBtnText}>🔧 Show my calendars (debug)</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ---------------- REMINDERS VIEW ----------------
  function renderReminders() {
    if (reminders.length === 0) {
      return (
        <View style={styles.center}>
          <Text style={styles.bigEmoji}>📭</Text>
          <Text style={styles.muted}>No reminders yet. Scan a bill to create one.</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => goTo("scan")}>
            <Text style={styles.primaryBtnText}>📷 Scan a bill</Text>
          </TouchableOpacity>
        </View>
      );
    }

    const filtered = filterReminders(reminders, query, dateFilter);
    const today = new Date().toISOString().slice(0, 10);

    return (
      <View style={{ flex: 1 }}>
        {/* Search + date filter + select toggle */}
        <View style={styles.controls}>
          <TextInput
            style={styles.search}
            placeholder="Search item, vendor, or date…"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />
          <View style={styles.chipRow}>
            {(["all", "upcoming", "past"] as const).map((f) => (
              <TouchableOpacity
                key={f}
                onPress={() => setDateFilter(f)}
                style={[styles.chip, dateFilter === f && styles.chipActive]}
              >
                <Text style={[styles.chipText, dateFilter === f && styles.chipTextActive]}>
                  {f === "all" ? "All" : f === "upcoming" ? "Upcoming" : "Past"}
                </Text>
              </TouchableOpacity>
            ))}
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={toggleSelectMode} style={styles.selectBtn}>
              <Text style={styles.selectBtnText}>{selectMode ? "Cancel" : "Select"}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {filtered.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.muted}>No reminders match your search.</Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(r) => r.id}
            contentContainerStyle={{ padding: 16, paddingBottom: selectMode ? 90 : 16 }}
            renderItem={({ item: r }) => {
              const selected = selectedIds.includes(r.id);
              const isPast = r.actionDate < today;
              return (
                <TouchableOpacity
                  activeOpacity={selectMode ? 0.7 : 1}
                  delayLongPress={300}
                  onLongPress={() => {
                    // Hold an item to enter multi-select mode (and select it)
                    if (!selectMode) {
                      setSelectMode(true);
                      toggleSelect(r.id);
                    }
                  }}
                  onPress={() => (selectMode ? toggleSelect(r.id) : undefined)}
                  style={[
                    styles.card,
                    isPast ? styles.cardPast : styles.cardUpcoming,
                    selected && styles.cardSelected,
                  ]}
                >
                  <View style={styles.cardRow}>
                    {selectMode && (
                      <Text style={styles.checkbox}>{selected ? "☑️" : "⬜️"}</Text>
                    )}
                    <View style={{ flex: 1 }}>
                      <View style={styles.cardTopRow}>
                        <Text style={[styles.cardTitle, { flex: 1, marginRight: 8 }]}>
                          {r.actionLabel}
                        </Text>
                        <View style={[styles.badge, isPast ? styles.badgePast : styles.badgeUpcoming]}>
                          <Text
                            style={[
                              styles.badgeText,
                              isPast ? styles.badgeTextPast : styles.badgeTextUpcoming,
                            ]}
                          >
                            {isPast ? "⏰ Past due" : "🟢 Upcoming"}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.cardItem}>{r.item}</Text>
                      <Text style={[styles.cardDate, isPast && styles.cardDatePast]}>
                        📅 {r.actionDate}  ·  alert 2 days before
                      </Text>
                      {r.vendor ? <Text style={styles.cardMuted}>{r.vendor}</Text> : null}
                      {!selectMode && (
                        <TouchableOpacity onPress={() => confirmDelete(r)} style={styles.deleteBtn}>
                          <Text style={styles.deleteBtnText}>Delete</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        )}

        {/* Multi-delete bar */}
        {selectMode && (
          <View style={styles.bottomBar}>
            <Text style={styles.bottomBarText}>{selectedIds.length} selected</Text>
            <TouchableOpacity
              style={[styles.bottomDeleteBtn, selectedIds.length === 0 && styles.bottomDeleteDisabled]}
              onPress={deleteSelected}
              disabled={selectedIds.length === 0}
            >
              <Text style={styles.bottomDeleteText}>Delete selected</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }

  // ---------------- ROOT ----------------
  return (
    <View style={styles.root}>
      <StatusBar style="dark" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setDrawerOpen(true)} style={styles.hamburger}>
          <Text style={styles.hamburgerText}>☰</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{view === "scan" ? "Bill Reminder" : "My Reminders"}</Text>
      </View>

      {/* Content */}
      <View style={{ flex: 1 }}>{view === "scan" ? renderScan() : renderReminders()}</View>

      {/* Left drawer */}
      {drawerOpen && (
        <>
          <TouchableOpacity
            style={styles.overlay}
            activeOpacity={1}
            onPress={() => setDrawerOpen(false)}
          />
          <View style={styles.drawer}>
            <Text style={styles.drawerHeader}>🧾 Bill Reminder</Text>
            <TouchableOpacity
              style={[styles.drawerItem, view === "scan" && styles.drawerItemActive]}
              onPress={() => goTo("scan")}
            >
              <Text style={styles.drawerItemText}>📷 Scan a bill</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.drawerItem, view === "reminders" && styles.drawerItemActive]}
              onPress={() => goTo("reminders")}
            >
              <Text style={styles.drawerItemText}>📋 My reminders ({reminders.length})</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 48,
    paddingBottom: 12,
    paddingHorizontal: 12,
    backgroundColor: "#fff",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  hamburger: { padding: 6, marginRight: 6 },
  hamburgerText: { fontSize: 24, color: "#111" },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#111" },

  screen: { padding: 24, paddingTop: 24, backgroundColor: "#fff", flexGrow: 1 },
  center: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  bigEmoji: { fontSize: 64, marginBottom: 8 },
  h1: { fontSize: 26, fontWeight: "700", color: "#111", marginBottom: 8, textAlign: "center" },
  muted: { fontSize: 15, color: "#666", textAlign: "center", marginBottom: 24, lineHeight: 22 },
  label: { fontSize: 13, fontWeight: "600", color: "#444", marginTop: 16, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: "#111",
  },
  primaryBtn: {
    backgroundColor: "#2563eb",
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    width: "100%",
    alignItems: "center",
    marginTop: 24,
  },
  primaryBtnText: { color: "#fff", fontSize: 17, fontWeight: "600" },
  secondaryBtn: {
    backgroundColor: "#eef2ff",
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    width: "100%",
    alignItems: "center",
    marginTop: 12,
  },
  secondaryBtnText: { color: "#2563eb", fontSize: 17, fontWeight: "600" },
  linkBtn: { padding: 12, alignItems: "center", marginTop: 8 },
  linkBtnText: { color: "#888", fontSize: 15 },
  preview: { width: 200, height: 260, borderRadius: 12, resizeMode: "cover" },
  previewSmall: { width: "100%", height: 180, borderRadius: 12, resizeMode: "cover", marginTop: 16 },
  infoBox: { backgroundColor: "#f8fafc", borderRadius: 10, padding: 14, marginTop: 20 },
  infoText: { fontSize: 14, color: "#334155", lineHeight: 20 },
  infoMuted: { fontSize: 13, color: "#64748b", marginTop: 6 },

  // Reminder cards
  card: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: { fontSize: 16, fontWeight: "700", color: "#111" },
  cardItem: { fontSize: 15, color: "#334155", marginTop: 2 },
  cardDate: { fontSize: 14, color: "#2563eb", marginTop: 8 },
  cardMuted: { fontSize: 13, color: "#94a3b8", marginTop: 4 },
  deleteBtn: { marginTop: 12, alignSelf: "flex-start" },
  deleteBtnText: { color: "#dc2626", fontSize: 14, fontWeight: "600" },
  cardRow: { flexDirection: "row", alignItems: "flex-start" },
  cardTopRow: { flexDirection: "row", alignItems: "center" },
  cardSelected: { borderColor: "#2563eb", backgroundColor: "#eff6ff" },
  checkbox: { fontSize: 20, marginRight: 10, marginTop: 2 },

  // Past-due vs upcoming accents
  cardPast: { borderLeftWidth: 4, borderLeftColor: "#f59e0b", backgroundColor: "#fffbeb" },
  cardUpcoming: { borderLeftWidth: 4, borderLeftColor: "#16a34a" },
  cardDatePast: { color: "#b45309" },
  badge: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 12 },
  badgePast: { backgroundColor: "#fef3c7" },
  badgeUpcoming: { backgroundColor: "#dcfce7" },
  badgeText: { fontSize: 11, fontWeight: "700" },
  badgeTextPast: { color: "#b45309" },
  badgeTextUpcoming: { color: "#15803d" },

  // Search + filters
  controls: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, backgroundColor: "#fff" },
  search: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#111",
    backgroundColor: "#f9fafb",
  },
  chipRow: { flexDirection: "row", alignItems: "center", marginTop: 10 },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: "#f1f5f9",
    marginRight: 8,
  },
  chipActive: { backgroundColor: "#2563eb" },
  chipText: { fontSize: 13, color: "#475569", fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  selectBtn: { paddingVertical: 6, paddingHorizontal: 12 },
  selectBtnText: { fontSize: 14, color: "#2563eb", fontWeight: "600" },

  // Multi-delete bar
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#fff",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e5e7eb",
  },
  bottomBarText: { fontSize: 15, color: "#334155", fontWeight: "600" },
  bottomDeleteBtn: {
    backgroundColor: "#dc2626",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  bottomDeleteDisabled: { backgroundColor: "#fca5a5" },
  bottomDeleteText: { color: "#fff", fontWeight: "700", fontSize: 15 },

  // Drawer
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  drawer: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    width: "76%",
    backgroundColor: "#fff",
    paddingTop: 56,
    paddingHorizontal: 16,
    shadowColor: "#000",
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 16,
  },
  drawerHeader: { fontSize: 20, fontWeight: "700", color: "#111", marginBottom: 24, paddingHorizontal: 8 },
  drawerItem: { paddingVertical: 14, paddingHorizontal: 12, borderRadius: 10, marginBottom: 4 },
  drawerItemActive: { backgroundColor: "#eef2ff" },
  drawerItemText: { fontSize: 16, color: "#111", fontWeight: "500" },
});
