import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ImageProps,
  type ImageSourcePropType,
  type TextInputProps,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

export function AppBackNavigation({ label, onBack, actions }: { label: string; onBack: () => void; actions?: ReactNode }) {
  return <View style={{ minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onBack} style={({ pressed }) => [{ minHeight: 42, minWidth: 0, maxWidth: "82%", flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 4, paddingRight: 14, borderRadius: 24, backgroundColor: "#edf8f5" }, pressed && { opacity: 0.72 }]}>
      <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffffd9" }}><Ionicons name="chevron-back" size={20} color={colors.teal} /></View>
      <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.teal, fontSize: 14, fontWeight: "700" }}>{label}</Text>
    </Pressable>
    {!!actions && <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>{actions}</View>}
  </View>;
}

export function PhotoViewer({
  source,
  label,
  style,
  resizeMode = "cover",
  onError,
}: {
  source: ImageSourcePropType;
  label: string;
  style?: ImageProps["style"];
  resizeMode?: ImageProps["resizeMode"];
  onError?: ImageProps["onError"];
}) {
  const [visible, setVisible] = useState(false);
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`View ${label} full screen`} accessibilityHint="Opens this photo full screen" onPress={() => setVisible(true)} style={{ position: "relative" }}>
      <Image source={source} accessibilityLabel={label} resizeMode={resizeMode} style={style} onError={onError} />
      <View pointerEvents="none" style={{ position: "absolute", right: 6, bottom: 6, width: 25, height: 25, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffffed" }}><Ionicons name="expand-outline" size={14} color={colors.navy} /></View>
    </Pressable>
    {visible && <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => setVisible(false)}>
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#06111eee" }}>
        <Image source={source} accessibilityLabel={label} resizeMode="contain" style={{ width: "100%", height: "100%" }} />
        <Pressable accessibilityRole="button" accessibilityLabel="Close photo" onPress={() => setVisible(false)} style={{ position: "absolute", top: 48, right: 18, width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffffed" }}>
          <Ionicons name="close" size={25} color={colors.navy} />
        </Pressable>
        <Text pointerEvents="none" style={{ position: "absolute", bottom: 28, color: "white", fontSize: 12, fontWeight: "600" }}>Tap close to return</Text>
      </View>
    </Modal>}
  </>;
}

export function categoryDisplayName(name: string): string {
  const value = name.toLowerCase();
  return value.includes("streetlight") ? "Streetlights"
    : value.includes("sign") || value.includes("marking") ? "Road signs"
    : value.includes("pothole") || value.includes("road") ? "Roads"
    : value.includes("drain") ? "Drainage"
    : value.includes("wire") ? "Wires"
    : value.includes("garbage") || value.includes("waste") ? "Garbage"
    : name;
}

export function categoryIconFor(name: string): IconName {
  const value = name.toLowerCase();
  return value.includes("light") ? "bulb-outline"
    : value.includes("sign") || value.includes("marking") ? "navigate-outline"
    : value.includes("road") || value.includes("pothole") ? "car-outline"
    : value.includes("drain") || value.includes("water") ? "water-outline"
    : value.includes("garbage") || value.includes("waste") ? "trash-outline"
    : value.includes("wire") ? "flash-outline"
    : "alert-circle-outline";
}

export function categoryDescriptionFor(name: string): string {
  const value = name.toLowerCase();
  return value.includes("light") ? "Report broken or defective streetlights"
    : value.includes("sign") || value.includes("marking") ? "Report missing or damaged road signage"
    : value.includes("road") || value.includes("pothole") ? "Report damaged roads and potholes"
    : value.includes("drain") ? "Report drainage and flooding concerns"
    : value.includes("wire") ? "Report hazardous or obsolete wires"
    : value.includes("garbage") || value.includes("waste") ? "Report garbage and waste concerns"
    : "Report a local issue for city staff to review";
}

export function problemDescriptionFor(category: string, problem: string): string {
  const value = problem.toLowerCase(), kind = category.toLowerCase();
  if (value.includes("other")) return "Describe an issue that is not listed."
  if (value.includes("overflow") && (kind.includes("garbage") || kind.includes("waste"))) return "A public bin is full or waste is spilling out."
  if (value.includes("not working") || value.includes("not functioning")) return "The streetlight does not turn on at night."
  if (value.includes("flicker")) return "The light turns on and off repeatedly."
  if (value.includes("day")) return "The streetlight stays on during daylight."
  if (value.includes("no streetlight") || value.includes("missing light")) return "There is no streetlight in this area."
  if (value.includes("clog") || value.includes("block")) return "Water cannot flow through the drain."
  if (value.includes("overflow")) return "Water spills out of the drainage channel."
  if (value.includes("stagnant")) return "Water remains pooled and does not drain."
  if (value.includes("uncovered") || value.includes("open drain")) return "An exposed drain may create a safety hazard."
  if (value.includes("leak")) return "Water is escaping from a pipe or channel."
  if (value.includes("pothole")) return "A road hole may damage vehicles or injure road users."
  if (value.includes("crack")) return "A road surface is cracked or breaking apart."
  if (value.includes("dump")) return "Waste has been left in an unauthorized area."
  if (value.includes("wire") || kind.includes("wire")) return "A wire may be damaged, tangled, or unsafe."
  return `Help city staff route this ${categoryDisplayName(category).toLowerCase()} report.`;
}

export function problemIconFor(category: string, problem: string): IconName {
  const kind = category.toLowerCase(), value = problem.toLowerCase();
  if (value.includes("other")) return "create-outline";
  if (kind.includes("light")) return value.includes("damage") || value.includes("broken") ? "construct-outline" : value.includes("no streetlight") || value.includes("missing") ? "location-outline" : "bulb-outline";
  if (kind.includes("drain") || kind.includes("water")) return value.includes("damage") || value.includes("broken") ? "construct-outline" : value.includes("open") || value.includes("uncovered") ? "warning-outline" : "water-outline";
  if (kind.includes("road") || kind.includes("pothole")) return value.includes("sign") || value.includes("marking") ? "navigate-outline" : "car-outline";
  if (kind.includes("garbage") || kind.includes("waste")) return "trash-outline";
  if (kind.includes("wire")) return "flash-outline";
  return categoryIconFor(category);
}

export function categoryToneFor(name: string) {
  const value = name.toLowerCase();
  return value.includes("light") ? { background: "#fff3d8", foreground: "#8a5d00" }
    : value.includes("road") || value.includes("pothole") ? { background: "#e6f3fc", foreground: "#2878a8" }
    : value.includes("water") || value.includes("drain") ? { background: "#e5f5fa", foreground: "#08728b" }
    : value.includes("waste") || value.includes("garbage") ? { background: "#edf3e8", foreground: "#527239" }
    : value.includes("wire") ? { background: "#fff0e2", foreground: "#995219" }
    : value.includes("sign") || value.includes("marking") ? { background: "#eeeffa", foreground: "#545d98" }
    : { background: "#e9f1f4", foreground: "#416371" };
}

export function statusToneFor(status: string) {
  const value = status.toLowerCase();
  return value.includes("resolved") || value.includes("completed")
    ? { background: "#e5f3e9", foreground: "#286b3b" }
    : value.includes("rejected") || value.includes("cancelled")
      ? { background: "#ffefed", foreground: "#a43d35" }
      : value.includes("pending") || value.includes("review")
        ? { background: "#fff3dc", foreground: "#865a0b" }
        : { background: "#e9f0fa", foreground: "#3c5f93" };
}

export const colors = {
  navy: "#12343d",
  teal: "#08756b",
  paper: "#f3f7f5",
  muted: "#5d7378",
  line: "#d8e4e0",
  mint: "#b8e6d4",
  surface: "#fff",
};

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  scroll: {
    padding: 18,
    gap: 12,
    // Keep the final form action clear of the fixed resident navigation bar.
    paddingBottom: 124,
    width: "100%",
    maxWidth: 620,
    alignSelf: "center",
  },
  heading: { fontSize: 25, lineHeight: 31, fontWeight: "700", color: colors.navy, letterSpacing: -0.6 },
  subtitle: { fontSize: 14, lineHeight: 21, color: colors.muted },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 1.5, color: colors.teal },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    shadowColor: colors.navy,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.045,
    shadowRadius: 12,
    elevation: 1,
  },
  title: { fontSize: 17, fontWeight: "700", color: colors.navy },
  body: { fontSize: 15, lineHeight: 22, color: colors.navy },
  small: { fontSize: 12, lineHeight: 18, color: colors.muted },
  input: {
    borderWidth: 1,
    borderColor: "#cbd9d5",
    backgroundColor: "#fbfcfb",
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderRadius: 12,
    fontSize: 16,
    color: colors.navy,
    minHeight: 52,
  },
  inputFrame: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#cbd9d5",
    backgroundColor: "#fbfcfb",
    borderRadius: 12,
    paddingRight: 14,
  },
  inputActionInput: { flex: 1, minHeight: 52, borderWidth: 0, backgroundColor: "transparent" },
  inputAction: { padding: 6 },
  inputActionText: { color: colors.teal, fontWeight: "700", fontSize: 13 },
  fieldLabel: { color: colors.navy, fontSize: 13, fontWeight: "600" },
  button: {
    backgroundColor: colors.teal,
    paddingHorizontal: 16,
    minHeight: 52,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: "white", fontWeight: "700", fontSize: 15 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 9, alignItems: "center" },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 8 },
  actionRow: { flexDirection: "row", alignItems: "stretch", gap: 10, width: "100%" },
  chip: {
    width: "48%",
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: colors.surface,
    minHeight: 54,
    justifyContent: "center",
  },
  selected: { backgroundColor: "#e3f2eb", borderColor: colors.teal },
  error: { color: "#a93030", backgroundColor: "#fff0ee", padding: 13, borderRadius: 9 },
  nav: {
    flexDirection: "row",
    marginHorizontal: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "#e4eff0",
    borderRadius: 25,
    backgroundColor: colors.surface,
    paddingHorizontal: 5,
    paddingTop: 8,
    paddingBottom: 4,
    shadowColor: colors.navy,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 18,
    elevation: 4,
  },
  navItem: {
    flex: 1,
    minHeight: 66,
    paddingVertical: 5,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    borderRadius: 17,
  },
  navItemActive: { backgroundColor: "#e5f6f2" },
  navAction: { width: 58, height: 58, marginTop: -23, marginBottom: -1, borderRadius: 29, backgroundColor: "#008d86", alignItems: "center", justifyContent: "center", shadowColor: "#008d86", shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.24, shadowRadius: 9, elevation: 5 },
  navActionActive: { backgroundColor: "#073f47" },
  navText: { fontSize: 11, color: colors.muted, fontWeight: "600" },
  hero: { backgroundColor: colors.navy, padding: 17, borderRadius: 18, minHeight: 120, flexDirection: "row", alignItems: "center", gap: 12, overflow: "hidden" },
  heroCopy: { flex: 1, gap: 5 },
  heroKicker: { color: colors.mint, fontSize: 10, fontWeight: "700", letterSpacing: 1.2 },
  heroAction: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.teal, alignItems: "center", justifyContent: "center" },
  reportListItem: { flexDirection: "row", alignItems: "center", gap: 12, padding: 13, borderRadius: 15, borderWidth: 1, borderColor: colors.line, backgroundColor: "white" },
  statusBadge: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  pill: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: "#e4f2eb" },
  divider: { height: 1, backgroundColor: colors.line },
  step: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.line },
  empty: { padding: 24, alignItems: "center", gap: 12 },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10 },
  segmented: { flexDirection: "row", gap: 3, padding: 4, borderRadius: 15, backgroundColor: "#e8f0ed" },
  segment: { flex: 1, minHeight: 48, paddingHorizontal: 5, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  segmentActive: { backgroundColor: "white", shadowColor: colors.navy, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 1 },
  notificationItem: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, backgroundColor: "white" },
  notificationIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: "#e9f4ef", alignItems: "center", justifyContent: "center" },
  categoryCard: { width: "48%", minHeight: 78, padding: 11, borderRadius: 16, backgroundColor: colors.surface, flexDirection: "row", alignItems: "center", gap: 9 },
  categoryIcon: { width: 34, height: 34, borderRadius: 12, backgroundColor: "#e7f4ed", alignItems: "center", justifyContent: "center" },
  categoryLabel: { flex: 1, color: colors.navy, fontSize: 12, lineHeight: 16, fontWeight: "600" },
  reportCategory: { width: "48.5%", minHeight: 74, padding: 10, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, flexDirection: "row", alignItems: "center", gap: 8 },
  reportCategorySelected: { backgroundColor: "#eaf5ef", borderColor: colors.teal },
  locationPill: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6, borderWidth: 1, borderColor: colors.line, backgroundColor: "white", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  authScroll: { flexGrow: 1, width: "100%", maxWidth: 560, alignSelf: "center", paddingBottom: 22 },
  authHero: { backgroundColor: colors.navy, padding: 24, paddingTop: 20, gap: 17 },
  authBrand: { flexDirection: "row", alignItems: "center", gap: 11 },
  authBrandIcon: { width: 42, height: 42, borderRadius: 15, backgroundColor: "#23545a", alignItems: "center", justifyContent: "center" },
  authBrandName: { color: "white", fontSize: 13, fontWeight: "800", letterSpacing: 1.7 },
  authBrandPlace: { color: "#b8d3cd", fontSize: 11, marginTop: 3 },
  authCopy: { gap: 9, maxWidth: 420 },
  authKicker: { color: colors.mint, fontSize: 10, fontWeight: "700", letterSpacing: 1.4 },
  authTitle: { color: "white", fontSize: 30, lineHeight: 36, fontWeight: "800", letterSpacing: -0.7 },
  authSubtitle: { color: "#d0e0dc", fontSize: 14, lineHeight: 21 },
  authPanel: { flexGrow: 1, backgroundColor: colors.paper, borderTopLeftRadius: 26, borderTopRightRadius: 26, marginTop: -10, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 20, gap: 13 },
  authCard: { maxWidth: 480, width: "100%", alignSelf: "center", padding: 20, gap: 15 },
  authCardHeading: { gap: 5, marginBottom: 1 },
  authTitleText: { color: colors.navy, fontSize: 21, fontWeight: "700" },
  authFoot: { textAlign: "center", maxWidth: 410, alignSelf: "center" },
  textAction: { minHeight: 44, alignItems: "center", justifyContent: "center", padding: 8 },
  textActionLabel: { color: colors.teal, fontWeight: "700", fontSize: 14 },
});

