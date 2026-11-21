import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type KeyboardEvent } from "react";
import { ActivityIndicator, BackHandler, Platform, Text, View, Image, Linking, Pressable, TextInput, Modal, ScrollView, Share, useWindowDimensions } from "react-native";
import type { Region } from "react-native-maps";
import Ionicons from "@expo/vector-icons/Ionicons";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { randomUUID } from "expo-crypto";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createReportSchema,
  ILIGAN_MAP_BOUNDS,
  ReportInput,
  Report,
  Status,
  Lookup,
  Profile,
  label,
  reportStatusLabel,
  reportStatusDescription,
  reportScheduleLabel,
  distanceMeters,
  parseReportCoordinates,
  hasReportCoordinates,
} from "@community/shared";
import { db, result } from "../lib/client";
import { storage } from "../lib/storage";
import { currentDeviceLocation } from "../lib/location";
import { barangayAreaKm2, barangayDensity, barangayDensityColor, barangayHeatColor, barangayMapKey, iliganBarangayBoundaries } from "../lib/barangay-map";
import LocationMap from "../components/deferred-location-map";
import type { MapStyle, Point } from "../components/location-map";
import { ListSkeleton } from "../components/loading";
import { styles as s, Button, Field, Choices, SelectionSheet, PhotoViewer, AppBackNavigation, colors, categoryToneFor, categoryIconFor, categoryDescriptionFor, categoryDisplayName, statusToneFor } from "../components/ui";

type NoticeTone = "info" | "warning" | "success" | "error";
type ManualPinResolution = {
  latitude: number;
  longitude: number;
  barangayId: string;
  barangayName: string;
  address: string;
  exact: boolean;
};

function issueDetailsMessage(values: ReportInput) {
  const issues = [
    values.title.trim().length < 8 ? "Title: use at least 8 characters." : "",
    values.description.trim().length < 20 ? "Description: use at least 20 characters." : "",
  ].filter(Boolean);
  return issues.length ? issues.join(" ") : "Choose a report type and complete the highlighted details.";
}

function ReportNotice({ tone, message, onDismiss }: { tone: NoticeTone; message: string; onDismiss: () => void }) {
  const palette = tone === "warning" ? { background: "#fff8e9", border: "#f0dfb8", foreground: "#9a6810", icon: "alert-circle-outline" as const, title: "A few details need attention" }
    : tone === "error" ? { background: "#fff2f0", border: "#f1d2cd", foreground: "#a43d35", icon: "close-circle-outline" as const, title: "We couldn’t complete that" }
    : tone === "success" ? { background: "#eff9f5", border: "#d5eee4", foreground: colors.brand, icon: "checkmark-circle-outline" as const, title: "All set" }
    : { background: "#f1f7fc", border: "#dbe8f4", foreground: "#3b73ba", icon: "information-circle-outline" as const, title: "Report update" };
  return (
    <View style={{ width: "100%", padding: 12, borderRadius: 16, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background, flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
      <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: `${palette.foreground}14`, alignItems: "center", justifyContent: "center" }}><Ionicons name={palette.icon} size={20} color={palette.foreground} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={{ color: palette.foreground, fontSize: 13, lineHeight: 17, fontWeight: "800" }}>{palette.title}</Text>
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: colors.brandDark, fontSize: 13, lineHeight: 19 }}>{message}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss report message" onPress={onDismiss} hitSlop={7} style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}><Ionicons name="close" size={18} color={colors.muted} /></Pressable>
    </View>
  );
}

function ReviewItem({
  icon,
  label: itemLabel,
  value,
  detail,
  onEdit,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
  detail?: string;
  onEdit: () => void;
}) {
  return (
    <View style={{ minHeight: 70, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 }}>
      <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={20} color={colors.brand} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={s.small}>{itemLabel}</Text>
        <Text numberOfLines={itemLabel === "Description" ? 3 : 2} style={{ color: colors.brandDark, fontSize: 14, lineHeight: 19, fontWeight: "700" }}>{value}</Text>
        {!!detail && <Text numberOfLines={2} style={s.small}>{detail}</Text>}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${itemLabel.toLowerCase()}`} onPress={onEdit} style={({ pressed }) => [{ minHeight: 40, paddingHorizontal: 10, borderRadius: 20, backgroundColor: "#effaf7", flexDirection: "row", alignItems: "center", gap: 4 }, pressed && { opacity: 0.72 }]}>
        <Ionicons name="create-outline" size={15} color={colors.brand} />
        <Text style={{ color: colors.brand, fontSize: 12, fontWeight: "800" }}>Edit</Text>
      </Pressable>
    </View>
  );
}

export function ReportReviewCard({
  category,
  problem,
  title,
  description,
  barangay,
  landmark,
  purok,
  zone,
  locationAddress,
  latitude,
  longitude,
  photo,
  onEditDetails,
  onEditLocation,
  onEditPhotos,
}: {
  category: string;
  problem: string;
  title: string;
  description: string;
  barangay: string;
  landmark?: string;
  purok?: string | null;
  zone?: string | null;
  locationAddress?: string;
  latitude: number | null;
  longitude: number | null;
  photo?: string | null;
  onEditDetails: (field: "category" | "title" | "description") => void;
  onEditLocation: () => void;
  onEditPhotos: () => void;
}) {
  const address = [purok && `Purok ${purok}`, zone && `Zone ${zone}`, landmark || locationAddress].filter(Boolean).join(" · ");
  return (
    <>
      <View style={[s.card, { gap: 0, paddingHorizontal: 14, paddingVertical: 6 }]}>
        <ReviewItem icon={categoryIconFor(category)} label="Issue category" value={categoryDisplayName(category)} detail={problem || "Specific problem selected"} onEdit={() => onEditDetails("category")} />
        <View style={s.divider} />
        <ReviewItem icon="document-text-outline" label="Title" value={title || "Untitled report"} onEdit={() => onEditDetails("title")} />
        <View style={s.divider} />
        <ReviewItem icon="reorder-three-outline" label="Description" value={description || "No description added."} onEdit={() => onEditDetails("description")} />
        <View style={s.divider} />
        <ReviewItem
          icon="location-outline"
          label="Location"
          value={`${barangay || "Barangay not selected"}, Iligan City`}
          detail={[address, hasReportCoordinates({ latitude, longitude }) ? `Pinned location · ${latitude!.toFixed(5)}, ${longitude!.toFixed(5)}` : "Manual address · No GPS coordinates shared."].filter(Boolean).join(" · ")}
          onEdit={onEditLocation}
        />
      </View>
      <View style={[s.card, { padding: 14, gap: 10 }]}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
            <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}><Ionicons name="images-outline" size={19} color={colors.brand} /></View>
            <View style={{ gap: 2 }}><Text style={s.fieldLabel}>Photos ({photo ? 1 : 0})</Text><Text style={s.small}>{photo ? "Evidence for staff review" : "No photos added"}</Text></View>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Manage report photos" onPress={onEditPhotos} style={({ pressed }) => [{ minHeight: 40, flexDirection: "row", alignItems: "center", gap: 3 }, pressed && { opacity: 0.72 }]}>
            <Text style={{ color: colors.brand, fontSize: 12, fontWeight: "700" }}>Manage photos</Text><Ionicons name="chevron-forward" size={16} color={colors.brand} />
          </Pressable>
        </View>
        {photo && <PhotoViewer source={{ uri: photo }} label="Report photograph" style={{ width: 118, height: 88, borderRadius: 14, backgroundColor: "#eaf2f1" }} />}
      </View>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 9, padding: 12, borderRadius: 15, backgroundColor: colors.brandSoft }}>
        <Ionicons name="information-circle" size={20} color={colors.brand} />
        <Text style={[s.small, { flex: 1, color: colors.brandDark }]}>You can go back to edit your details or location before submitting. Exact location details are shared with authorized staff only.</Text>
      </View>
    </>
  );
}

export function ReportForm({
  categories,
  barangays,
  onSaved,
  residentProfile,
  onEditProfile,
  onScrollToReportSection,
  initialCategory = "",
  initialBarangay = "",
}: {
  categories: Lookup[];
  barangays: Lookup[];
  onSaved: () => void;
  residentProfile?: Profile;
  onEditProfile?: () => void;
  onScrollToReportSection?: (y: number) => void;
  initialCategory?: string;
  initialBarangay?: string;
}) {
  const categorySheetAnchorRef = useRef<View>(null);
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const desktopReport = Platform.OS === "web" && windowWidth >= 1200;
  const insets = useSafeAreaInsets();
  const {
    control,
    handleSubmit,
    setValue,
    clearErrors,
    watch,
    trigger,
    formState: { errors },
  } = useForm<ReportInput>({
    resolver: zodResolver(createReportSchema(categories)),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: {
      title: "",
      description: "",
      category_id: initialCategory,
      barangay_id: initialBarangay,
      latitude: null,
      longitude: null,
      landmark: "",
      purok: "",
      zone: "",
      location_source: null,
      location_accuracy: null,
      location_address: "",
      problem_type: null,
      problem_other: null,
    },
  });
  const [step, setStep] = useState(0),
    [locationSource, setLocationSource] = useState<"gps" | "pin" | "coordinates" | null>(null),
    [locationAccuracy, setLocationAccuracy] = useState<number | null>(null),
    [locationAddress, setLocationAddress] = useState(""),
    [cityConfirmed, setCityConfirmed] = useState(false),
    [manualBarangayConfirmed, setManualBarangayConfirmed] = useState(false),
    [barangayReviewRequired, setBarangayReviewRequired] = useState(false),
    [locating, setLocating] = useState(false),
    [locationCheckSource, setLocationCheckSource] = useState<"gps" | "pin" | "coordinates" | null>(null),
    [locationError, setLocationError] = useState(""),
    [showCoordinates, setShowCoordinates] = useState(false),
    [photo, setPhoto] = useState<string | null>(null),
    [saved, setSaved] = useState<string | null>(null),
    [requestId, setRequestId] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [messageTone, setMessageTone] = useState<NoticeTone>("info"),
    [categorySheetOpen, setCategorySheetOpen] = useState(false),
    [pinModalOpen, setPinModalOpen] = useState(false),
    [manualPin, setManualPin] = useState<Pick<Point, "latitude" | "longitude"> | null>(null),
    [manualPinResolution, setManualPinResolution] = useState<ManualPinResolution | null>(null),
    [checkingManualPin, setCheckingManualPin] = useState(false),
    [manualPinError, setManualPinError] = useState(""),
    [draftKey, setDraftKey] = useState(""),
    [coordinates, setCoordinates] = useState({ latitude: "", longitude: "" });
  const titleInputRef = useRef<TextInput | null>(null);
  const descriptionInputRef = useRef<TextInput | null>(null);
  const sectionPositions = useRef({ header: 0, details: 0, review: 0, title: 0, description: 0, photos: 0 });
  const pendingScrollTarget = useRef<"details" | "location" | "review" | "category" | "title" | "description" | "photos" | null>(null);
  const values = watch();
  function showMessage(text: string, tone: NoticeTone = "info") { setMessage(text); setMessageTone(tone); }
  function clearMessage() { showMessage(""); }
  const locationRequest = useRef(0);
  const pinLookupRequest = useRef(0);
  const submissionLock = useRef(false);
  useEffect(() => () => { locationRequest.current++; pinLookupRequest.current++; }, []);
  function navigateToStep(next: 0 | 1 | 2, target: "details" | "location" | "review" | "category" | "title" | "description" | "photos" = next === 0 ? "details" : next === 1 ? "location" : "review") {
    pendingScrollTarget.current = target;
    setStep(next);
    clearMessage();
  }
  function goBackStep() {
    if (step === 2) navigateToStep(1, "location");
    else if (step === 1) navigateToStep(0, "details");
  }
  useEffect(() => {
    const timer = setTimeout(() => {
      const target = pendingScrollTarget.current ?? (step === 0 ? "details" : step === 1 ? "location" : "review");
      const positions = sectionPositions.current;
      const y = target === "location" ? positions.header
        : target === "review" ? positions.header
        : target === "title" ? positions.details + positions.title
        : target === "description" ? positions.details + positions.description
        : target === "photos" ? positions.details + positions.photos
        : positions.header;
      onScrollToReportSection?.(Math.max(0, y - 12));
      if (target === "category") setCategorySheetOpen(true);
      if (target === "title") titleInputRef.current?.focus();
      if (target === "description") descriptionInputRef.current?.focus();
      pendingScrollTarget.current = null;
    }, 120);
    return () => clearTimeout(timer);
  }, [step, onScrollToReportSection]);
  useEffect(() => {
    if (Platform.OS !== "android" || step === 0 || busy) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => { goBackStep(); return true; });
    return () => listener.remove();
  }, [step, busy]);
  async function chooseLocation(
    point: { latitude: number; longitude: number },
    source: "gps" | "pin" | "coordinates",
    accuracy: number | null = null,
    activeRequest?: number,
  ) {
    const request = activeRequest ?? ++locationRequest.current;
    setLocating(true);
    setLocationCheckSource(source);
    setLocationError("");
    setCityConfirmed(false);
    setManualBarangayConfirmed(false);
    try {
      if (!db) throw new Error("Location checking is not configured for this app.");
      const resolved = await result<{ city: "inside" | "outside" | "unknown"; barangay_id: string | null; barangay: string | null; suggested_barangay_id?: string | null; suggested_barangay?: string | null; address: string }>(
        db.rpc("resolve_report_location", { p_latitude: point.latitude, p_longitude: point.longitude }),
      );
      if (request !== locationRequest.current) return false;
      if (resolved.city === "outside") {
        setLocationError(`This pin is outside the mapped Iligan City boundary${resolved.address ? ` (${resolved.address})` : ""}. Try another spot.`);
        return false;
      }
      if (resolved.city === "unknown") {
        setLocationError("This pin is close to the city boundary. Check the location and place it clearly inside Iligan City.");
        return false;
      }

      const matchedBarangay = barangays.find((item) => item.id === (resolved.barangay_id ?? resolved.suggested_barangay_id));
      setValue("latitude", point.latitude);
      setValue("longitude", point.longitude);
      setCoordinates({ latitude: String(point.latitude), longitude: String(point.longitude) });
      setValue("location_source", source);
      setValue("location_accuracy", source === "gps" ? accuracy : null);
      setValue("location_address", resolved.address || "");
      setBarangayReviewRequired(!resolved.barangay_id);
      setLocationAddress(resolved.address);
      setCityConfirmed(true);
      setManualBarangayConfirmed(false);
      if (matchedBarangay) {
        setValue("barangay_id", matchedBarangay.id, { shouldValidate: true, shouldDirty: true });
      } else {
        setValue("barangay_id", "", { shouldValidate: false, shouldDirty: true });
      }
      setLocationSource(source);
      setLocationAccuracy(accuracy);
      setLocationError(matchedBarangay ? "" : "Iligan City found, but its barangay needs confirmation. Pin the location manually to continue.");
      clearMessage();
      return true;
    } catch (error) {
      if (request === locationRequest.current) setLocationError((error as Error).message || "We couldn’t check this location. Please try again.");
      return false;
    } finally {
      if (request === locationRequest.current) {
        setLocating(false);
        setLocationCheckSource(null);
      }
    }
  }
  const checkingCurrentLocation = locationCheckSource === "gps";
  const selectedBarangay = barangays.find((item) => item.id === values.barangay_id);
  const coordinatesApplied = coordinates.latitude === String(values.latitude ?? "") && coordinates.longitude === String(values.longitude ?? "");
  const locationReady = Boolean(locationSource && cityConfirmed && hasReportCoordinates(values) && coordinatesApplied && selectedBarangay && !locating && (!barangayReviewRequired || manualBarangayConfirmed));
  function openManualPin() {
    const currentPin = hasReportCoordinates(values) ? { latitude: values.latitude, longitude: values.longitude } : null;
    setManualPin(currentPin);
    setManualPinResolution(currentPin && selectedBarangay ? { ...currentPin, barangayId: selectedBarangay.id, barangayName: selectedBarangay.name, address: locationAddress, exact: !barangayReviewRequired } : null);
    setManualPinError("");
    setPinModalOpen(true);
  }
  function closeManualPin() {
    pinLookupRequest.current++;
    setPinModalOpen(false);
    setCheckingManualPin(false);
  }
  async function checkManualPin(point: Pick<Point, "latitude" | "longitude">) {
    const request = ++pinLookupRequest.current;
    setManualPin(point);
    setManualPinResolution(null);
    setManualPinError("");
    setCheckingManualPin(true);
    try {
      if (!db) throw new Error("Location checking is not configured for this app.");
      const resolved = await result<{ city: "inside" | "outside" | "unknown"; barangay_id: string | null; barangay: string | null; suggested_barangay_id?: string | null; suggested_barangay?: string | null; address: string }>(
        db.rpc("resolve_report_location", { p_latitude: point.latitude, p_longitude: point.longitude }),
      );
      if (request !== pinLookupRequest.current) return;
      if (resolved.city !== "inside") {
        setManualPinError(resolved.city === "outside"
          ? `This pin is outside Iligan City${resolved.address ? ` (${resolved.address})` : ""}. Move it inside the city boundary.`
          : "This pin is too close to the city boundary to confirm. Move it farther inside Iligan City.");
        return;
      }
      const barangayId = resolved.barangay_id ?? resolved.suggested_barangay_id;
      const matched = barangays.find((item) => item.id === barangayId);
      if (!matched) {
        setManualPinError("No mapped barangay was found here. Move the pin to a location inside a mapped barangay.");
        return;
      }
      setManualPinResolution({ ...point, barangayId: matched.id, barangayName: matched.name, address: resolved.address || "", exact: !!resolved.barangay_id });
    } catch (error) {
      if (request === pinLookupRequest.current) setManualPinError((error as Error).message || "We couldn’t check this pin. Try again.");
    } finally {
      if (request === pinLookupRequest.current) setCheckingManualPin(false);
    }
  }
  function confirmManualPin() {
    const pin = manualPinResolution;
    if (!pin) return;
    setValue("latitude", pin.latitude);
    setValue("longitude", pin.longitude);
    setCoordinates({ latitude: String(pin.latitude), longitude: String(pin.longitude) });
    setValue("location_source", "pin");
    setValue("location_accuracy", null);
    setValue("location_address", pin.address);
    setValue("barangay_id", pin.barangayId, { shouldValidate: true, shouldDirty: true });
    setBarangayReviewRequired(!pin.exact);
    setLocationAddress(pin.address);
    setCityConfirmed(true);
    setManualBarangayConfirmed(true);
    setLocationSource("pin");
    setLocationAccuracy(null);
    setLocationError("");
    clearMessage();
    closeManualPin();
  }
  const selectedCategory = categories.find((item) => item.id === values.category_id);
  const problemOptions = [...(selectedCategory?.problem_types ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const drainage = selectedCategory?.name.toLowerCase().startsWith("drainage");
  const problemLabel = problemOptions.find((item) => item.code === values.problem_type)?.label;
  async function continueToLocation() {
    clearMessage();
    if (!(await trigger(["category_id", "problem_type", "problem_other", "title", "description"]))) {
      showMessage(issueDetailsMessage(values), "warning");
      return;
    }
    navigateToStep(1, "location");
  }
  async function reviewReport() {
    if (!(await trigger(["category_id", "problem_type", "problem_other", "title", "description"]))) {
      navigateToStep(0, "details");
      showMessage(issueDetailsMessage(values), "warning");
      return;
    }
    if (!locationReady || !(await trigger(["latitude", "longitude", "barangay_id", "purok", "zone", "landmark", "location_source", "location_address", "location_accuracy"]))) {
      navigateToStep(1, "location");
      showMessage("Set the issue location and confirm its barangay in the map before reviewing.", "warning");
      return;
    }
    clearMessage();
    navigateToStep(2, "review");
  }
  useEffect(
    () =>
      setCoordinates({
        latitude: values.latitude == null ? "" : String(values.latitude),
        longitude: values.longitude == null ? "" : String(values.longitude),
      }),
    [values.latitude, values.longitude],
  );
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const uid = (await db!.auth.getUser()).data.user?.id;
        if (!uid) throw new Error("Sign in again.");
        const key = "pending-report-" + uid;
        const old = await storage.getItem(key);
        const id = old || randomUUID();
        if (!old) await storage.setItem(key, id);
        if (active) {
          setDraftKey(key);
          setRequestId(id);
        }
        if (old) {
          const existing = await result<{ id: string } | null>(
            db!.from("reports").select("id").eq("id", old).maybeSingle(),
          );
          if (existing && active) {
            setSaved(old);
            showMessage("Your previous submission was saved. Open your report to review it.", "success");
          }
        }
      } catch (e) {
        if (active) showMessage((e as Error).message, "error");
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  async function upload(id: string) {
    if (!photo) return;
    const uid = (await db!.auth.getUser()).data.user?.id;
    if (!uid) throw new Error("Sign in again to attach a photograph.");
    const image = await ImageManipulator.manipulateAsync(
      photo,
      [{ resize: { width: 1400 } }],
      { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG },
    );
    const buffer = await (await fetch(image.uri)).arrayBuffer();
    if (buffer.byteLength > 5 * 1024 * 1024) throw new Error("Choose a photo smaller than 5 MB.");
    const path = `${uid}/${id}/${randomUUID()}.jpg`;
    await result(
      db!.storage
        .from("report-evidence")
        .upload(path, buffer, { contentType: "image/jpeg" }),
    );
    try {
      await result(
        db!.from("report_attachments").insert({ report_id: id, path }),
      );
    } catch (e) {
      await db!.storage.from("report-evidence").remove([path]);
      throw e;
    }
  }
  async function submit(v: ReportInput) {
    if (submissionLock.current) return;
    if (!locationReady || !locationSource || !hasReportCoordinates(v) || !cityConfirmed || locating) {
      navigateToStep(1, "location");
      showMessage("Set the issue location and confirm its barangay before submitting.", "warning");
      return;
    }
    submissionLock.current = true;
    setBusy(true);
    try {
      const id = await result<string>(
        db!.rpc("submit_report", {
          p_id: requestId,
          p_category: v.category_id,
          p_barangay: v.barangay_id,
          p_title: v.title,
          p_description: v.description,
          p_latitude: v.latitude,
          p_longitude: v.longitude,
          p_landmark: v.landmark,
          p_purok: v.purok,
          p_zone: v.zone,
          p_location_source: v.location_source,
          p_location_accuracy: v.location_accuracy,
          p_location_address: v.location_address,
          p_problem_type: v.problem_type,
          p_problem_other: v.problem_type === "other" ? v.problem_other?.trim() : null,
        }),
      );
      try {
        await upload(id);
      } catch {
        // The report is saved; optional photo evidence must not make it look like submission failed.
      }
      setSaved(id);
      showMessage("Your report has been saved. Keep the tracking identifier below.", "success");
    } catch (e) {
      showMessage(
        "We could not finish this step. Retry safely without creating a second report. " +
          (e as Error).message,
        "error",
      );
    } finally {
      setBusy(false);
      submissionLock.current = false;
    }
  }
  async function pick(camera = false) {
    try {
      const permission = camera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted)
        throw new Error("Permission denied. A photograph is optional.");
      const picked = camera
        ? await ImagePicker.launchCameraAsync({ quality: 0.8, exif: false })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            quality: 0.8,
            exif: false,
          });
      if (!picked.canceled) setPhoto(picked.assets[0].uri);
    } catch (e) {
      showMessage((e as Error).message, "error");
    }
  }
  if (residentProfile && !residentProfile.barangay_id) return <View style={s.card}>
    <Text style={s.title}>Complete your registered barangay</Text>
    <Text style={s.body}>Choose your barangay in Profile so officials can identify where you are registered. You can then report a concern at its actual location.</Text>
    {onEditProfile && <Button title="Open Profile" onPress={onEditProfile} />}
  </View>;
  return (
    <>
      {!desktopReport && <Text onLayout={(event) => { sectionPositions.current.header = event.nativeEvent.layout.y; }} style={s.heading}>Report a concern</Text>}
      {residentProfile && <Text style={s.small}>Reporting as {residentProfile.display_name} · Registered in {barangays.find(b => b.id === residentProfile.barangay_id)?.name || "your barangay"}</Text>}
      {!saved && <Text style={s.body}>Describe the concern, confirm its location, then check and send. Your name and registered barangay are taken from your signed-in account.</Text>}
      {!!message && <ReportNotice tone={messageTone} message={message} onDismiss={clearMessage} />}
      {saved ? (
        <View style={s.card}>
          <Text style={s.eyebrow}>REPORT RECEIVED</Text>
          <Text style={s.title}>Thank you for speaking up.</Text>
          <Text style={s.body}>
            The barangay responsible for your pinned location will review your report. Officials can investigate and handle it locally or forward it to the responsible office. Open Your reports to follow updates and read the final action taken.
          </Text>
          <Text selectable style={s.small}>
            {saved}
          </Text>
          <Button
            title="View your reports"
            onPress={() => void storage.removeItem(draftKey).then(onSaved)}
          />
        </View>
      ) : (
        <>
          <View onLayout={(event) => { sectionPositions.current.header = event.nativeEvent.layout.y; }} style={desktopReport ? { flexDirection: "column", alignItems: "stretch", gap: 22, padding: 24, borderWidth: 1, borderColor: "#dfe9e6", borderRadius: 14, backgroundColor: "white" } : { gap: 0 }}>
          <View style={desktopReport ? { position: "relative", flexDirection: "row", width: "100%", maxWidth: 900, alignSelf: "center", paddingVertical: 2 } : { position: "relative", flexDirection: "row", paddingVertical: 2, marginBottom: 0 }}>
            <View pointerEvents="none" style={{ position: "absolute", top: 17, left: "16.67%", right: "16.67%", height: 4, borderRadius: 2, backgroundColor: "#e3ebf2" }}>
              <View style={{ width: `${step * (desktopReport ? 100 / 3 : 50)}%`, height: "100%", borderRadius: 2, backgroundColor: colors.brand }} />
            </View>
            {["Details", "Location", "Review"].map((title, i) => <Pressable key={title} accessibilityRole="tab" accessibilityState={{ selected: step === i, disabled: busy }} disabled={busy} onPress={() => {
              if (i === 2) void reviewReport();
              else if (i === 1 && step === 0) void continueToLocation();
              else navigateToStep(i as 0 | 1, i === 0 ? "details" : "location");
            }} style={desktopReport ? { flex: 1, minWidth: 0, minHeight: 66, alignItems: "center", gap: 5 } : { flex: 1, minHeight: 66, alignItems: "center", gap: 5 }}>
              <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: i <= step ? colors.brand : colors.warmSurface, borderWidth: i === step ? 2 : 0, borderColor: colors.mint }}>
                {i < step ? <Ionicons name="checkmark" size={19} color="white" /> : <Text style={{ color: i <= step ? "white" : colors.muted, fontSize: 14, fontWeight: "800" }}>{i + 1}</Text>}
              </View>
              <View style={{ gap: 2, alignItems: "center" }}><Text style={{ textAlign: "center", color: i <= step ? colors.brandDark : colors.muted, fontSize: 12, fontWeight: i === step ? "800" : "600" }}>{title}</Text>{desktopReport && <Text style={{ textAlign: "center", color: "#71858a", fontSize: 10 }}>{i === 0 ? "Issue details" : i === 1 ? "Pin the location" : "Check before sending"}</Text>}</View>
            </Pressable>)}
          </View>
          <View style={desktopReport ? { width: "100%", alignSelf: "center", maxWidth: 900, gap: 13 } : { gap: 0 }}>
          {!desktopReport && <Text style={s.eyebrow}>
            STEP {step + 1} OF 3 · {["DETAILS", "LOCATION", "REVIEW"][step]}
          </Text>}
          {step === 0 && (
            <View style={{ gap: 14 }} onLayout={(event) => { sectionPositions.current.details = event.nativeEvent.layout.y; }}>
              <Text style={s.subtitle}>
                Tell us what needs attention. Keep a safe distance from hazards.
              </Text>
              <View style={{ flexDirection: desktopReport && selectedCategory ? "row" : "column", alignItems: "stretch", gap: desktopReport ? 18 : 14 }}>
              <View style={desktopReport && selectedCategory ? { flex: 1, minWidth: 0 } : undefined}>
              <View style={{ gap: 8 }}>
                <Text style={[s.fieldLabel, { fontSize: 15 }]}>Issue category</Text>
                <Pressable ref={categorySheetAnchorRef} accessibilityRole="button" accessibilityLabel={selectedCategory ? `Change issue category, currently ${categoryDisplayName(selectedCategory.name)}` : "Choose an issue category"} accessibilityHint="Opens the report type selector" accessibilityState={{ expanded: categorySheetOpen }} onPress={() => setCategorySheetOpen((open) => !open)} style={({ pressed }) => [{ minHeight: 76, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 18, borderWidth: 1, borderColor: selectedCategory ? categoryToneFor(selectedCategory.name).foreground : "#e2eaf2", backgroundColor: selectedCategory ? "#fbfefd" : "white", flexDirection: "row", alignItems: "center", gap: 12 }, pressed && { opacity: 0.82 }]}>
                  <View style={{ width: 52, height: 52, borderRadius: 19, backgroundColor: selectedCategory ? categoryToneFor(selectedCategory.name).background : colors.brandSoft, alignItems: "center", justifyContent: "center" }}><Ionicons name={selectedCategory ? categoryIconFor(selectedCategory.name) : "grid-outline"} size={25} color={selectedCategory ? categoryToneFor(selectedCategory.name).foreground : colors.brand} /></View>
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <Text style={{ color: colors.brandDark, fontSize: 16, lineHeight: 20, fontWeight: "800" }}>{selectedCategory ? categoryDisplayName(selectedCategory.name) : "Choose a report type"}</Text>
                    {!!selectedCategory && <Text numberOfLines={2} style={s.small}>{categoryDescriptionFor(selectedCategory.name)}</Text>}
                  </View>
                  <Text style={{ color: colors.brand, fontSize: 14, fontWeight: "700" }}>{selectedCategory ? "Change" : "Choose"}</Text>
                </Pressable>
                {!!errors.category_id && <Text accessibilityRole="alert" style={s.error}>{errors.category_id.message}</Text>}
              </View>
              <SelectionSheet
                visible={categorySheetOpen}
                onClose={() => setCategorySheetOpen(false)}
                anchorRef={categorySheetAnchorRef}
                title="Choose a report type"
                subtitle="Select the category that best matches the issue you want to report."
                searchPlaceholder="Search report type"
                items={categories.map((item) => ({ id: item.id, name: categoryDisplayName(item.name), description: categoryDescriptionFor(item.name), icon: categoryIconFor(item.name), tone: categoryToneFor(item.name) }))}
                value={values.category_id}
                onConfirm={(value) => {
                  if (value !== values.category_id) {
                    setValue("problem_type", null);
                    setValue("problem_other", null);
                    clearErrors(["problem_type", "problem_other"]);
                  }
                  setValue("category_id", value, { shouldValidate: true });
                }}
              />
              </View>
              {!!selectedCategory && <View style={[{ gap: 8 }, desktopReport && { flex: 1, minWidth: 0 }]}>
                <Text style={s.fieldLabel}>{drainage ? "What is the drainage problem?" : "What is the specific problem?"} <Text style={{ color: colors.muted }}>(required)</Text></Text>
                <Choices compact title={drainage ? "What is the drainage problem?" : `Problem type · ${categoryDisplayName(selectedCategory.name)}`} sheetTitle="Select a problem" subtitle={`Choose the specific ${categoryDisplayName(selectedCategory.name).toLowerCase()} issue to help route your report correctly.`} sheetKind="problem" categoryName={selectedCategory.name} placeholder="Select a problem" leadingIcon={categoryIconFor(selectedCategory.name)} items={problemOptions.map((item) => ({ id: item.code, name: item.label }))} value={values.problem_type || ""} onChange={(value) => {
                  if (value !== "other") setValue("problem_other", null);
                  clearErrors("problem_other");
                  setValue("problem_type", value, { shouldValidate: true });
                }} />
                {!problemOptions.length && <Text style={s.error}>Problem options are unavailable. Return Home and refresh before submitting.</Text>}
                {!!errors.problem_type && <Text accessibilityRole="alert" style={s.error}>{errors.problem_type.message}</Text>}
              </View>}
              </View>
              {values.problem_type === "other" && <Controller control={control} name="problem_other" render={({ field }) => <View style={{ gap: 8 }}>
                <Field label={drainage ? "Please describe the drainage problem" : "Please describe the problem"} placeholder={drainage ? "Enter the drainage problem..." : "Enter the specific problem..."} value={field.value || ""} onChangeText={field.onChange} multiline maxLength={240} />
                <Text style={s.small}>Required for Others · {field.value?.length || 0}/240</Text>
                {!!errors.problem_other && <Text accessibilityRole="alert" style={s.error}>{errors.problem_other.message}</Text>}
              </View>} />}
              {(["title", "description"] as const).map((name) => (
                <View key={name} style={{ gap: 7 }} onLayout={(event) => { sectionPositions.current[name] = event.nativeEvent.layout.y; }}>
                  <Controller
                    control={control}
                    name={name}
                    render={({ field }) => (
                      <Field
                        label={label(name)}
                        leading={<Ionicons name={name === "title" ? "document-text-outline" : name === "description" ? "create-outline" : "location-outline"} size={21} color={name === "description" ? "#6f8199" : colors.brand} />}
                        value={field.value}
                        onChangeText={field.onChange}
                        onBlur={field.onBlur}
                        inputRef={(input) => { field.ref(input); if (name === "title") titleInputRef.current = input; else descriptionInputRef.current = input; }}
                        required
                        minLength={name === "title" ? 8 : name === "description" ? 20 : 0}
                        hint={name === "title" ? "Required · 8–160 characters." : name === "description" ? "Required · 20–4000 characters. Explain what happened and avoid private personal details." : "Optional · up to 240 characters."}
                        error={errors[name]?.message}
                        placeholder={name === "title" ? "Short summary of the issue" : name === "description" ? "What happened? Include details that can help the city respond." : "Nearby building, landmark, or intersection"}
                        multiline={name === "description"}
                        maxLength={
                          name === "description"
                            ? 4000
                            : name === "title"
                              ? 160
                              : 240
                        }
                      />
                    )}
                  />
                </View>
              ))}
              <View onLayout={(event) => { sectionPositions.current.photos = event.nativeEvent.layout.y; }} style={[s.card, { gap: 10, padding: 13, borderRadius: 18, backgroundColor: "#fbfdfd" }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}><Ionicons name="camera-outline" size={20} color={colors.brand} /></View>
                  <View style={{ flex: 1, gap: 2 }}><Text style={[s.fieldLabel, { fontSize: 14 }]}>Add a photo</Text><Text style={s.small}>Optional · Photograph the issue from a safe distance.</Text></View>
                </View>
                {photo ? <View style={{ flexDirection: "row", alignItems: "center", gap: 11, padding: 8, borderWidth: 1, borderColor: "#d8e9e6", borderRadius: 15, backgroundColor: "white" }}>
                  <PhotoViewer source={{ uri: photo }} label="Selected photograph preview" style={{ width: 72, height: 72, borderRadius: 11, backgroundColor: "#eaf2f1" }} />
                  <View style={{ flex: 1, gap: 4 }}><Text style={[s.fieldLabel, { color: colors.brand }]}>Photo ready</Text><Text style={s.small}>It will be attached privately to your report.</Text></View>
                  <Pressable accessibilityRole="button" accessibilityLabel="Replace photograph" onPress={() => void pick()} style={({ pressed }) => [{ width: 48, height: 48, borderRadius: 13, backgroundColor: "#eef4fc", alignItems: "center", justifyContent: "center" }, pressed && { opacity: 0.75 }]}><Ionicons name="images-outline" size={18} color="#526c9c" /></Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="Remove photograph" onPress={() => setPhoto(null)} style={({ pressed }) => [{ width: 48, height: 48, borderRadius: 13, backgroundColor: "#fff0ee", alignItems: "center", justifyContent: "center" }, pressed && { opacity: 0.75 }]}><Ionicons name="trash-outline" size={18} color="#a43d35" /></Pressable>
                </View> : <View style={s.actionRow}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Take a photo" onPress={() => void pick(true)} style={({ pressed }) => [{ flex: 1, minWidth: 0, minHeight: 58, padding: 8, borderRadius: 15, borderWidth: 1, borderColor: "#bfe7df", backgroundColor: "#effaf7", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }, pressed && { opacity: 0.78 }]}><View style={{ width: 32, height: 32, borderRadius: 11, backgroundColor: "#d9f2ec", alignItems: "center", justifyContent: "center" }}><Ionicons name="camera" size={17} color={colors.brand} /></View><Text style={{ color: colors.brand, fontSize: 12, fontWeight: "700" }}>Take photo</Text></Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="Upload a photo" onPress={() => void pick()} style={({ pressed }) => [{ flex: 1, minWidth: 0, minHeight: 58, padding: 8, borderRadius: 15, borderWidth: 1, borderColor: "#dce6f2", backgroundColor: "#f4f7fc", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }, pressed && { opacity: 0.78 }]}><View style={{ width: 32, height: 32, borderRadius: 11, backgroundColor: "#e5ecf8", alignItems: "center", justifyContent: "center" }}><Ionicons name="images" size={17} color="#526c9c" /></View><Text style={{ color: "#526c9c", fontSize: 12, fontWeight: "700" }}>Upload photo</Text></Pressable>
                </View>}
              </View>
            </View>
          )}
          {step === 1 && (
            <View style={{ gap: 14 }}>
              <View style={[s.card, { gap: 10, padding: 14, backgroundColor: "#f6fbfa", borderColor: "#dcefeb" }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: "#e1f5ef", alignItems: "center", justifyContent: "center" }}><Ionicons name="location-outline" size={22} color={colors.brand} /></View>
                  <View style={{ flex: 1, gap: 3 }}><Text style={s.fieldLabel}>Set the issue location</Text><Text style={s.small}>Choose your current location, or open the map to pin the spot manually.</Text></View>
                </View>
                <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || locating, busy: checkingCurrentLocation }} disabled={busy || locating} onPress={async () => {
                  const request = ++locationRequest.current;
                  setLocating(true);
                  setLocationCheckSource("gps");
                  setLocationError("");
                  try {
                    const loc = await currentDeviceLocation();
                    if (request === locationRequest.current) await chooseLocation(loc, "gps", loc.accuracy, request);
                  } catch (e) {
                    if (request === locationRequest.current) setLocationError((e as Error).message);
                  } finally {
                    if (request === locationRequest.current) {
                      setLocating(false);
                      setLocationCheckSource(null);
                    }
                  }
                }} style={({ pressed }) => [{ minHeight: 50, marginTop: 4, borderRadius: 14, backgroundColor: colors.brand, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, opacity: busy || checkingCurrentLocation ? 0.6 : pressed ? 0.84 : 1 }]}>
                  {checkingCurrentLocation ? <ActivityIndicator size="small" color="white" /> : <Ionicons name="locate-outline" size={19} color="white" />}
                  <Text style={{ color: "white", fontSize: 14, fontWeight: "800" }}>{checkingCurrentLocation ? "Checking location…" : "Use my current location"}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={hasReportCoordinates(values) ? "Adjust location pin manually" : "Pin location manually"} accessibilityState={{ disabled: busy || locating }} disabled={busy || locating} onPress={openManualPin} style={({ pressed }) => [{ minHeight: 58, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: "#bfe7df", backgroundColor: "white", flexDirection: "row", alignItems: "center", gap: 10, opacity: busy || locating ? 0.6 : pressed ? 0.82 : 1 }]}>
                  <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}><Ionicons name="map-outline" size={19} color={colors.brand} /></View>
                  <View style={{ flex: 1, gap: 2 }}><Text style={{ color: colors.brandDark, fontSize: 13, fontWeight: "800" }}>{hasReportCoordinates(values) ? "Adjust pin manually" : "Pin location manually"}</Text><Text style={s.small}>Open the map and confirm the barangay.</Text></View>
                  <Ionicons name="chevron-forward" size={18} color={colors.brand} />
                </Pressable>
              </View>
              {!!locationError && <Text accessibilityRole="alert" style={s.error}>{locationError}</Text>}
              {!!errors.latitude && <Text accessibilityRole="alert" style={s.error}>{errors.latitude.message}</Text>}
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: showCoordinates }} onPress={() => setShowCoordinates(!showCoordinates)} style={{ minHeight: 48, justifyContent: "center" }}><Text style={[s.small, { color: colors.brand, fontWeight: "700" }]}>{showCoordinates ? "Hide coordinate entry" : "Enter coordinates instead"}</Text></Pressable>
              {showCoordinates && <>{(["latitude", "longitude"] as const).map((name) => (
                <Field maxLength={24}
                  key={name}
                  label={label(name)}
                  required
                  hint={name === "latitude" ? "Decimal degrees from −90 to 90, such as 8.228." : "Decimal degrees from −180 to 180, such as 124.2452."}
                  keyboardType="numbers-and-punctuation"
                  value={coordinates[name]}
                  onChangeText={(v) => {
                    setCoordinates((current) => ({ ...current, [name]: v }));
                  }}
                />
              ))}
              <Button
                secondary
                title="Apply entered coordinates"
                onPress={() => {
                  const point = parseReportCoordinates(coordinates.latitude, coordinates.longitude);
                  if (!point) {
                    setLocationError("Enter a valid latitude (−90 to 90) and longitude (−180 to 180).");
                    return;
                  }
                  void chooseLocation(point, "coordinates");
                }}
              /></>}
              {hasReportCoordinates(values) && <View style={[s.card, { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: locationReady ? "#f1fbf8" : "#fff9ed", borderColor: locationReady ? "#cdece5" : "#f0dfb8" }]}>
                <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: locationReady ? colors.brandSoft : "#fff1d7", alignItems: "center", justifyContent: "center" }}><Ionicons name={locationReady ? "checkmark-circle-outline" : "location-outline"} size={21} color={locationReady ? colors.brand : "#a66a12"} /></View>
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <Text style={s.fieldLabel}>{locationReady ? "Location confirmed" : "Location needs a manual pin"}</Text>
                  <Text style={s.small}>{selectedBarangay?.name || "Barangay not confirmed"}{locationAddress ? ` · ${locationAddress}` : ""}</Text>
                  <Text numberOfLines={1} style={[s.small, { fontSize: 10 }]}>{values.latitude.toFixed(5)}, {values.longitude.toFixed(5)}{locationSource === "gps" && locationAccuracy !== null ? ` · GPS ±${Math.round(locationAccuracy)} m` : ""}</Text>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="Change pinned location" onPress={openManualPin} style={{ minWidth: 48, minHeight: 48, paddingHorizontal: 6, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "white" }}><Ionicons name="pencil-outline" size={18} color={colors.brand} /><Text style={{ color: colors.brand, fontSize: 9, fontWeight: "800" }}>Change</Text></Pressable>
              </View>}
              <View style={{ gap: 14 }}>
                <View style={{ gap: 4 }}><Text style={s.fieldLabel}>Address details (optional)</Text><Text style={s.small}>Add the Purok, Zone or a nearby landmark if known. Your confirmed pin already marks the exact spot.</Text></View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
                  {(["purok", "zone"] as const).map((name) => <View key={name} style={{ flex: 1, minWidth: 140 }}><Controller control={control} name={name} render={({ field }) => <Field label={`${label(name)} (optional)`} validationKind="address" value={field.value || ""} placeholder={name === "purok" ? "e.g. 3 or Riverside" : "e.g. 2 or Central"} maxLength={80} error={errors[name]?.message} inputRef={field.ref} onBlur={field.onBlur} onChangeText={field.onChange} />} /></View>)}
                </View>
                <Controller control={control} name="landmark" render={({ field }) => <Field label="Additional location details (optional)" validationKind="address" value={field.value || ""} placeholder="Street name, nearby landmark or house number" maxLength={240} multiline error={errors.landmark?.message} inputRef={field.ref} onBlur={field.onBlur} onChangeText={field.onChange} />} />
              </View>
            </View>
          )}
          {step === 2 && (
            <View style={{ gap: 12 }} onLayout={(event) => { sectionPositions.current.review = event.nativeEvent.layout.y; }}>
            <ReportReviewCard
              category={selectedCategory?.name ?? "Report"}
              problem={values.problem_type === "other" ? values.problem_other || "Other" : problemLabel || "Specific problem selected"}
              title={values.title}
              description={values.description}
              barangay={selectedBarangay?.name ?? ""}
              landmark={values.landmark}
              purok={values.purok}
              zone={values.zone}
              locationAddress={locationAddress}
              latitude={values.latitude}
              longitude={values.longitude}
              photo={photo}
              onEditDetails={(field) => navigateToStep(0, field)}
              onEditLocation={() => navigateToStep(1, "location")}
              onEditPhotos={() => navigateToStep(0, "photos")}
            />
            </View>
          )}
          {step === 0 ? (
            <Button
              title="Continue"
              icon="arrow-forward"
              disabled={busy}
              onPress={() => void continueToLocation()}
            />
          ) : step === 1 ? (
            <View style={s.actionRow}>
              <Button secondary grow icon="arrow-back" title="Back to details" disabled={busy} onPress={() => navigateToStep(0, "details")} />
              <Button grow icon="arrow-forward" title="Continue" disabled={busy || !locationReady} onPress={() => void reviewReport()} />
            </View>
          ) : (
            <View style={s.actionRow}>
              <Button secondary grow icon="arrow-back" title="Back to location" disabled={busy} onPress={() => navigateToStep(1, "location")} />
              <Button grow icon="document-text-outline" title={busy ? "Sending report…" : "Submit report"} disabled={busy || !requestId} onPress={() => void handleSubmit(submit, (invalid) => {
                const detailFields = ["category_id", "problem_type", "problem_other", "title", "description"];
                const detailsIncomplete = Object.keys(invalid).some((field) => detailFields.includes(field));
                navigateToStep(detailsIncomplete ? 0 : 1, detailsIncomplete ? "details" : "location");
                showMessage(detailsIncomplete ? issueDetailsMessage(values) : "Choose and confirm the issue location and barangay before submitting.", "warning");
              })()} />
            </View>
          )}
          </View>
          </View>
        </>
      )}
      {pinModalOpen && <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={closeManualPin}>
        <View style={{ flex: 1, backgroundColor: "#f4f8f7" }}>
          <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
            <View style={{ minHeight: 64, paddingHorizontal: 14, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Close pin map" onPress={closeManualPin} style={{ width: 48, height: 48, borderRadius: 15, backgroundColor: "white", alignItems: "center", justifyContent: "center" }}><Ionicons name="close" size={23} color={colors.brandDark} /></Pressable>
              <View style={{ flex: 1, gap: 2 }}><Text style={[s.fieldLabel, { fontSize: 16 }]}>Pin the issue location</Text><Text style={s.small}>Tap the map to place your pin.</Text></View>
            </View>
            <View style={{ flex: 1, minHeight: 260, marginHorizontal: 12, marginVertical: 6, borderRadius: 18, overflow: "hidden", backgroundColor: "#e8f1ee" }}>
              <LocationMap
                height={Math.max(240, windowHeight - insets.top - insets.bottom - 174)}
                point={manualPin ? { ...manualPin, barangayName: manualPinResolution?.barangayName } : undefined}
                pointLabel={manualPinResolution ? manualPinResolution.exact ? manualPinResolution.barangayName : `Near ${manualPinResolution.barangayName}` : undefined}
                showPointCoordinates={false}
                onChoose={(point) => { void checkManualPin(point); }}
                bounds={ILIGAN_MAP_BOUNDS}
              />
            </View>
            <View style={{ gap: 9, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 }}>
              <Text accessibilityLiveRegion="polite" accessibilityRole={manualPinError ? "alert" : undefined} style={manualPinError ? s.error : s.small}>
                {manualPinError || (checkingManualPin ? "Checking barangay…" : manualPinResolution ? manualPinResolution.exact ? `Barangay ${manualPinResolution.barangayName}` : `Nearest mapped barangay: ${manualPinResolution.barangayName}. Confirm if this is correct.` : "Tap the map to set the pin and identify its barangay.")}
              </Text>
              <View style={s.actionRow}>
                <Button secondary grow title="Cancel" onPress={closeManualPin} />
                <Button grow icon="checkmark" title="Confirm location" disabled={!manualPinResolution || checkingManualPin} onPress={confirmManualPin} />
              </View>
            </View>
          </SafeAreaView>
        </View>
      </Modal>}
    </>
  );
}
export function ReportTracking({
  report: initialReport,
  residentId,
  close,
  backLabel = "Back to reports",
  categoryName = "Community report",
  barangayName = "Not specified",
  onMapPageScroll,
}: {
  report: Report;
  residentId: string;
  close: () => void;
  backLabel?: string;
  categoryName?: string;
  barangayName?: string;
  onMapPageScroll?: (delta: number) => void;
}) {
  const [message, setMessage] = useState(""),
    [moreOpen, setMoreOpen] = useState(false),
    [mainTimelineOpen, setMainTimelineOpen] = useState(false);
  const { width: windowWidth } = useWindowDimensions();
  const desktopTracking = Platform.OS === "web" && windowWidth >= 1200;
  const qc = useQueryClient();
  const currentReport = useQuery({
    queryKey: ["resident-report", initialReport.id],
    initialData: initialReport,
    initialDataUpdatedAt: 0,
    refetchInterval: 30_000,
    queryFn: async () => {
      const ownReport = await result<Report | null>(db!.from("reports").select("*").eq("id", initialReport.id).maybeSingle());
      if (ownReport) return ownReport;
      const published = await result<Report[]>(db!.rpc("public_report_by_id", { p_id: initialReport.id }));
      return published[0] ?? null;
    },
  });
  const r = currentReport.data ?? initialReport;
  const duplicateProgress = useQuery({
    queryKey: ["duplicate-progress", r.id],
    enabled: r.status === "duplicate" && currentReport.data !== null,
    staleTime: 30_000,
    refetchInterval: 30_000,
    queryFn: ({ signal }) => result<{
      main_report_id: string; status: Status; organization_name: string | null;
      history: { id: number; new_status: Status; created_at: string }[];
      main_title: string | null; can_open_main: boolean;
    } | null>(db!.rpc("report_duplicate_progress", { p_id: r.id }).abortSignal(signal)),
  });
  const q = useQuery({
    queryKey: ["timeline", r.id, r.organization_id, r.problem_type],
    enabled: currentReport.data !== null,
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => {
      const [problem, engagement, history, following, office] = await Promise.all([
        r.problem_type ? result<{ label: string }>(db!.from("report_problem_types").select("label").eq("category_id", r.category_id).eq("code", r.problem_type).abortSignal(signal).single()) : null,
        result<{ followers: number; endorsements: number }>(db!.rpc("report_engagement", { p_id: r.id }).abortSignal(signal)),
        result<{ id: number; new_status: string; public_note: string; created_at: string; actor_name?: string; action_kind?: string; attachment_count?: number }[]>(
          r.resident_id ? db!.rpc("report_action_history", { p_id: r.id }).abortSignal(signal) :
            db!.from("report_status_history").select("id,new_status,public_note,created_at").eq("report_id", r.id).order("created_at").abortSignal(signal)),
        result<{ report_id: string }[]>(db!.from("report_followers").select("report_id").eq("report_id", r.id).abortSignal(signal)),
        r.organization_id && r.status !== "duplicate" ? result<Lookup>(db!.from("organizations").select("id,name").eq("id", r.organization_id).abortSignal(signal).single()) : null,
      ]);
      return { problem, engagement, history, following, office };
    },
  });
  const attachments = useQuery({
    queryKey: ["report-detail-attachments", r.id],
    enabled: currentReport.data !== null,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const rows = await result<{ path: string }[]>(db!.from("report_attachments").select("path").eq("report_id", r.id).order("path"));
      if (!rows.length) return [] as { path: string; url: string }[];
      const signed = await db!.storage.from("report-evidence").createSignedUrls(rows.map((item) => item.path), 600);
      if (signed.error) throw signed.error;
      return rows.flatMap((item, index) => signed.data[index]?.signedUrl ? [{ ...item, url: signed.data[index].signedUrl! }] : []);
    },
  });
  const goBack = () => { setMoreOpen(false); close(); };
  const following = !!q.data?.following.length;
  const tone = reportStatusTone(r.status);
  const flowStep = reportFlowStep(r.status);
  const categoryTone = categoryToneFor(categoryName);
  const toggleFollow = async () => {
    setMessage("");
    try {
      if (following) await result(db!.from("report_followers").delete().eq("report_id", r.id));
      else await result(db!.from("report_followers").insert({ report_id: r.id }));
      await Promise.all([qc.invalidateQueries({ queryKey: ["timeline", r.id] }), qc.invalidateQueries({ queryKey: ["follows"] })]);
      setMoreOpen(false);
    } catch (error) { setMessage((error as Error).message); }
  };
  const shareSummary = () => void Share.share({
    title: "Iligan Connect report",
    message: `Iligan Connect · ${r.public_summary?.trim() || "A community concern was reported in Iligan City."}`,
  }).catch((error) => setMessage((error as Error).message));
  const actionButton = (icon: "share-social-outline" | "ellipsis-horizontal", labelText: string, onPress: () => void) => <Pressable key={labelText} accessibilityRole="button" accessibilityLabel={labelText} onPress={onPress} style={({ pressed }) => [{ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "white", borderWidth: 1, borderColor: "#f1e9e8" }, pressed && { opacity: 0.7 }]}><Ionicons name={icon} size={20} color={colors.brandDark} /></Pressable>;
  if (currentReport.data === null) return <>
    <AppBackNavigation label={backLabel} onBack={goBack} />
    <View style={s.card}><Text style={s.body}>This report is no longer available to your account.</Text><Button secondary title="Check again" loading={currentReport.isFetching} onPress={() => void currentReport.refetch()} /></View>
  </>;
  return (
    <>
      <AppBackNavigation label={backLabel} onBack={goBack} actions={<>
        {actionButton("share-social-outline", "Share public report summary", shareSummary)}
        {actionButton("ellipsis-horizontal", "More report options", () => setMoreOpen(true))}
      </>} />
      {currentReport.error && <View style={s.card}><Text accessibilityRole="alert" style={s.error}>Could not refresh this report. The details below may be out of date.</Text><Button secondary title="Retry report" loading={currentReport.isFetching} onPress={() => void currentReport.refetch()} /></View>}
      <View style={{ gap: 9, paddingHorizontal: 2, paddingBottom: 2 }}>
        <Text accessibilityRole="header" style={[s.heading, { fontSize: 25, lineHeight: 31 }]}>{r.title}</Text>
        {!!r.description && <>
          <Text style={[s.body, { color: colors.muted }]}>{r.description}</Text>
        </>}
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <View style={{ maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 13, backgroundColor: categoryTone.background }}><Ionicons name={categoryIconFor(categoryName)} size={16} color={categoryTone.foreground} /><Text style={{ color: categoryTone.foreground, fontSize: 12, fontWeight: "800", flexShrink: 1 }}>{categoryDisplayName(categoryName)}{q.data?.problem ? ` · ${q.data.problem.label}` : ""}</Text></View>
          <View style={{ maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 20, backgroundColor: tone.background }}><Ionicons name={r.status === "resolved" ? "checkmark-circle" : r.status === "rejected" ? "close-circle" : "time-outline"} size={16} color={tone.foreground} /><Text style={{ color: tone.foreground, fontSize: 12, fontWeight: "800", flexShrink: 1 }}>{r.status === "duplicate" ? "Linked duplicate" : reportStatusLabel(r.status)}</Text></View>
        </View>
        {!!r.problem_other && <Text style={s.small}>{r.problem_other}</Text>}
      </View>

      <Text style={s.body}>{reportStatusDescription(r.status)}</Text>
      {flowStep !== null && <View accessibilityRole="progressbar" accessibilityLabel={`Report progress: ${flowStep === 2 ? "Resolved" : flowStep === 1 ? "Schedule and work" : "Review"}`} accessibilityValue={{ min: 1, max: 3, now: flowStep + 1 }} style={{ position: "relative", flexDirection: "row", alignItems: "flex-start", paddingVertical: 5 }}>
        <View pointerEvents="none" style={{ position: "absolute", top: desktopTracking ? 18 : 17, left: "16.67%", right: "16.67%", height: 2, backgroundColor: "#dce6e8" }}>
          <View style={{ width: `${(r.status === "resolved" ? 100 : Math.max(0, Math.min(2, flowStep)) * 50)}%`, height: 2, backgroundColor: "#75c9b3" }} />
        </View>
        {["Review", "Schedule & work", "Resolved"].map((stage, index) => {
          const complete = index < flowStep || r.status === "resolved";
          const active = index === flowStep && r.status !== "resolved";
          const dotSize = desktopTracking ? 28 : 26;
          return <View key={stage} style={{ flex: 1, minWidth: 0, alignItems: "center", gap: desktopTracking ? 8 : 5 }}>
            <View style={{ width: dotSize, height: dotSize, borderRadius: dotSize / 2, alignItems: "center", justifyContent: "center", backgroundColor: complete ? colors.brand : active ? "#e2f5ef" : "#edf2f4", borderWidth: active ? 1 : 0, borderColor: colors.brand }}><Text style={{ color: complete ? "white" : active ? colors.brand : colors.muted, fontSize: 11, fontWeight: "800" }}>{complete ? "✓" : index + 1}</Text></View>
            <Text numberOfLines={2} style={{ color: active || complete ? colors.brandDark : colors.muted, fontSize: desktopTracking ? 12 : 10, lineHeight: desktopTracking ? 16 : 13, fontWeight: active ? "800" : "600", textAlign: "center" }}>{stage}</Text>
          </View>;
        })}
      </View>}
      {r.status === "scheduled" && r.scheduled_at && <View style={[s.card, { flexDirection: "row", alignItems: "center", gap: 12, borderColor: "#cfe7e1", backgroundColor: "#f3faf8" }]}>
        <View style={{ width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "#e1f2ec" }}><Ionicons name="calendar-outline" size={20} color={colors.brand} /></View>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text style={s.small}>PLANNED WORK · PHILIPPINE TIME</Text><Text style={[s.title, { marginBottom: 0 }]}>{reportScheduleLabel(r.scheduled_at)}</Text></View>
      </View>}
      {r.status === "duplicate" && <View style={[s.card, { gap: 12, borderColor: "#cfe5dd", backgroundColor: "#f4faf7" }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}><Ionicons name="git-merge-outline" size={22} color={colors.brand} /><Text style={[s.title, { flex: 1, marginBottom: 0 }]}>Main report progress</Text></View>
        <Text style={s.small}>This submission is linked to the main report. Follow its progress here. Your submission and photos stay separate.</Text>
        {duplicateProgress.error ? <View style={{ gap: 8 }}><Text accessibilityRole="alert" style={s.error}>Could not refresh the main report’s progress.</Text><Button secondary title="Retry main report progress" loading={duplicateProgress.isFetching} onPress={() => void duplicateProgress.refetch()} /></View>
          : duplicateProgress.isPending ? <Text accessibilityLiveRegion="polite" style={s.small}>Loading main report progress…</Text>
          : !duplicateProgress.data ? <View style={{ gap: 8 }}><Text style={s.small}>The main report link is unavailable. Your submission is still recorded.</Text><Button secondary title="Check main report link" loading={duplicateProgress.isFetching} onPress={() => void duplicateProgress.refetch()} /></View>
          : <>
            <View style={{ alignSelf: "flex-start", paddingHorizontal: 11, paddingVertical: 7, borderRadius: 18, backgroundColor: reportStatusTone(duplicateProgress.data.status).background }}><Text accessibilityLabel={`Main report status: ${reportStatusLabel(duplicateProgress.data.status)}`} style={{ color: reportStatusTone(duplicateProgress.data.status).foreground, fontSize: 14, fontWeight: "800" }}>{reportStatusLabel(duplicateProgress.data.status)}</Text></View>
            {duplicateProgress.data.main_title && <Text style={s.fieldLabel}>{duplicateProgress.data.main_title}</Text>}
            <Text style={s.small}>Main report · {duplicateProgress.data.main_report_id.slice(0, 8).toUpperCase()}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Main report updates" accessibilityState={{ expanded: mainTimelineOpen }} aria-expanded={mainTimelineOpen} onPress={() => setMainTimelineOpen(!mainTimelineOpen)} style={{ minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}><Text style={[s.fieldLabel, { flex: 1 }]}>Main report updates ({duplicateProgress.data.history.length})</Text><Ionicons name={mainTimelineOpen ? "chevron-up" : "chevron-down"} size={19} color={colors.brand} /></Pressable>
            {mainTimelineOpen && (duplicateProgress.data.history.length ? <ReportTimeline history={duplicateProgress.data.history.map(event => ({ ...event, public_note: "" }))} currentStatus={duplicateProgress.data.status} /> : <Text style={s.small}>No main report updates have been recorded yet.</Text>)}
          </>}
      </View>}

      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 9 }}>
        <View style={[s.card, { width: windowWidth < 360 ? "100%" : "48.5%", minHeight: 106, justifyContent: "center", gap: 9, padding: 12, borderColor: "#e0efec", backgroundColor: "#fff" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}><View style={{ width: 30, height: 30, borderRadius: 11, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}><Ionicons name="location-outline" size={17} color={colors.brand} /></View><Text style={{ color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 0.6 }}>BARANGAY</Text></View>
          <View style={{ gap: 2 }}><Text numberOfLines={2} style={{ color: colors.brandDark, fontSize: 14, lineHeight: 18, fontWeight: "800" }}>{barangayName === "Not specified" ? "Not specified" : barangayName}</Text><Text numberOfLines={1} style={{ color: colors.muted, fontSize: 10, lineHeight: 14 }}>Iligan City · Lanao del Norte</Text></View>
        </View>
        <View style={[s.card, { width: windowWidth < 360 ? "100%" : "48.5%", minHeight: 106, justifyContent: "center", gap: 9, padding: 12, borderColor: "#e0efec", backgroundColor: "#fff" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}><View style={{ width: 30, height: 30, borderRadius: 11, backgroundColor: "#eaf2ff", alignItems: "center", justifyContent: "center" }}><Ionicons name="business-outline" size={17} color="#3972b8" /></View><Text style={{ color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 0.6 }}>{r.status === "duplicate" ? "MAIN REPORT OFFICE" : "HANDLING TEAM"}</Text></View>
          <Text style={{ color: colors.brandDark, fontSize: 14, lineHeight: 18, fontWeight: "800" }}>{r.status === "duplicate" ? duplicateProgress.isPending ? "Loading main report office…" : duplicateProgress.error ? "Main report office unavailable" : duplicateProgress.data ? duplicateProgress.data.organization_name || "Awaiting assignment" : "Main report link unavailable" : q.isPending ? "Loading office…" : q.data?.office?.name || (r.organization_id ? "Office details unavailable" : r.resident_id ? `${barangayName || "Local"} barangay` : "Office details are private")}</Text>
        </View>
      </View>

      <View style={[s.card, { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 8, gap: 6, backgroundColor: "#eff9f6", borderColor: "#eff9f6" }]}>
        <EngagementMetric icon="people-outline" value={q.data?.engagement.followers} label="Followers" />
        <View style={{ width: 1, height: 38, backgroundColor: "#cfe7e1" }} />
        <EngagementMetric icon="share-social-outline" value={q.data?.engagement.endorsements} label="Shared experience" />
        <View style={{ width: 1, height: 38, backgroundColor: "#cfe7e1" }} />
        <EngagementMetric icon="time-outline" value={r.status === "duplicate" ? duplicateProgress.error ? undefined : duplicateProgress.data?.history.length : q.data?.history.length} label={r.status === "duplicate" ? "Main updates" : "Updates"} />
      </View>

      <View style={{ borderRadius: 20, overflow: "hidden", borderWidth: 1, borderColor: colors.line, backgroundColor: "white" }}>
        <View style={{ padding: 14, gap: 8 }}>
          <Text style={s.fieldLabel}>Reported location</Text>
          {!!(r.purok || r.zone) && <Text style={s.body}>{[r.purok && `Purok: ${r.purok}`, r.zone && `Zone: ${r.zone}`].filter(Boolean).join(" · ")}</Text>}
          {!!r.landmark && <Text style={s.body}>{r.landmark}</Text>}
          {!!r.location_address && <Text style={s.small}>{r.location_address}</Text>}
          <Text style={s.small}>{hasReportCoordinates(r) ? `${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)}${r.resident_id ? "" : " · Approximate public location"}` : "Manual address · No map pin provided."}</Text>
          {r.location_source === "gps" && r.location_accuracy != null && <Text style={s.small}>GPS accuracy: about ±{Math.round(r.location_accuracy)} m.</Text>}
          {hasReportCoordinates(r) && <Button secondary title="Open location in Maps" onPress={() => { void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${r.latitude},${r.longitude}`).catch(() => setMessage("Could not open Maps. Use the coordinates shown above.")); }} />}
        </View>
        {hasReportCoordinates(r) && <LocationMap point={{ latitude: r.latitude, longitude: r.longitude, title: r.title, categoryName, color: categoryTone.foreground, subtitle: `${barangayName === "Not specified" ? "Iligan City" : barangayName} · ${r.resident_id ? "reported location" : "approximate location"}` }} height={Math.max(190, Math.min(320, Math.round(windowWidth * 0.62)))} onPageScroll={onMapPageScroll} bounds={ILIGAN_MAP_BOUNDS} />}
        <View style={{ minHeight: 64, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 13, backgroundColor: "white" }}><View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}><Ionicons name="calendar-outline" size={19} color={colors.brand} /></View><View style={{ flex: 1, gap: 2 }}><Text style={s.fieldLabel}>Submitted · Philippine time</Text><Text style={s.small}>{new Date(r.created_at).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" })}</Text></View></View>
      </View>

      <View style={s.card}>
        <View style={{ gap: 3 }}><Text style={s.title}>{r.status === "duplicate" ? "Your report history" : "Report timeline"}</Text><Text style={s.small}>{r.status === "duplicate" ? "Your original submission and the decision to link it are retained below. Current progress is shown with the main report above." : "Track the progress of this report from submission to resolution."}</Text></View>
        {q.error ? <View style={{ gap: 8 }}><Text accessibilityRole="alert" style={s.error}>Could not load report updates.</Text><Button secondary title="Retry report updates" onPress={() => void q.refetch()} /></View> : q.isPending ? <ReportTimelineSkeleton /> : q.data?.history.length ? <ReportTimeline history={q.data.history} currentStatus={r.status} /> : <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 }}><Ionicons name="time-outline" size={18} color={colors.muted} /><Text style={s.small}>No progress updates have been recorded yet.</Text></View>}
      </View>

      <ReportAttachments items={attachments.data ?? []} loading={attachments.isPending} error={attachments.error ? "Could not load report photos." : ""} onRetry={() => void attachments.refetch()} />
      {!!message && <Text accessibilityRole="alert" style={s.error}>{message}</Text>}

      <Modal visible={moreOpen} transparent animationType="fade" onRequestClose={() => setMoreOpen(false)}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#0a253355" }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close report options" onPress={() => setMoreOpen(false)} style={{ flex: 1 }} />
          <View style={{ padding: 20, paddingBottom: 28, gap: 12, backgroundColor: "white", borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
            <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: "#cbd7dc", alignSelf: "center", marginBottom: 3 }} />
            <Text style={s.title}>Report options</Text>
            {r.resident_id === residentId ? <Text style={s.small}>Updates to your own reports appear automatically when in-app notifications are enabled in your profile.</Text> : <Pressable accessibilityRole="button" accessibilityState={{ disabled: q.isPending || !!q.error }} disabled={q.isPending || !!q.error} onPress={() => void toggleFollow()} style={{ minHeight: 52, flexDirection: "row", alignItems: "center", gap: 11, borderRadius: 14, paddingHorizontal: 12, backgroundColor: colors.brandSoft }}><Ionicons name={following ? "bookmark" : "bookmark-outline"} size={20} color={colors.brand} /><Text style={{ flex: 1, color: colors.brandDark, fontSize: 14, fontWeight: "700" }}>{following ? "Unfollow report updates" : "Follow report updates"}</Text><Ionicons name="chevron-forward" size={18} color={colors.muted} /></Pressable>}
            {!!message && <Text accessibilityRole="alert" style={s.error}>{message}</Text>}
            <Button secondary title="Close" onPress={() => setMoreOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}