export function Button({
  title,
  onPress,
  disabled = false,
  secondary = false,
  loading = false,
  grow = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  loading?: boolean;
  grow?: boolean;
}) {
  const unavailable = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: unavailable, busy: loading }}
      disabled={unavailable}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        grow && { flex: 1, minWidth: 0 },
        secondary && { backgroundColor: "white", borderWidth: 1, borderColor: colors.line },
        unavailable && { opacity: 0.5 },
        pressed && !unavailable && { opacity: 0.82, transform: [{ scale: 0.99 }] },
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 }}>
        {loading && <ActivityIndicator size="small" color={secondary ? colors.teal : "white"} />}
        <Text style={[styles.buttonText, secondary && { color: colors.teal }]}>{title}</Text>
      </View>
    </Pressable>
  );
}

export function Field({
  label,
  style,
  leading,
  trailing,
  ...props
}: TextInputProps & { label: string; leading?: ReactNode; trailing?: ReactNode }) {
  return (
    <View style={{ gap: 7 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={leading || trailing ? [styles.inputFrame, props.multiline && { alignItems: "flex-start" }] : undefined}>
        {leading && <View style={{ paddingLeft: 14, paddingTop: props.multiline ? 15 : 0, alignItems: "center", justifyContent: props.multiline ? "flex-start" : "center" }}>{leading}</View>}
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor="#849397"
          style={[
            styles.input,
            leading || trailing ? styles.inputActionInput : undefined,
            props.multiline && { minHeight: 110, textAlignVertical: "top" },
            style,
          ]}
          {...props}
        />
        {trailing}
      </View>
    </View>
  );
}

export function Choices({
  items,
  value,
  onChange,
  compact = false,
  columns = 2,
  grow = false,
  title = "Choose a barangay",
  placeholder,
  leadingIcon,
  shortCategoryNames = false,
  sheetKind,
  categoryName = "",
  subtitle,
  sheetTitle,
}: {
  items: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
  compact?: boolean;
  columns?: 2 | 3;
  grow?: boolean;
  title?: string;
  placeholder?: string;
  leadingIcon?: IconName;
  shortCategoryNames?: boolean;
  sheetKind?: "category" | "problem" | "barangay" | "generic";
  categoryName?: string;
  subtitle?: string;
  sheetTitle?: string;
}) {
  const [open, setOpen] = useState(false), selectedName = items.find((i) => i.id === value)?.name;
  if (compact || items.length > 10)
    return (
      <>
        <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityHint="Opens a searchable selection" onPress={() => setOpen(true)} style={({ pressed }) => [{ flex: grow ? 1 : undefined, minWidth: 0, minHeight: 58, borderRadius: 18, borderWidth: 1, borderColor: "#e3edf0", backgroundColor: "white", paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 9, shadowColor: colors.navy, shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 }, pressed && { opacity: 0.78 }]}>
          {leadingIcon && <Ionicons name={leadingIcon} size={19} color={colors.teal} />}
          <Text numberOfLines={1} style={{ flex: 1, color: colors.navy, fontSize: 14, fontWeight: "700" }}>{selectedName ? (shortCategoryNames ? categoryDisplayName(selectedName) : selectedName) : placeholder || title}</Text>
          <Ionicons name="chevron-down" size={16} color={colors.muted} />
        </Pressable>
        <SelectionSheet
          visible={open}
          onClose={() => setOpen(false)}
          title={sheetTitle || title}
          subtitle={subtitle || (shortCategoryNames ? "Select the category that best matches the issue." : "Choose an option to continue.")}
          searchPlaceholder={shortCategoryNames ? "Search report type" : title.toLowerCase().includes("problem") ? "Search problems" : "Search barangay"}
          items={items.map((item) => {
            const kind = sheetKind || (shortCategoryNames ? "category" : title.toLowerCase().includes("problem") ? "problem" : items.length > 10 ? "barangay" : "generic");
            const tone = kind === "problem" ? categoryToneFor(categoryName) : kind === "category" ? (item.id ? categoryToneFor(item.name) : { background: "#e5f6f2", foreground: colors.teal }) : { background: "#e5f6f2", foreground: colors.teal };
            const icon = kind === "problem" ? problemIconFor(categoryName, item.name) : kind === "category" ? (item.id ? categoryIconFor(item.name) : "grid-outline") : kind === "barangay" ? "location-outline" : leadingIcon || "chevron-forward";
            return {
              ...item,
              description: kind === "category" ? (item.id ? categoryDescriptionFor(item.name) : "View all report categories") : kind === "problem" ? problemDescriptionFor(categoryName, item.name) : kind === "barangay" ? (item.id ? `Browse public reports in ${item.name}` : "Browse reports across Iligan City") : undefined,
              icon: kind === "barangay" && !item.id ? "grid-outline" : icon,
              tone,
              featured: (kind === "category" || kind === "barangay") && !item.id,
            };
          })}
          value={value}
          onConfirm={onChange}
        />
      </>
    );
  return columns === 3 ? (
    <View style={styles.segmented}>
      {items.map((i) => (
        <Pressable
          key={i.id}
          accessibilityRole="button"
          accessibilityState={{ selected: value === i.id }}
          onPress={() => onChange(i.id)}
          style={[styles.segment, value === i.id && styles.segmentActive]}
        >
          <Text style={[styles.small, { textAlign: "center" }, value === i.id && { color: colors.teal, fontWeight: "700" }]}>
            {shortCategoryNames ? categoryDisplayName(i.name) : i.name}
          </Text>
        </Pressable>
      ))}
    </View>
  ) : (
    <View style={styles.choiceRow}>
      {items.map((i) => (
        <Pressable key={i.id} accessibilityRole="button" accessibilityState={{ selected: value === i.id }} onPress={() => onChange(i.id)} style={[styles.chip, value === i.id && styles.selected]}>
          <Text style={[styles.small, value === i.id && { color: colors.teal, fontWeight: "700" }]}>{shortCategoryNames ? categoryDisplayName(i.name) : i.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

type SelectionTone = { background: string; foreground: string };
type SelectionItem = { id: string; name: string; description?: string; icon?: IconName; tone?: SelectionTone; featured?: boolean };

export function SelectionSheet({
  visible,
  onClose,
  title,
  subtitle,
  items,
  value,
  onConfirm,
  searchPlaceholder = "Search",
  confirmLabel = "Confirm selection",
  loading = false,
  error,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  items: SelectionItem[];
  value: string;
  onConfirm: (id: string) => void | boolean | Promise<void | boolean>;
  searchPlaceholder?: string;
  confirmLabel?: string;
  loading?: boolean;
  error?: string;
}) {
  const [draft, setDraft] = useState(value), [search, setSearch] = useState("");
  useEffect(() => {
    if (visible) { setDraft(value); setSearch(""); }
  }, [visible, value]);
  if (!visible) return null;
  const filteredItems = items.filter((item) => `${item.name} ${item.description || ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  const hasSelection = items.some((item) => item.id === draft);
  async function confirm() {
    if (!hasSelection || loading) return;
    const result = await onConfirm(draft);
    if (result !== false) onClose();
  }
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#10263f77" }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close selection" onPress={onClose} style={{ ...StyleSheet.absoluteFillObject }} />
        <View style={{ maxHeight: "90%", paddingTop: 10, paddingHorizontal: 18, paddingBottom: 26, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: "#fff", gap: 14 }}>
          <View style={{ alignSelf: "center", width: 48, height: 5, borderRadius: 3, backgroundColor: "#c8d2df" }} />
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <Text accessibilityRole="header" style={{ color: "#10263f", fontSize: 22, lineHeight: 28, fontWeight: "800", letterSpacing: -0.3 }}>{title}</Text>
              {!!subtitle && <Text style={{ color: "#71859b", fontSize: 14, lineHeight: 20 }}>{subtitle}</Text>}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close selection" onPress={onClose} style={({ pressed }) => [{ width: 42, height: 42, borderRadius: 21, backgroundColor: "#eff3f8", alignItems: "center", justifyContent: "center" }, pressed && { opacity: 0.7 }]}>
              <Ionicons name="close" size={21} color="#71859b" />
            </Pressable>
          </View>
          <View style={{ minHeight: 52, borderRadius: 16, borderWidth: 1, borderColor: "#dbe5ee", backgroundColor: "#fff", paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Ionicons name="search-outline" size={20} color="#71859b" />
            <TextInput accessibilityLabel={searchPlaceholder} placeholder={searchPlaceholder} placeholderTextColor="#879bb0" value={search} onChangeText={setSearch} returnKeyType="search" style={{ flex: 1, minWidth: 0, minHeight: 48, color: "#10263f", fontSize: 15 }} />
          </View>
          <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, paddingBottom: 2 }}>
            {filteredItems.map((item) => {
              const selected = draft === item.id, tone = item.tone || { background: "#e5f6f2", foreground: colors.teal };
              return <Pressable key={item.id} accessibilityRole="radio" accessibilityLabel={`${item.name}${item.description ? `. ${item.description}` : ""}`} accessibilityState={{ selected, disabled: loading }} disabled={loading} onPress={() => setDraft(item.id)} style={({ pressed }) => [{ minHeight: item.featured ? 76 : 72, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 18, borderWidth: 1, borderColor: selected ? "#b9e7df" : "#e2eaf2", backgroundColor: selected ? "#f0faf8" : "#fff", flexDirection: "row", alignItems: "center", gap: 12 }, pressed && { opacity: 0.8 }]}>
                <View style={{ width: 50, height: 50, borderRadius: 18, backgroundColor: tone.background, alignItems: "center", justifyContent: "center" }}><Ionicons name={item.icon || "location-outline"} size={24} color={tone.foreground} /></View>
                <View style={{ flex: 1, minWidth: 0, gap: item.description ? 3 : 0 }}>
                  <Text numberOfLines={2} style={{ color: selected ? tone.foreground : "#10263f", fontSize: 15, lineHeight: 19, fontWeight: "700" }}>{item.name}</Text>
                  {!!item.description && <Text numberOfLines={2} style={{ color: "#71859b", fontSize: 12, lineHeight: 17 }}>{item.description}</Text>}
                </View>
                {selected ? <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: tone.foreground, alignItems: "center", justifyContent: "center" }}><Ionicons name="checkmark" size={17} color="white" /></View> : <Ionicons name="chevron-forward" size={19} color="#879bb0" />}
              </Pressable>;
            })}
            {!filteredItems.length && <View style={{ paddingVertical: 18, alignItems: "center" }}><Text style={{ color: "#71859b", fontSize: 14 }}>No matches found. Try another search.</Text></View>}
          </ScrollView>
          {error ? <Text accessibilityRole="alert" style={{ color: "#a43d35", fontSize: 13 }}>{error}</Text> : null}
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: !hasSelection || loading, busy: loading }} disabled={!hasSelection || loading} onPress={() => void confirm()} style={({ pressed }) => [{ minHeight: 54, borderRadius: 16, backgroundColor: "#008d86", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 9, opacity: !hasSelection || loading ? 0.5 : 1 }, pressed && !loading && { opacity: 0.84 }]}>
            {loading ? <ActivityIndicator size="small" color="white" /> : <Ionicons name="checkmark-circle-outline" size={20} color="white" />}
            <Text style={{ color: "white", fontSize: 15, fontWeight: "800" }}>{loading ? "Saving…" : confirmLabel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function CategoryChoices({
  items,
  value,
  onChange,
}: {
  items: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  return (
    <View style={styles.categoryGrid}>
      {items.map((item) => {
        const selected = value === item.id;
        const baseTone = categoryToneFor(item.name);
        const tone = /road|pothole/i.test(item.name) ? { background: "#e6f3fc", foreground: "#2878a8" } : baseTone;
        const isHovered = hovered === item.id;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onHoverIn={() => setHovered(item.id)}
            onHoverOut={() => setHovered((current) => current === item.id ? null : current)}
            onPress={() => onChange(item.id)}
            style={({ pressed }) => [styles.reportCategory, { borderColor: selected ? tone.foreground : "#e4eff0", backgroundColor: selected ? tone.background : isHovered ? "#f8fbfa" : "white" }, pressed && { opacity: 0.82 }]}
          >
            <View style={[styles.categoryIcon, { width: 42, height: 42, borderRadius: 21, backgroundColor: tone.background }]}>
              <Ionicons name={categoryIconFor(item.name)} size={21} color={tone.foreground} />
            </View>
            <Text style={[styles.categoryLabel, { fontSize: 13, lineHeight: 17 }, selected && { color: tone.foreground }]}>
              {categoryDisplayName(item.name)}
            </Text>
            <Ionicons name="chevron-forward" size={17} color="#91a2b1" />
          </Pressable>
        );
      })}
    </View>
  );
}