function reportStatusTone(status: string) {
  const value = status.toLowerCase().replace(/[_-]/g, " ");
  if (value.includes("resolved")) return { background: "#e5f3e9", foreground: "#286b3b" };
  if (value.includes("rejected") || value.includes("cancelled")) return { background: "#ffefed", foreground: "#a43d35" };
  if (value.includes("progress")) return { background: "#fff3dc", foreground: "#865a0b" };
  if (value.includes("scheduled")) return { background: "#eaf2ff", foreground: "#315b92" };
  if (value.includes("review")) return { background: "#eaf2ff", foreground: "#315b92" };
  if (value.includes("assigned")) return { background: "#f0eaff", foreground: "#6844a3" };
  if (value.includes("verified")) return { background: "#e8f1ff", foreground: "#3264a0" };
  return statusToneFor(status);
}

function reportFlowStep(status: string): number | null {
  if (status === "submitted" || status === "under_review") return 0;
  if (["verified", "assigned", "scheduled", "in_progress"].includes(status)) return 1;
  if (status === "resolved") return 2;
  return null;
}

function EngagementMetric({ icon, value, label: text }: { icon: "people-outline" | "share-social-outline" | "time-outline"; value?: number; label: string }) {
  return <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }}><Ionicons name={icon} size={19} color={colors.brand} /><View style={{ flex: 1, minWidth: 0, gap: 3 }}>{value === undefined ? <View style={{ width: 20, height: 14, borderRadius: 4, backgroundColor: "#dce7e3" }} /> : <Text style={{ color: colors.brandDark, fontSize: 15, fontWeight: "800" }}>{value}</Text>}<Text numberOfLines={2} style={{ color: colors.muted, fontSize: 9, lineHeight: 12 }}>{text}</Text></View></View>;
}

function ReportTimelineSkeleton() {
  return <View style={{ gap: 0 }}>
    {[0, 1, 2].map((item) => <View key={item} style={{ minHeight: 66, flexDirection: "row", gap: 12 }}>
      <View style={{ width: 22, alignItems: "center" }}><View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: "#dce7e3" }} />{item < 2 && <View style={{ width: 2, flex: 1, backgroundColor: "#e2eeea" }} />}</View>
      <View style={{ flex: 1, gap: 8, paddingBottom: 12 }}><View style={{ width: "38%", height: 13, borderRadius: 5, backgroundColor: "#dce7e3" }} /><View style={{ width: "78%", height: 11, borderRadius: 5, backgroundColor: "#e7eeeb" }} /></View>
    </View>)}
  </View>;
}

function ReportTimeline({ history, currentStatus }: { history: { id: number; new_status: string; public_note: string; created_at: string; actor_name?: string; action_kind?: string; attachment_count?: number }[]; currentStatus: string }) {
  return <View>
    {history.map((event, index) => {
      const isCurrent = index === history.length - 1 && event.new_status === currentStatus;
      const tone = reportStatusTone(event.new_status);
      const exceptional = /rejected|cancelled/i.test(event.new_status);
      return <View key={event.id} style={{ minHeight: 66, flexDirection: "row", gap: 12 }}>
        <View style={{ width: 22, alignItems: "center" }}><View style={{ width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: tone.foreground }}><Ionicons name={exceptional ? "close" : "checkmark"} size={14} color="white" /></View>{index < history.length - 1 && <View style={{ width: 2, flex: 1, backgroundColor: "#b9dfd5" }} />}</View>
        <View style={{ flex: 1, minWidth: 0, gap: 3, paddingBottom: index < history.length - 1 ? 13 : 0 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 4 }}><Text style={{ flexShrink: 1, color: colors.brandDark, fontSize: 14, fontWeight: "800" }}>{event.action_kind === "progress_update" ? "Progress update" : event.action_kind === "personnel_assignment" ? "Barangay personnel assigned" : reportStatusLabel(event.new_status)}{isCurrent ? " · Current" : ""}</Text><Text style={{ color: colors.muted, fontSize: 10 }}>{new Date(event.created_at).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" })}</Text></View>
          {!!event.actor_name && <Text style={s.small}>By {event.actor_name}</Text>}
          {!!event.public_note && <Text style={s.small}>{event.public_note}</Text>}
          {!!event.attachment_count && <Text style={s.small}>{event.attachment_count} photos for action #{event.id} in Report photos.</Text>}
        </View>
      </View>;
    })}
  </View>;
}

function ReportAttachments({ items, loading, error, onRetry }: { items: { path: string; url: string }[]; loading: boolean; error: string; onRetry: () => void }) {
  const { width, height } = useWindowDimensions();
  const [open, setOpen] = useState(false), [index, setIndex] = useState(0);
  const viewer = useRef<ScrollView>(null);
  const slideWidth = width;
  function showPhoto(next: number) { setIndex(next); setOpen(true); }
  function move(next: number) {
    const value = Math.max(0, Math.min(items.length - 1, next));
    setIndex(value);
    viewer.current?.scrollTo({ x: value * slideWidth, animated: true });
  }
  return <View style={s.card}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}><Ionicons name="images-outline" size={21} color={colors.brand} /><View style={{ flex: 1, gap: 2 }}><Text style={s.title}>Photos and attachments</Text><Text style={s.small}>View photos or files related to this report.</Text></View><Pressable accessibilityRole="button" accessibilityLabel={`View all ${items.length} report photos`} disabled={!items.length} onPress={() => showPhoto(0)} style={{ minHeight: 48, paddingHorizontal: 10, borderRadius: 13, backgroundColor: colors.brandSoft, flexDirection: "row", alignItems: "center", gap: 5, opacity: items.length ? 1 : 0.5 }}><Text style={{ color: colors.brand, fontSize: 11, fontWeight: "800" }}>View all ({loading ? "…" : items.length})</Text><Ionicons name="chevron-forward" size={16} color={colors.brand} /></Pressable></View>
    {loading ? <View style={{ height: 92, borderRadius: 13, backgroundColor: "#e7eeeb" }} /> : error ? <View style={{ gap: 8 }}><Text accessibilityRole="alert" style={s.error}>{error}</Text><Button secondary title="Retry attachments" onPress={onRetry} /></View> : items.length ? <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ gap: 9 }}>
      {items.map((item, itemIndex) => <Pressable key={item.path} accessibilityRole="button" accessibilityLabel={`View report photo ${itemIndex + 1} of ${items.length}`} onPress={() => showPhoto(itemIndex)} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}><Image source={{ uri: item.url }} resizeMode="cover" style={{ width: Math.min(152, width * 0.42), height: 92, borderRadius: 13, backgroundColor: "#eaf2f1", borderWidth: 1, borderColor: colors.line }} /><View pointerEvents="none" style={{ position: "absolute", right: 6, bottom: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: "#ffffffed", alignItems: "center", justifyContent: "center" }}><Ionicons name="expand-outline" size={13} color={colors.brandDark} /></View></Pressable>)}
    </ScrollView> : <View style={{ minHeight: 74, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 13, backgroundColor: "#f5f9f7" }}><Ionicons name="image-outline" size={18} color={colors.muted} /><Text style={s.small}>No photos or files are attached to this report.</Text></View>}
    {open && <Modal visible transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={() => setOpen(false)} onShow={() => viewer.current?.scrollTo({ x: index * slideWidth, animated: false })}>
      <View style={{ flex: 1, backgroundColor: "#06111e", justifyContent: "center" }}>
        <ScrollView ref={viewer} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={(event) => setIndex(Math.round(event.nativeEvent.contentOffset.x / slideWidth))}>
          {items.map((item) => <View key={item.path} style={{ width: slideWidth, height, alignItems: "center", justifyContent: "center" }}><Image source={{ uri: item.url }} resizeMode="contain" style={{ width: slideWidth, height: height * 0.82 }} /></View>)}
        </ScrollView>
        <Pressable accessibilityRole="button" accessibilityLabel="Close photo viewer" onPress={() => setOpen(false)} style={{ position: "absolute", top: 48, right: 18, width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffffed" }}><Ionicons name="close" size={24} color={colors.brandDark} /></Pressable>
        {items.length > 1 && <>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous photo" disabled={!index} onPress={() => move(index - 1)} style={{ position: "absolute", left: 12, top: "48%", width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffffdd", opacity: index ? 1 : 0.45 }}><Ionicons name="chevron-back" size={23} color={colors.brandDark} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Next photo" disabled={index >= items.length - 1} onPress={() => move(index + 1)} style={{ position: "absolute", right: 12, top: "48%", width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffffdd", opacity: index < items.length - 1 ? 1 : 0.45 }}><Ionicons name="chevron-forward" size={23} color={colors.brandDark} /></Pressable>
        </>}
        <Text style={{ position: "absolute", bottom: 28, alignSelf: "center", color: "white", fontSize: 13, fontWeight: "700" }}>{index + 1} of {items.length}</Text>
      </View>
    </Modal>}
  </View>;
}
export function Explore({
  categories,
  barangays,
  myBarangayId = "",
  onOpenReport,
  onMapGestureActiveChange,
  onMapPageScroll,
  suspendExpandedMap = false,
  includeSamples = false,
}: {
  categories: Lookup[];
  barangays: Lookup[];
  myBarangayId?: string;
  onOpenReport: (report: Report) => void;
  onMapGestureActiveChange?: (active: boolean) => void;
  onMapPageScroll?: (delta: number) => void;
  suspendExpandedMap?: boolean;
  includeSamples?: boolean;
}) {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const desktopExplore = Platform.OS === "web" && windowWidth >= 1200;
  const tabletExplore = Platform.OS === "web" && windowWidth >= 768 && windowWidth < 1200;
  const compactFilterLayout = windowWidth < 480;
  const compactTabletExplore = tabletExplore && windowHeight < 760;
  const thumbnailWidth = windowWidth < 390 ? 76 : 88;
  const mapHeight = windowWidth < 600
    ? Math.max(260, Math.min(300, Math.round(windowHeight * 0.3)))
    : tabletExplore
      ? Math.max(compactTabletExplore ? 270 : 290, Math.min(390, Math.round(Math.min(windowHeight * 0.46, windowWidth * 0.42))))
    : desktopExplore
      ? Math.max(560, Math.min(780, Math.round(windowHeight * 0.72)))
    : Math.max(330, Math.min(400, Math.round(windowHeight * 0.43)));
  const [category, setCategory] = useState(""),
    [barangay, setBarangay] = useState(""),
    [search, setSearch] = useState(""),
    [appliedSearch, setAppliedSearch] = useState(""),
    [filtersOpen, setFiltersOpen] = useState(false),
    [showMap, setShowMap] = useState(true),
    [showBarangayMap, setShowBarangayMap] = useState(false),
    [barangayMetric, setBarangayMetric] = useState<"density" | "count">("density"),
    [selectedChoroplethName, setSelectedChoroplethName] = useState(""),
    [density, setDensity] = useState(false),
    [mapStatus, setMapStatus] = useState("active"),
    [recentOnly, setRecentOnly] = useState(false),
    [expandedMap, setExpandedMap] = useState(false),
    [mapStyle, setMapStyle] = useState<MapStyle>("satellite"),
    [showPins, setShowPins] = useState(true),
    [densityCellCount, setDensityCellCount] = useState<number | null>(null),
    [selectedReportId, setSelectedReportId] = useState<string | null>(null),
    [selectedListReportId, setSelectedListReportId] = useState<string | null>(null),
    [reportActionsOpen, setReportActionsOpen] = useState(false),
    [failedPhotos, setFailedPhotos] = useState<Record<string, boolean>>({}),
    [currentLocation, setCurrentLocation] = useState<{ latitude: number; longitude: number } | undefined>(),
    [locating, setLocating] = useState(false),
    [nearbyRadius, setNearbyRadius] = useState("0"),
    [page, setPage] = useState(0),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const photoRetryIds = useRef(new Set<string>());
  const mapViewport = useRef<Region>({ latitude: 8.228, longitude: 124.2452, latitudeDelta: 0.05, longitudeDelta: 0.05 });
  const setMapViewport = useCallback((region: Region) => { mapViewport.current = region; }, []);
  const selectMapPoint = useCallback((point: Point) => setSelectedReportId(point.id ?? null), []);
  const expandMap = useCallback(() => setExpandedMap(true), []);
  useEffect(() => {
    const timer = setTimeout(() => setAppliedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const q = useQuery({
    queryKey: ["public-reports", includeSamples],
    refetchInterval: 30_000,
    queryFn: ({ signal }) => result<Report[]>(db!.rpc("public_reports").abortSignal(signal)),
  });
  const follows = useQuery({
    queryKey: ["follows"],
    queryFn: () =>
      result<{ report_id: string }[]>(
        db!.from("report_followers").select("report_id"),
      ),
  });
  const mapQuery = q;
  const categoryNames = useMemo(() => new Map(categories.map((item) => [item.id, item.name])), [categories]);
  const barangayNames = useMemo(() => new Map(barangays.map((item) => [item.id, item.name])), [barangays]);
  const countableReports = useMemo(() => {
    const term = appliedSearch.toLowerCase();
    const since = Date.now() - 30 * 86400000;
    return (q.data ?? []).filter((item) =>
      (!category || item.category_id === category) &&
      (!barangay || item.barangay_id === barangay) &&
      (!recentOnly || Date.parse(item.created_at) >= since) &&
      (!term || [item.title, categoryNames.get(item.category_id), barangayNames.get(item.barangay_id)]
        .some((value) => value?.toLowerCase().includes(term))),
    );
  }, [q.data, category, barangay, recentOnly, appliedSearch, categoryNames, barangayNames]);
  const matchingReports = useMemo(() => countableReports.filter((item) =>
    mapStatus === "all" || (mapStatus === "resolved" ? item.status === "resolved" : item.status !== "resolved")),
    [countableReports, mapStatus]);
  const reports = useMemo(() => matchingReports.slice(page * 30, page * 30 + 30), [matchingReports, page]);
  const resolvedCount = useMemo(() => countableReports.filter((item) => item.status === "resolved").length, [countableReports]);
  const counts = {
    all_count: countableReports.length,
    active_count: countableReports.length - resolvedCount,
    resolved_count: resolvedCount,
  };
  const mapReports = useMemo(() => !Number(nearbyRadius) ? matchingReports : matchingReports.filter((item) =>
    !!currentLocation && hasReportCoordinates(item) && distanceMeters(currentLocation, item) <= Number(nearbyRadius)),
    [matchingReports, nearbyRadius, currentLocation]);
  const selectedBarangay = useMemo(() => barangays.find((item) => barangayMapKey(item.name) === barangayMapKey(selectedChoroplethName)), [barangays, selectedChoroplethName]);
  const selectedBarangayReports = useMemo(() => selectedBarangay ? mapReports.filter((item) => item.barangay_id === selectedBarangay.id) : [], [mapReports, selectedBarangay]);
  const photoReportIds = useMemo(() => showMap
    ? [...new Set([...mapReports.filter((item) => item.id === selectedReportId).map((item) => item.id), ...(showBarangayMap && selectedChoroplethName ? selectedBarangayReports.slice(0, 30).map((item) => item.id) : [])])]
    : reports.map((item) => item.id), [showMap, mapReports, selectedReportId, reports, showBarangayMap, selectedChoroplethName, selectedBarangayReports]);
  const reportPhotos = useQuery({
    queryKey: ["explore-report-photos", photoReportIds],
    enabled: photoReportIds.length > 0,
    staleTime: 45 * 60 * 1000,
    retry: 2,
    queryFn: async () => {
      const empty = { urls: {} as Record<string, string>, counts: {} as Record<string, number> };
      const attachments = await result<{ report_id: string; path: string }[]>(
        db!.from("report_attachments").select("report_id,path").in("report_id", photoReportIds).order("report_id").order("path"),
      );
      if (!attachments.length) return empty;
      const reportPhotoUrls: Record<string, string> = {};
      let signingError: unknown;
      try {
        const signed = await db!.storage.from("report-evidence").createSignedUrls(attachments.map((item) => item.path), 3600);
        if (signed.error) throw signed.error;
        signed.data?.forEach((item, index) => {
          const reportId = attachments[index]?.report_id;
          if (reportId && item?.signedUrl && !reportPhotoUrls[reportId]) reportPhotoUrls[reportId] = item.signedUrl;
        });
      } catch (error) { signingError = error; }
      const missingReports = [...new Set(attachments.map((item) => item.report_id))].filter((id) => !reportPhotoUrls[id]);
      const recovered = await Promise.all(missingReports.map(async (reportId) => {
        for (const item of attachments.filter((attachment) => attachment.report_id === reportId)) {
          try {
            const signed = await db!.storage.from("report-evidence").createSignedUrl(item.path, 3600);
            if (!signed.error && signed.data?.signedUrl) return [reportId, signed.data.signedUrl] as const;
          } catch { /* Try the next attachment for this report. */ }
        }
        return null;
      }));
      recovered.forEach((item) => { if (item) reportPhotoUrls[item[0]] = item[1]; });
      if (missingReports.length && !Object.keys(reportPhotoUrls).length) {
        throw signingError ?? new Error("Could not create report photo links.");
      }
      return { urls: reportPhotoUrls, counts: attachments.reduce<Record<string, number>>((counts, item) => {
        counts[item.report_id] = (counts[item.report_id] ?? 0) + 1;
        return counts;
      }, {}) };
    },
  });
  const retryReportPhoto = (id: string) => {
    if (photoRetryIds.current.has(id)) { setFailedPhotos((value) => ({ ...value, [id]: true })); return; }
    photoRetryIds.current.add(id);
    setFailedPhotos((value) => ({ ...value, [id]: true }));
    void reportPhotos.refetch().then(({ data }) => setFailedPhotos((value) => ({ ...value, [id]: !data?.urls[id] })));
  };
  const mapPoints = useMemo(() => mapReports.filter(hasReportCoordinates).map((report) => {
    const categoryName = categoryNames.get(report.category_id) || "Other reports";
    return { ...report, createdAt: report.created_at, categoryName, color: categoryToneFor(categoryName).foreground,
      photoUrl: reportPhotos.data?.urls[report.id],
      statusLabel: reportStatusLabel(report.status),
      barangayName: barangayNames.get(report.barangay_id) ?? "Iligan City",
      subtitle: `${reportStatusLabel(report.status)} · ${barangayNames.get(report.barangay_id) ?? "Community"}` };
  }), [mapReports, reportPhotos.data, categoryNames, barangayNames]);
  const barangayCounts = useMemo(() => mapReports.reduce<Record<string, number>>((counts, report) => {
    const name = barangayNames.get(report.barangay_id);
    if (name) {
      const key = barangayMapKey(name);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, {}), [mapReports, barangayNames]);
  const mappedBarangayReportCount = useMemo(() => Object.values(barangayCounts).reduce((total, count) => total + count, 0), [barangayCounts]);
  const barangayHeatStats = useMemo(() => {
    const rows = iliganBarangayBoundaries.map((feature) => {
      const name = feature.properties.adm4_en;
      const count = barangayCounts[barangayMapKey(name)] ?? 0;
      const area = barangayAreaKm2(feature);
      return { name, count, area, density: barangayDensity(count, area) };
    });
    return { maxDensity: Math.max(0, ...rows.map((row) => row.density)), top: rows.filter((row) => row.count > 0).sort((a, b) => b.density - a.density).slice(0, 5) };
  }, [barangayCounts]);
  const selectBarangayOnMap = useCallback((name: string) => setSelectedChoroplethName((current) => current === name ? "" : name), []);
  const mapScope = [
    mapStatus !== "all" && (mapStatus === "active" ? "Unresolved" : "Resolved"),
    recentOnly && "Last 30 days",
    "Published reports",
  ].filter(Boolean).join(" · ");
  const pinCategories = [...new Map(mapPoints.map((point) => [point.categoryName, point.color])).entries()];
  const selectedMapReport = showPins ? mapPoints.find((point) => point.id === selectedReportId) : undefined;
  const selectedListReport = reports.find((item) => item.id === selectedListReportId);
  const hasActiveFilters = !!(category || barangay || search || mapStatus !== "active" || recentOnly);
  const renderBarangayReportRows = (items: Report[]) => items.map((report) => {
    const name = categoryNames.get(report.category_id) || "Other reports";
    const tone = categoryToneFor(name);
    const photo = reportPhotos.data?.urls[report.id];
    return <Pressable key={report.id} accessibilityRole="button" accessibilityLabel={`Open report: ${report.title}`} onPress={() => onOpenReport(report)} style={({ pressed }) => [{ minHeight: 60, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderTopWidth: 1, borderColor: "#e7eff1" }, pressed && { opacity: 0.75 }]}>
      {photo && !failedPhotos[report.id] ? <PhotoViewer source={{ uri: photo }} label={`${categoryDisplayName(name)} report photo`} onError={() => retryReportPhoto(report.id)} style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: tone.background }} /> : <View style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: tone.background, alignItems: "center", justifyContent: "center" }}><Ionicons name={categoryIconFor(name)} size={19} color={tone.foreground} /></View>}
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text numberOfLines={1} style={{ color: colors.brandDark, fontSize: 12, fontWeight: "700" }}>{report.title}</Text><Text numberOfLines={1} style={s.small}>{categoryDisplayName(name)} · {reportStatusLabel(report.status)} · {new Date(report.created_at).toLocaleDateString()}</Text></View><Ionicons name="chevron-forward" size={17} color={colors.muted} />
    </Pressable>;
  });
  const locateNearby = useCallback(async (radius = nearbyRadius) => {
    if (locating) return;
    setLocating(true);
    setMessage("");
    try {
      const location = await currentDeviceLocation();
      setCurrentLocation(location);
      setNearbyRadius(radius);
      setDensityCellCount(null);
      setSelectedReportId(null);
      setMessage(location.accuracy !== null ? `Location found (approximately ±${Math.round(location.accuracy)} m). Nearby distances use privacy-rounded report locations.` : "Location found. Nearby distances are approximate.");
    } catch (error) { setMessage((error as Error).message); }
    finally { setLocating(false); }
  }, [nearbyRadius, locating]);
  const locateOnMap = useCallback(() => { void locateNearby(); }, [locateNearby]);
  async function toggleFollow(id: string) {
    const following = follows.data?.some((item) => item.report_id === id);
    setBusy(true);
    setMessage("");
    try {
      await result(following ? db!.from("report_followers").delete().eq("report_id", id)
        : db!.from("report_followers").insert({ report_id: id, endorsement: true }));
      await qc.invalidateQueries({ queryKey: ["follows"] });
      setMessage(following ? "Unfollowed report." : "You’re supporting this report and will receive permitted updates.");
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  const shareListReport = () => {
    if (!selectedListReport) return;
    setReportActionsOpen(false);
    void Share.share({ title: "Iligan Connect report", message: `Iligan Connect · ${selectedListReport.title} · ${barangays.find((item) => item.id === selectedListReport.barangay_id)?.name ?? "Iligan City"}` })
      .catch((error) => setMessage((error as Error).message));
  };
  return (
    <>
      {!desktopExplore && <View style={{ minHeight: tabletExplore ? compactTabletExplore ? 112 : 124 : 140, justifyContent: "center", overflow: "hidden", paddingHorizontal: tabletExplore ? 15 : 18, paddingVertical: tabletExplore ? 8 : 10, borderRadius: tabletExplore ? 20 : 24, borderWidth: 1, borderColor: "#dcece8", backgroundColor: "#edf8f5" }}>
        <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={{ position: "absolute", right: desktopExplore ? 14 : -8, top: desktopExplore ? -18 : -8, width: desktopExplore ? "55%" : "70%", height: desktopExplore ? "130%" : "116%", opacity: 0.72 }}>
          <Image source={require("../assets/iligan-explore-aerial.png")} accessible={false} resizeMode="contain" style={{ width: "100%", height: "100%" }} />
        </View>
        <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: desktopExplore ? "60%" : "64%", backgroundColor: "#ffffff35" }} />
        <View style={{ width: windowWidth < 390 ? "64%" : "58%", gap: 4, zIndex: 1 }}>
          <Text numberOfLines={2} style={{ color: colors.brandDark, fontSize: 21, lineHeight: 24, fontWeight: "800", letterSpacing: -0.35 }}>Around your community</Text>
          <Text numberOfLines={2} style={{ color: colors.brandDark, fontSize: 12, lineHeight: 16 }}>See what neighbors have reported nearby.</Text>
          <View style={{ alignSelf: "flex-start", minHeight: 30, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, borderRadius: 18, backgroundColor: "#d9f3f0" }}><Ionicons name="location" size={14} color={colors.brand} /><Text numberOfLines={1} style={{ color: colors.brandDark, fontSize: 10, fontWeight: "600" }}>Locations are approximate.</Text></View>
        </View>
      </View>}
      <View style={desktopExplore ? { width: "100%", minHeight: 46, flexDirection: "row", gap: 18, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: "#dfe9e7" } : { minHeight: 52, flexDirection: "row", gap: 5, padding: 4, borderRadius: 28, backgroundColor: "white", borderWidth: 1, borderColor: "#deebed" }}>
        {([
          ["map", "Map", "map-outline"],
          ["barangays", "Barangays", "map"],
          ["list", "List", "list-outline"],
        ] as const).map(([mode, title, icon]) => {
          const active = mode === "list" ? !showMap : showMap && showBarangayMap === (mode === "barangays");
          return <Pressable
            key={mode}
            accessibilityRole="tab"
            accessibilityLabel={`${title} view`}
            accessibilityState={{ selected: active }}
            onPress={() => { setShowMap(mode !== "list"); setShowBarangayMap(mode === "barangays"); setSelectedReportId(null); setDensityCellCount(null); }}
            style={({ pressed }) => [desktopExplore ? { minWidth: 130, minHeight: 45, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 10, borderBottomWidth: active ? 2 : 0, borderBottomColor: colors.brand, opacity: pressed ? 0.78 : 1 } : { flex: 1, minHeight: 44, paddingHorizontal: 4, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: active ? colors.brand : "transparent", opacity: pressed ? 0.82 : 1 }]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
              <Ionicons name={icon} size={desktopExplore ? 17 : 19} color={active ? desktopExplore ? colors.brand : "white" : desktopExplore ? colors.muted : colors.brand} />
              <Text numberOfLines={1} style={{ color: active ? desktopExplore ? colors.brand : "white" : desktopExplore ? colors.muted : colors.brandDark, fontSize: 12, fontWeight: active ? "800" : "600" }}>{title}</Text>
            </View>
          </Pressable>;
        })}
      </View>
      <View style={desktopExplore && showMap ? { flexDirection: "row", alignItems: "stretch", gap: 20 } : { gap: 12 }}>
      <View style={desktopExplore && showMap ? { width: 350, flexShrink: 0, gap: 12 } : { gap: 12 }}>
      <View style={[s.card, { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingHorizontal: 12, paddingVertical: 0, borderRadius: desktopExplore ? 10 : 24, borderColor: "#dce9ed", shadowOpacity: 0.05 }]}>
          <Ionicons name="search" size={20} color={colors.muted} />
          <TextInput maxLength={200} accessibilityLabel="Search public reports" placeholder="Search public reports…" placeholderTextColor={colors.muted} value={search} onChangeText={(v) => { setSearch(v); setDensityCellCount(null); setPage(0); }} returnKeyType="search" style={{ flex: 1, minWidth: 0, minHeight: 40, color: colors.brandDark, fontSize: 14 }} />
          {!!search && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => { setSearch(""); setAppliedSearch(""); setDensityCellCount(null); setPage(0); }} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}><Ionicons name="close-circle" size={19} color={colors.muted} /></Pressable>}
      </View>
      <View style={[s.card, { gap: filtersOpen ? 10 : 0, paddingHorizontal: 11, paddingVertical: filtersOpen ? 11 : 4, borderRadius: desktopExplore ? 10 : 17, borderColor: "#d8e8e7" }]}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Filter reports" accessibilityHint="Shows or hides category, barangay, and status filters" accessibilityState={{ expanded: filtersOpen }} onPress={() => setFiltersOpen((value) => !value)} style={({ pressed }) => [{ minHeight: 44, flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 7 }, pressed && { opacity: 0.75 }]}>
            <Ionicons name="options-outline" size={18} color={colors.brand} /><Text style={{ color: colors.brandDark, fontSize: 13, fontWeight: "800" }}>Filter reports</Text><Ionicons name={filtersOpen ? "chevron-up" : "chevron-down"} size={16} color={colors.muted} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Clear all report filters" disabled={!hasActiveFilters} onPress={() => { setCategory(""); setBarangay(""); setSearch(""); setAppliedSearch(""); setMapStatus("active"); setRecentOnly(false); setNearbyRadius("0"); setDensityCellCount(null); setSelectedReportId(null); setPage(0); }} style={({ pressed }) => [{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 4, opacity: hasActiveFilters ? 1 : 0.48 }, pressed && hasActiveFilters && { opacity: 0.72 }]}><Ionicons name="refresh" size={17} color={colors.muted} /><Text style={[s.small, { fontSize: 12, fontWeight: "600" }]}>Clear all</Text></Pressable>
        </View>
        {filtersOpen && <>
          <View style={{ flexDirection: desktopExplore ? "column" : "row", flexWrap: compactFilterLayout ? "wrap" : "nowrap", alignItems: "stretch", gap: 7 }}>
            <View style={compactFilterLayout ? { width: "48%" } : desktopExplore ? undefined : { flex: 1, minWidth: 0 }}>
              <Choices grow compact items={[{ id: "", name: "All categories" }, ...categories]} value={category} title="Choose a report type" leadingIcon="grid-outline" shortCategoryNames onChange={(v) => { setCategory(v); setDensityCellCount(null); setPage(0); }} />
            </View>
            <View style={compactFilterLayout ? { width: "48%" } : desktopExplore ? undefined : { flex: 1, minWidth: 0 }}>
              <Choices grow compact items={[{ id: "", name: "All barangays" }, ...barangays]} value={barangay} title="Choose a barangay" leadingIcon="location-outline" myBarangayId={myBarangayId || undefined} onChange={(v) => { setBarangay(v); setDensityCellCount(null); setPage(0); }} />
            </View>
            <View style={compactFilterLayout ? { width: "100%" } : desktopExplore ? undefined : { flex: 1, minWidth: 0 }}>
              <Choices grow compact items={[{ id: "all", name: `All statuses (${counts.all_count})` }, { id: "active", name: `Unresolved (${counts.active_count})` }, { id: "resolved", name: `Resolved (${counts.resolved_count})` }]} value={mapStatus} title="Choose a report status" sheetTitle="Filter by status" leadingIcon="options-outline" searchable={false} onChange={(v) => { setMapStatus(v); setDensityCellCount(null); setSelectedReportId(null); setPage(0); }} />
            </View>
          </View>
        <Pressable accessibilityRole="switch" accessibilityLabel="Reported in last 30 days" accessibilityState={{ checked: recentOnly }} onPress={() => { setRecentOnly(!recentOnly); setDensityCellCount(null); setSelectedReportId(null); setPage(0); }} style={({ pressed }) => [{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 9, borderRadius: 15, borderWidth: 1, borderColor: recentOnly ? "#b8e9df" : "#d8e9e7", backgroundColor: recentOnly ? "#f2fbf8" : "white", paddingHorizontal: 10 }, pressed && { opacity: 0.82 }]}>
          <Ionicons name="calendar-outline" size={18} color={colors.brand} />
          <Text style={[s.body, { flex: 1, fontSize: 12, fontWeight: "600" }]}>Reported in last 30 days</Text>
          <View style={{ width: 38, height: 23, borderRadius: 12, padding: 3, backgroundColor: recentOnly ? colors.brand : "#d5e0e8", justifyContent: "center" }}><View style={{ width: 17, height: 17, borderRadius: 9, backgroundColor: "white", alignSelf: recentOnly ? "flex-end" : "flex-start", shadowColor: "#123", shadowOpacity: 0.14, shadowRadius: 3, elevation: 1 }} /></View>
        </Pressable>
        </>}
      </View>
      {desktopExplore && showMap && <>
        <View style={{ flexDirection: "row", gap: 7 }}>
          {([[showPins, setShowPins, "Pins", "location"], [density, setDensity, "Heatmap", "layers"]] as const).map(([enabled, setEnabled, title, icon]) => <Pressable key={title} accessibilityRole="checkbox" accessibilityLabel={`${title === "Pins" ? "Report pins" : title} layer`} accessibilityState={{ checked: enabled }} onPress={() => { setEnabled(!enabled); if (title === "Heatmap") setDensityCellCount(null); }} style={({ pressed }) => [{ flex: 1, minHeight: 39, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 8, borderWidth: 1, borderColor: enabled ? "#c8e9e5" : colors.line, paddingHorizontal: 7, backgroundColor: enabled ? "#e7f7f3" : "white", opacity: pressed ? 0.78 : 1 }]}><Ionicons name={icon} size={16} color={enabled ? colors.brand : colors.muted} /><Text style={{ color: enabled ? colors.brandDark : colors.muted, fontSize: 11, fontWeight: "700" }}>{title}</Text></Pressable>)}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 4 }}><Text style={{ color: "#173b45", fontSize: 13, fontWeight: "700" }}>{showBarangayMap ? selectedChoroplethName || "Top barangays" : "Mapped reports"}</Text><Text style={{ color: "#71858a", fontSize: 11 }}>{showBarangayMap ? `${barangayHeatStats.top.length} shown` : `${mapReports.length.toLocaleString()} results`}</Text></View>
        <Text style={{ color: "#71858a", fontSize: 11, lineHeight: 16 }}>{showBarangayMap ? "Select a boundary to explore reports by barangay." : "Select a report to locate it on the map."}</Text>
        <ScrollView style={{ maxHeight: 410, minHeight: 170, borderTopWidth: 1, borderTopColor: "#e0e9e7" }} contentContainerStyle={{ gap: 0 }} showsVerticalScrollIndicator>
          {showBarangayMap ? barangayHeatStats.top.map((area, index) => {
            const active = area.name === selectedChoroplethName;
            return <Pressable key={area.name} accessibilityRole="button" accessibilityLabel={`${area.name}, ${area.count} reports, ${area.density.toFixed(1)} per square kilometer`} accessibilityState={{ selected: active }} onPress={() => setSelectedChoroplethName(active ? "" : area.name)} style={({ pressed }) => [{ minHeight: 62, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: "#e7eeec", backgroundColor: active ? "#e8f7f3" : pressed ? "#f1f7f5" : "transparent" }]}>
              <Text style={{ width: 20, color: "#829598", fontSize: 11, fontWeight: "700" }}>{index + 1}</Text><View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: barangayDensityColor(area.density, barangayHeatStats.maxDensity) }} /><View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text numberOfLines={1} style={{ color: "#173b45", fontSize: 12, fontWeight: "700" }}>{area.name}</Text><Text style={{ color: "#71858a", fontSize: 10 }}>{area.count} reports · {area.density.toFixed(1)}/km²</Text></View><Ionicons name="locate-outline" size={16} color={active ? colors.brand : "#829598"} />
            </Pressable>;
          }) : mapReports.slice(0, 50).map((item) => {
            const name = categoryNames.get(item.category_id) || "Community report";
            const tone = categoryToneFor(name);
            const active = item.id === selectedReportId;
            return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Locate report: ${item.title}`} accessibilityState={{ selected: active }} onPress={() => setSelectedReportId(item.id)} style={({ pressed }) => [{ minHeight: 66, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: "#e7eeec", backgroundColor: active ? "#e8f7f3" : pressed ? "#f1f7f5" : "transparent" }]}>
              <View style={{ width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 9, backgroundColor: tone.background }}><Ionicons name={categoryIconFor(name)} size={17} color={tone.foreground} /></View>
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text numberOfLines={1} style={{ color: "#173b45", fontSize: 12, fontWeight: "700" }}>{item.title}</Text><Text numberOfLines={1} style={{ color: "#71858a", fontSize: 10 }}>{categoryDisplayName(name)} · {barangays.find((b) => b.id === item.barangay_id)?.name ?? "Iligan City"}</Text></View>
              <Ionicons name="locate-outline" size={16} color={active ? colors.brand : "#829598"} />
            </Pressable>;
          })}
          {showBarangayMap ? !barangayHeatStats.top.length && <Text style={{ padding: 16, color: "#71858a", fontSize: 12 }}>No barangay reports match these filters.</Text> : !mapReports.length && <Text style={{ padding: 16, color: "#71858a", fontSize: 12 }}>No reports match these filters.</Text>}
        </ScrollView>
      </>}
      </View>
      <View style={desktopExplore ? { flex: 1, minWidth: 0, gap: 12, marginTop: 0, padding: 14, borderRadius: 13, borderWidth: 1, borderColor: "#dfe9e6", backgroundColor: "white", display: showMap ? "flex" : "none" } : { gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}><Text style={{ color: "#173b45", fontSize: 14, fontWeight: "700" }}>{showBarangayMap ? "Barangay map" : "Report map"}</Text><Text style={{ color: "#71858a", fontSize: 11 }}>{showBarangayMap ? "Boundaries · Iligan City" : "Live public locations"}</Text></View>

      {showMap && (
        <>
          {mapQuery.error && <View style={s.card}><Text style={s.error}>Could not refresh map reports.</Text><Button secondary title="Retry map" loading={mapQuery.isFetching} onPress={() => void mapQuery.refetch()} /></View>}
          {!showBarangayMap && !desktopExplore && <>
            <View style={{ gap: 10, marginTop: 8, marginBottom: 10 }}>
              {mapReports.length > mapPoints.length && <Text style={s.small}>{mapReports.length - mapPoints.length} reports use manual addresses. Open List to view them.</Text>}
              <View style={{ flexDirection: "row", gap: 8 }}>
                {([[showPins, setShowPins, "Pins", "location"], [density, setDensity, "Heatmap", "layers"]] as const).map(([enabled, setEnabled, title, icon]) => <Pressable key={title} accessibilityRole="checkbox" accessibilityLabel={`${title === "Pins" ? "Report pins" : title} layer`} accessibilityState={{ checked: enabled }} aria-checked={enabled} {...(Platform.OS === "web" ? { onKeyDown: (event: KeyboardEvent<HTMLElement>) => { if (event.key === " ") { event.preventDefault(); if (!event.repeat) { setEnabled(!enabled); if (title === "Heatmap") setDensityCellCount(null); } } } } : {})} onPress={() => { setEnabled(!enabled); if (title === "Heatmap") setDensityCellCount(null); }} style={({ pressed }) => [{ flex: 1, minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 24, borderWidth: 1, borderColor: enabled ? "#c8e9e5" : colors.line, paddingHorizontal: 10, backgroundColor: enabled ? "#ddf7f3" : "white", shadowColor: colors.brandDark, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 }, pressed && { opacity: 0.78 }]}><Ionicons name={icon} size={19} color={enabled ? colors.brand : colors.muted} /><Text style={{ color: enabled ? colors.brandDark : colors.muted, fontSize: 12, fontWeight: "700" }}>{title}</Text><View style={{ width: 38, height: 23, borderRadius: 12, padding: 3, backgroundColor: enabled ? colors.brand : "#cbd7df", justifyContent: "center" }}><View style={{ width: 17, height: 17, borderRadius: 9, backgroundColor: "white", alignSelf: enabled ? "flex-end" : "flex-start", shadowColor: "#123", shadowOpacity: 0.14, shadowRadius: 3, elevation: 1 }} /></View></Pressable>)}
              </View>
            </View>
          </>}
          {expandedMap ? <View style={{ height: mapHeight }} /> : <View style={{ position: "relative" }}>
            <LocationMap
            points={mapPoints}
            height={mapHeight}
            zoomBehavior={showBarangayMap ? "barangay-gis" : "issue-map"}
            density={!showBarangayMap && density}
            showPoints={!showBarangayMap && showPins}
            onDensityCellPress={setDensityCellCount}
            selectedCellCount={densityCellCount}
            userPoint={currentLocation}
            locating={locating}
            onLocate={locateOnMap}
            onGestureActiveChange={onMapGestureActiveChange}
            onPageScroll={onMapPageScroll}
            selectedPointId={selectedReportId ?? undefined}
            onPointPress={selectMapPoint}
            onExpand={expandMap}
            showBarangayBoundaries={showBarangayMap}
            barangayCounts={barangayCounts}
            barangayMetric={barangayMetric}
            onBarangayPress={selectBarangayOnMap}
            onMapBackgroundPress={() => setSelectedChoroplethName("")}
            selectedBarangayName={selectedChoroplethName}
            summaryColor={category ? categoryToneFor(categoryNames.get(category) || "Other reports").foreground : colors.brand}
            mapStyle={mapStyle}
            onMapStyleChange={setMapStyle}
            mapStyleSelector="tabs"
            initialRegion={mapViewport.current}
            onViewportChange={setMapViewport}
            bounds={ILIGAN_MAP_BOUNDS}
            />
            <View pointerEvents="none" style={{ position: "absolute", left: 10, right: 105, bottom: 8, gap: 1 }}>
              <Text numberOfLines={1} accessibilityLiveRegion="polite" style={{ color: "white", fontSize: 11, fontWeight: "800", textShadowColor: "#0a2533", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 }}>{mapQuery.isFetching ? "Updating…" : `${mapPoints.length} mapped reports`}</Text>
              <Text numberOfLines={2} style={{ color: "white", fontSize: 10, fontWeight: "600", textShadowColor: "#0a2533", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 }}>{mapScope}</Text>
            </View>
          </View>}
          {showBarangayMap && <View style={[s.card, { gap: 10, padding: 13, borderRadius: 19, borderColor: "#dce9ed", shadowOpacity: 0.05 }]}>
            <View style={[s.row, { flexWrap: "nowrap", alignItems: "center", justifyContent: "space-between" }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}><View style={{ width: 32, height: 32, borderRadius: 11, backgroundColor: "#e1f5f2", alignItems: "center", justifyContent: "center" }}><Ionicons name="analytics-outline" size={17} color={colors.brand} /></View><View><Text style={[s.title, { fontSize: 14 }]}>Barangay reports</Text><Text style={[s.small, { fontSize: 10 }]}>{mappedBarangayReportCount} mapped · current filters</Text></View></View>
              <View style={{ flexDirection: "row", gap: 3, padding: 3, borderRadius: 22, backgroundColor: "#f1f6f6" }}>
                {([["density", "Density"], ["count", "Total"]] as const).map(([value, title]) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: barangayMetric === value }} onPress={() => setBarangayMetric(value)} style={{ minHeight: 36, paddingHorizontal: 10, borderRadius: 19, backgroundColor: barangayMetric === value ? colors.brand : "transparent", alignItems: "center", justifyContent: "center" }}><Text style={{ color: barangayMetric === value ? "white" : colors.muted, fontSize: 10, fontWeight: "700" }}>{title}</Text></Pressable>)}
              </View>
            </View>
            <Text style={[s.small, { fontSize: 10 }]}>{barangayMetric === "density" ? "Reports per km²" : "Total reports by barangay"}</Text>
            <View accessibilityLabel={barangayMetric === "density" ? "Relative report density legend" : "Report count legend"} style={{ flexDirection: "row", flexWrap: "wrap", gap: 11 }}>
              {(barangayMetric === "density" ? [["#34d399", "Low"], ["#facc15", "Moderate"], ["#f97316", "High"], ["#ef4444", "Highest"]] : [["#cbd5e1", "0"], ["#38bdf8", "1–2"], ["#14b8a6", "3–5"], ["#f59e0b", "6–10"], ["#ef4444", "11+"]]).map(([color, text]) => <View key={text} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><View style={{ width: 11, height: 11, borderRadius: 3, backgroundColor: color }} /><Text style={[s.small, { fontSize: 11 }]}>{text}</Text></View>)}
            </View>
            {!!barangayHeatStats.top.length && <View style={{ gap: 5, paddingTop: 2 }}>
              <Text style={{ color: colors.brandDark, fontSize: 12, fontWeight: "800" }}>Highest report density</Text>
              {barangayHeatStats.top.map((row, index) => <Pressable key={row.name} accessibilityRole="button" accessibilityLabel={`${row.name}, ${row.count} reports, ${row.density.toFixed(1)} per square kilometer`} accessibilityState={{ selected: selectedChoroplethName === row.name }} onPress={() => setSelectedChoroplethName((current) => current === row.name ? "" : row.name)} style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 8, borderRadius: 10, backgroundColor: selectedChoroplethName === row.name ? "#effaf7" : "transparent" }}>
                <Text style={{ width: 20, color: colors.muted, fontSize: 12, fontWeight: "700" }}>{index + 1}</Text><View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: barangayDensityColor(row.density, barangayHeatStats.maxDensity) }} /><Text numberOfLines={1} style={{ flex: 1, color: colors.brandDark, fontSize: 13, fontWeight: selectedChoroplethName === row.name ? "800" : "600" }}>{row.name}</Text><Text style={{ color: colors.muted, fontSize: 12 }}>{row.count} · {row.density.toFixed(1)}/km²</Text>
              </Pressable>)}
            </View>}
            {!!selectedChoroplethName && <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
              <Text style={[s.small, { color: colors.brand, fontWeight: "700", flex: 1 }]}>{selectedChoroplethName}: {barangayCounts[barangayMapKey(selectedChoroplethName)] ?? 0} matching reports · tap area again to clear</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Clear barangay selection" onPress={() => setSelectedChoroplethName("")} style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: 8 }}><Text style={{ color: colors.muted, fontSize: 11, fontWeight: "700" }}>Clear</Text></Pressable>
              <Pressable accessibilityRole="button" onPress={() => { const item = barangays.find((entry) => barangayMapKey(entry.name) === barangayMapKey(selectedChoroplethName)); if (item) { setBarangay(item.id); setSelectedReportId(null); setPage(0); } }} style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: 10, borderRadius: 11, backgroundColor: colors.brandSoft }}><Text style={{ color: colors.brand, fontSize: 11, fontWeight: "700" }}>Filter here</Text></Pressable>
            </View>}
            {!!selectedChoroplethName && <View style={{ gap: 4 }}>
              <Text style={{ color: colors.brandDark, fontSize: 12, fontWeight: "800" }}>Reports in {selectedChoroplethName} · {selectedBarangayReports.length}</Text>
              {selectedBarangayReports.length ? renderBarangayReportRows(selectedBarangayReports) : <Text style={s.small}>No reports in this barangay match the current filters.</Text>}
            </View>}
            {mappedBarangayReportCount < mapReports.length && <Text style={[s.small, { fontSize: 10 }]}>{mapReports.length - mappedBarangayReportCount} reports have no matching barangay boundary and are not shaded.</Text>}
            <Text style={[s.small, { fontSize: 10 }]}>Boundary source: 2023 PSGC snapshot · indicative mapped boundaries</Text>
            {mapQuery.data?.length === 500 && <Text style={[s.small, { color: colors.muted }]}>Counts use the latest 500 published reports. Narrow the filters for more detail.</Text>}
          </View>}
          {expandedMap && <Modal visible={!suspendExpandedMap} animationType="slide" statusBarTranslucent={false} navigationBarTranslucent={false} onRequestClose={() => setExpandedMap(false)}>
            <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: colors.paper, paddingTop: 4, paddingHorizontal: 10, paddingBottom: 6, gap: 8 }}>
              <StatusBar style="dark" />
              <View style={{ minHeight: 58, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View><Text style={s.title}>{showBarangayMap ? "Barangay heatmap" : "Explore Iligan"}</Text><Text style={s.small}>{showBarangayMap ? `${mappedBarangayReportCount} mapped reports · tap a barangay` : `${mapPoints.length} map pins · ${mapReports.length - mapPoints.length} manual addresses`}</Text></View>
                <Pressable accessibilityRole="button" accessibilityLabel="Close expanded map" onPress={() => setExpandedMap(false)} style={{ width: 48, height: 48, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "white" }}><Ionicons name="close" size={23} color={colors.brandDark} /></Pressable>
              </View>
              <View style={{ flex: 1, minHeight: 0 }}>
                <LocationMap points={mapPoints} height={Math.max(180, windowHeight - safeArea.top - safeArea.bottom - 92)} zoomBehavior={showBarangayMap ? "barangay-gis" : "issue-map"} density={!showBarangayMap && density} showPoints={!showBarangayMap && showPins} onDensityCellPress={setDensityCellCount} selectedCellCount={densityCellCount} userPoint={currentLocation} locating={locating} onLocate={locateOnMap} selectedPointId={selectedReportId ?? undefined} onPointPress={(point) => { selectMapPoint(point); const report = mapReports.find((item) => item.id === point.id); if (report) onOpenReport(report); }} mapStyle={mapStyle} onMapStyleChange={setMapStyle} mapStyleSelector="tabs" initialRegion={mapViewport.current} onViewportChange={setMapViewport} bounds={ILIGAN_MAP_BOUNDS} showBarangayBoundaries={showBarangayMap} barangayCounts={barangayCounts} barangayMetric={barangayMetric} onBarangayPress={selectBarangayOnMap} onMapBackgroundPress={() => setSelectedChoroplethName("")} selectedBarangayName={selectedChoroplethName} summaryColor={category ? categoryToneFor(categoryNames.get(category) || "Other reports").foreground : colors.brand} />
              </View>
            </SafeAreaView>
          </Modal>}
          {!showBarangayMap && !density && !showPins && <Text style={s.small}>Both layers are off. Turn on Pins or Heat to see reports.</Text>}
          {!showBarangayMap && !mapQuery.isPending && !mapQuery.error && !mapPoints.length && <View style={s.card}><Text style={s.title}>{mapReports.length ? "These reports use manual addresses" : "No reports match these map filters"}</Text><Text style={s.small}>{mapReports.length ? "Their barangay and address details are available in List. No map pins were provided." : "Try Any distance, All statuses, another barangay, or a wider date range."}</Text>{!!mapReports.length && <Button secondary title="View report list" onPress={() => setShowMap(false)} />}</View>}
          {selectedMapReport && (() => {
            const tone = categoryToneFor(selectedMapReport.categoryName);
            const status = statusToneFor(selectedMapReport.statusLabel);
            const failed = failedPhotos[selectedMapReport.id!];
            return <View style={[s.card, { borderRadius: 21, borderLeftWidth: 4, borderLeftColor: selectedMapReport.color, gap: 10, padding: 12, borderColor: "#dce9ed" }]}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                {selectedMapReport.photoUrl && !failed ? <PhotoViewer source={{ uri: selectedMapReport.photoUrl }} label={`${categoryDisplayName(selectedMapReport.categoryName)} report photo`} onError={() => setFailedPhotos((value) => ({ ...value, [selectedMapReport.id!]: true }))} style={{ width: thumbnailWidth, height: thumbnailWidth, borderRadius: 15, backgroundColor: "#eaf2f1" }} /> : <View style={{ width: thumbnailWidth, height: thumbnailWidth, borderRadius: 15, backgroundColor: tone.background, borderWidth: 1, borderColor: `${tone.foreground}20`, alignItems: "center", justifyContent: "center" }}><Ionicons name={categoryIconFor(selectedMapReport.categoryName)} size={30} color={tone.foreground} /></View>}
                <View style={{ flex: 1, minWidth: 0, gap: 7 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingRight: 38 }}><View style={{ paddingHorizontal: 8, paddingVertical: 5, borderRadius: 15, backgroundColor: tone.background, flexDirection: "row", alignItems: "center", gap: 4 }}><Ionicons name={categoryIconFor(selectedMapReport.categoryName)} size={12} color={tone.foreground} /><Text numberOfLines={1} style={{ color: tone.foreground, fontSize: 10, fontWeight: "700" }}>{categoryDisplayName(selectedMapReport.categoryName)}</Text></View><View style={{ paddingHorizontal: 8, paddingVertical: 5, borderRadius: 15, backgroundColor: status.background }}><Text numberOfLines={1} style={{ color: status.foreground, fontSize: 10, fontWeight: "700" }}>{selectedMapReport.statusLabel}</Text></View></View>
                  <Text numberOfLines={2} style={[s.title, { fontSize: 14, lineHeight: 18 }]}>{selectedMapReport.title}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}><Ionicons name="location-outline" size={13} color={colors.muted} /><Text numberOfLines={1} style={[s.small, { flex: 1 }]}>{selectedMapReport.barangayName} · approx. location</Text></View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}><Ionicons name="calendar-outline" size={13} color={colors.muted} /><Text style={s.small}>{new Date(selectedMapReport.created_at).toLocaleDateString()}</Text>{currentLocation && <Text numberOfLines={1} style={[s.small, { color: colors.brand, fontWeight: "700" }]}>· {(distanceMeters(currentLocation, selectedMapReport) / 1000).toFixed(1)} km away</Text>}</View>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="Close selected report" onPress={() => setSelectedReportId(null)} style={{ position: "absolute", right: 0, top: 0, width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 19, backgroundColor: "#f2f7f6" }}><Ionicons name="close" size={18} color={colors.muted} /></Pressable>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Open full details for ${selectedMapReport.title}`} onPress={() => onOpenReport(selectedMapReport)} style={({ pressed }) => [{ minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 23, borderWidth: 1, borderColor: "#62c9c1", backgroundColor: "white" }, pressed && { opacity: 0.78 }]}><Text style={{ color: colors.brand, fontSize: 12, fontWeight: "800" }}>View report details</Text><Ionicons name="chevron-forward" size={16} color={colors.brand} /></Pressable>
          </View>;
          })()}
          {!showBarangayMap && showPins && pinCategories.length > 0 && <View style={{ minHeight: 34, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 2 }}>
            <Text style={{ color: colors.muted, fontSize: 10, fontWeight: "800" }}>Types</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ flexDirection: "row", alignItems: "center", gap: 12 }} style={{ flex: 1, minWidth: 0 }}>
              {pinCategories.map(([name, color]) => <View key={name} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Ionicons name={categoryIconFor(name)} color={color} size={14} />
                <Text numberOfLines={1} style={{ color: colors.brandDark, fontSize: 11, fontWeight: "600" }}>{categoryDisplayName(name)}</Text>
              </View>)}
            </ScrollView>
          </View>}
          {!showBarangayMap && showPins && pinCategories.length > 0 && <Text style={[s.small, { fontSize: 10 }]}>Report pins stay visible at every zoom; pin colors show the report category.</Text>}
          {mapQuery.data?.length === 500 && <Text style={s.small}>Showing the latest 500 published locations. Use the barangay or category filters to narrow the map.</Text>}
          <View style={[s.card, { gap: 10 }]}>
            <View style={[s.row, { flexWrap: "nowrap", alignItems: "center" }]}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}><Ionicons name="navigate" size={19} color={colors.brand} /></View>
              <View style={{ flex: 1, gap: 3 }}><Text style={s.title}>Explore nearby</Text><Text style={s.small}>Find published reports around your current location</Text></View>
              <Ionicons name="chevron-forward" size={19} color={colors.muted} />
            </View>
            <Button title={locating ? "Finding your location…" : currentLocation ? "Update nearby reports" : "Find near me"} loading={locating} onPress={() => void locateNearby(currentLocation ? nearbyRadius : "3000")} />
            {currentLocation && <Choices columns={2} title="Search radius" items={[{ id: "0", name: "Any" }, { id: "1000", name: "1 km" }, { id: "3000", name: "3 km" }, { id: "5000", name: "5 km" }]} value={nearbyRadius} onChange={(value) => { setNearbyRadius(value); setDensityCellCount(null); setSelectedReportId(null); }} />}
          </View>
        </>
      )}
      </View>
      </View>
      {!!message && <Text accessibilityRole="alert" style={s.body}>{message}</Text>}
      {follows.error && <View style={s.card}><Text style={s.error}>Could not load your followed reports.</Text><Button secondary title="Retry followed reports" onPress={() => void follows.refetch()} /></View>}
      {!showMap && <>
      {q.isPending && <ListSkeleton variant="publicReport" count={3} label="Loading public reports" />}
      {q.error && <View style={s.card}><Text style={s.error}>{q.error.message}</Text><Button secondary title="Retry reports" onPress={() => void q.refetch()} /></View>}
      {!q.isPending && !q.error && !reports.length && (
        <View style={[s.card, { alignItems: "center", gap: 8, paddingVertical: 22 }]}><Ionicons name="search-outline" size={27} color={colors.muted} /><Text style={s.title}>No reports found</Text><Text style={[s.subtitle, { textAlign: "center" }]}>Try adjusting your search or filters.</Text><Button secondary title="Reset filters" onPress={() => { setCategory(""); setBarangay(""); setSearch(""); setAppliedSearch(""); setMapStatus("active"); setRecentOnly(false); setNearbyRadius("0"); setDensityCellCount(null); setSelectedReportId(null); setPage(0); }} /></View>
      )}
      {reports.map((r) => {
        const categoryName = categories.find((c) => c.id === r.category_id)?.name ?? "Community report";
        const photoUrl = reportPhotos.data?.urls[r.id];
        const photoCount = reportPhotos.data?.counts[r.id] ?? 0;
        const categoryTone = categoryToneFor(categoryName);
        const statusTone = statusToneFor(r.status);
        return (
          <View style={[s.card, { gap: 8, padding: 10, borderRadius: 20, borderColor: "#dce9ed", shadowOpacity: 0.045 }]} key={r.id}>
            <View style={{ flexDirection: "row", alignItems: "stretch", gap: 10 }}>
              <Pressable accessibilityRole="button" accessibilityLabel={`View photo and details for ${r.title}`} onPress={() => setSelectedListReportId(r.id)} style={({ pressed }) => [{ width: thumbnailWidth, height: thumbnailWidth, borderRadius: 15, overflow: "hidden", backgroundColor: categoryTone.background, borderWidth: 1, borderColor: `${categoryTone.foreground}24`, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.82 : 1 }]}>
                {photoUrl && !failedPhotos[r.id] ? <PhotoViewer source={{ uri: photoUrl }} label={`${categoryDisplayName(categoryName)} report photo`} onError={() => retryReportPhoto(r.id)} loadingTimeoutMs={15000} onLoadTimeout={() => retryReportPhoto(r.id)} style={{ width: thumbnailWidth, height: thumbnailWidth, backgroundColor: "#eaf2f1" }} /> : <Ionicons name={categoryIconFor(categoryName)} size={31} color={categoryTone.foreground} />}
                <View pointerEvents="none" style={{ position: "absolute", right: 5, bottom: 5, width: 25, height: 25, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffffed", borderWidth: 1, borderColor: "#e2eceb" }}><Ionicons name="location" size={14} color={colors.brand} /></View>
              </Pressable>
              <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <View style={{ maxWidth: "58%", minHeight: 24, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, borderRadius: 13, backgroundColor: categoryTone.background }}><Ionicons name={categoryIconFor(categoryName)} size={12} color={categoryTone.foreground} /><Text numberOfLines={1} style={{ color: categoryTone.foreground, fontSize: 10, fontWeight: "700" }}>{categoryDisplayName(categoryName)}</Text></View>
                    <View style={{ maxWidth: "42%", paddingHorizontal: 8, paddingVertical: 5, borderRadius: 14, backgroundColor: statusTone.background }}><Text numberOfLines={1} style={{ color: statusTone.foreground, fontSize: 10, fontWeight: "700" }}>{reportStatusLabel(r.status)}</Text></View>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={`More options for ${r.title}`} onPress={() => setSelectedListReportId(r.id)} style={({ pressed }) => [{ width: 40, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: 20, opacity: pressed ? 0.72 : 1 }]}><Ionicons name="ellipsis-vertical" size={18} color={colors.brandDark} /></Pressable>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={`View public details for ${r.title}`} onPress={() => setSelectedListReportId(r.id)} style={({ pressed }) => [{ minWidth: 0, gap: 6, opacity: pressed ? 0.82 : 1 }]}>
                  <Text numberOfLines={2} style={[s.title, { fontSize: 14, lineHeight: 18 }]}>{r.title}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 4 }}><Ionicons name="calendar-outline" size={13} color={colors.muted} /><Text numberOfLines={1} style={[s.small, { flex: 1, fontSize: 10 }]}>{new Date(r.created_at).toLocaleDateString()} · {barangays.find((b) => b.id === r.barangay_id)?.name ?? "Iligan City"}, Iligan</Text></View>{photoCount > 0 && <View style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 12, backgroundColor: "#f2f7f6" }}><Ionicons name="image-outline" size={12} color={colors.muted} /><Text style={[s.small, { fontSize: 10 }]}>{photoCount} {photoCount === 1 ? "photo" : "photos"}</Text></View>}</View>
                </Pressable>
              </View>
            </View>
          </View>
        );
      })}
      {(page > 0 || matchingReports.length > (page + 1) * 30) && (
        <>
          <Text style={[s.small, { textAlign: "center" }]}>Page {page + 1}</Text>
          <View style={s.actionRow}>
            <Button grow secondary title="Previous" disabled={!page || q.isFetching} onPress={() => setPage(page - 1)} />
            <Button grow secondary title="Next" disabled={q.isFetching || !!q.error || matchingReports.length <= (page + 1) * 30} onPress={() => setPage(page + 1)} />
          </View>
        </>
      )}
      </>}
      <Modal visible={!!selectedListReport} animationType="slide" transparent onRequestClose={() => { setReportActionsOpen(false); setSelectedListReportId(null); }}>
        {selectedListReport && (() => {
          const categoryName = categories.find((item) => item.id === selectedListReport.category_id)?.name ?? "Community report";
          const tone = statusToneFor(selectedListReport.status);
          const photoUrl = reportPhotos.data?.urls[selectedListReport.id];
          const isFollowing = follows.data?.some((item) => item.report_id === selectedListReport.id);
          return <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#0a253344" }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close report details" onPress={() => { setReportActionsOpen(false); setSelectedListReportId(null); }} style={{ flex: 1 }} />
            <View style={{ maxHeight: "82%", position: "relative", borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20, paddingBottom: 28, gap: 13, backgroundColor: "white" }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Text style={[s.eyebrow, { color: colors.brand }]}>PUBLIC REPORT</Text><Pressable accessibilityRole="button" accessibilityLabel="Close report details" onPress={() => { setReportActionsOpen(false); setSelectedListReportId(null); }} style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: "#f2f7f6" }}><Ionicons name="close" size={21} color={colors.brandDark} /></Pressable></View>
              {photoUrl && !failedPhotos[selectedListReport.id] ? <PhotoViewer source={{ uri: photoUrl }} label={`${categoryDisplayName(categoryName)} report photo`} onError={() => retryReportPhoto(selectedListReport.id)} style={{ width: "100%", height: 190, borderRadius: 17, backgroundColor: "#eaf2f1" }} /> : <View style={{ width: "100%", height: 140, borderRadius: 17, backgroundColor: categoryToneFor(categoryName).background, alignItems: "center", justifyContent: "center" }}><Ionicons name={categoryIconFor(categoryName)} size={48} color={categoryToneFor(categoryName).foreground} /></View>}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}><View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}><Ionicons name={categoryIconFor(categoryName)} size={18} color={categoryToneFor(categoryName).foreground} /><Text style={[s.eyebrow, { flexShrink: 1 }]}>{categoryDisplayName(categoryName)}</Text></View><View style={{ borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: tone.background }}><Text style={{ color: tone.foreground, fontSize: 11, fontWeight: "700" }}>{label(selectedListReport.status)}</Text></View></View>
              <Text style={[s.title, { fontSize: 21, lineHeight: 27 }]}>{selectedListReport.title}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Ionicons name="location-outline" size={18} color={colors.muted} /><Text style={[s.body, { flex: 1 }]}>{barangays.find((item) => item.id === selectedListReport.barangay_id)?.name ?? "Iligan City"} · approximate public location</Text></View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Ionicons name="calendar-outline" size={18} color={colors.muted} /><Text style={s.body}>{new Date(selectedListReport.created_at).toLocaleDateString()}</Text></View>
              <Text style={s.small}>Exact report locations and private descriptions are not shown in public details.</Text>
              <View style={{ flexDirection: "row", gap: 7 }}>
                <Pressable accessibilityRole="button" accessibilityLabel="View this report on the map" onPress={() => { const report = selectedListReport; setReportActionsOpen(false); setSelectedListReportId(null); setCategory(report.category_id); setBarangay(report.barangay_id); setSearch(""); setAppliedSearch(""); setMapStatus("all"); setRecentOnly(false); setNearbyRadius("0"); setSelectedReportId(report.id); setShowMap(true); }} style={{ flex: 1, minWidth: 0, minHeight: 48, paddingHorizontal: 4, borderRadius: 14, backgroundColor: "#eff6f4", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 }}><Ionicons name="map-outline" size={16} color={colors.brand} /><Text numberOfLines={1} style={{ color: colors.brand, fontSize: 11, fontWeight: "700" }}>View on map</Text></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`View full details for ${selectedListReport.title}`} onPress={() => { const report = selectedListReport; setReportActionsOpen(false); setSelectedListReportId(null); onOpenReport(report); }} style={{ flex: 1, minWidth: 0, minHeight: 48, paddingHorizontal: 4, borderRadius: 14, backgroundColor: colors.brandSoft, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 }}><Ionicons name="document-text-outline" size={16} color={colors.brand} /><Text numberOfLines={1} style={{ color: colors.brand, fontSize: 11, fontWeight: "700" }}>View details</Text></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="More report actions" accessibilityState={{ expanded: reportActionsOpen }} onPress={() => setReportActionsOpen((open) => !open)} style={{ width: 48, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: "#f2f7f6" }}><Ionicons name="ellipsis-horizontal" size={21} color={colors.brandDark} /></Pressable>
              </View>
              {reportActionsOpen && <>
                <Pressable accessibilityRole="button" accessibilityLabel="Close report actions" onPress={() => setReportActionsOpen(false)} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 5 }} />
                <View style={{ position: "absolute", right: 20, bottom: 84, width: 188, padding: 6, borderRadius: 16, backgroundColor: "white", borderWidth: 1, borderColor: "#e1eceb", shadowColor: colors.brandDark, shadowOpacity: 0.15, shadowRadius: 14, elevation: 8, zIndex: 6 }}>
                  <Pressable accessibilityRole="button" accessibilityLabel={isFollowing ? "Unfollow this report" : "Follow this report"} disabled={busy || follows.isPending || !!follows.error} onPress={() => { setReportActionsOpen(false); void toggleFollow(selectedListReport.id); }} style={({ pressed }) => [{ minHeight: 48, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 9, opacity: busy || follows.isPending || !!follows.error ? 0.5 : 1 }, pressed && { backgroundColor: "#f2f8f7" }]}><Ionicons name={isFollowing ? "bookmark" : "bookmark-outline"} size={18} color={colors.brand} /><Text style={{ color: colors.brandDark, fontSize: 13, fontWeight: "700" }}>{isFollowing ? "Unfollow" : "Follow"}</Text></Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="Share this report" onPress={shareListReport} style={({ pressed }) => [{ minHeight: 48, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 9 }, pressed && { backgroundColor: "#f2f8f7" }]}><Ionicons name="share-social-outline" size={18} color={colors.brand} /><Text style={{ color: colors.brandDark, fontSize: 13, fontWeight: "700" }}>Share</Text></Pressable>
                </View>
              </>}
            </View>
          </View>;
        })()}
      </Modal>
    </>
  );
}
