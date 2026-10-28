import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Platform, Text, View, Image, Linking, Pressable, TextInput, Modal, ScrollView, Share, useWindowDimensions } from "react-native";
import type { Region } from "react-native-maps";
import Ionicons from "@expo/vector-icons/Ionicons";
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
  Lookup,
  label,
  distanceMeters,
  parseReportCoordinates,
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
    : tone === "success" ? { background: "#eff9f5", border: "#d5eee4", foreground: colors.teal, icon: "checkmark-circle-outline" as const, title: "All set" }
    : { background: "#f1f7fc", border: "#dbe8f4", foreground: "#3b73ba", icon: "information-circle-outline" as const, title: "Report update" };
  return (
    <View style={{ width: "100%", padding: 12, borderRadius: 16, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background, flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
      <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: `${palette.foreground}14`, alignItems: "center", justifyContent: "center" }}><Ionicons name={palette.icon} size={20} color={palette.foreground} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={{ color: palette.foreground, fontSize: 13, lineHeight: 17, fontWeight: "800" }}>{palette.title}</Text>
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: colors.navy, fontSize: 13, lineHeight: 19 }}>{message}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss report message" onPress={onDismiss} hitSlop={7} style={{ width: 30, height: 30, alignItems: "center", justifyContent: "center" }}><Ionicons name="close" size={18} color={colors.muted} /></Pressable>
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
  latitude,
  longitude,
  photo,
}: {
  category: string;
  problem: string;
  title: string;
  description: string;
  barangay: string;
  landmark?: string;
  latitude: number;
  longitude: number;
  photo?: string | null;
}) {
  const tone = categoryToneFor(category);
  return (
    <>
      <View style={[s.card, { gap: 13, padding: 15 }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: "#e5f6f2", alignItems: "center", justifyContent: "center" }}><Ionicons name="clipboard-outline" size={21} color={colors.teal} /></View>
          <View style={{ flex: 1, gap: 3 }}><Text style={[s.eyebrow, { marginBottom: 0 }]}>CHECK BEFORE SENDING</Text><Text style={s.small}>Make sure the details are right.</Text></View>
          <View style={{ paddingHorizontal: 9, paddingVertical: 6, borderRadius: 13, backgroundColor: "#e9f7f0" }}><Text style={{ color: "#18825f", fontSize: 10, fontWeight: "800" }}>READY</Text></View>
        </View>
        <View style={{ height: 1, backgroundColor: colors.line }} />
        <View style={{ gap: 5 }}>
          <Text style={[s.small, { fontWeight: "700", color: colors.muted }]}>REPORT TITLE</Text>
          <Text style={[s.title, { fontSize: 19, lineHeight: 24 }]}>{title || "Untitled report"}</Text>
          <Text style={s.body}>{description || "No description added."}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 11, borderRadius: 15, backgroundColor: tone.background }}>
          <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: "#ffffffb8", alignItems: "center", justifyContent: "center" }}><Ionicons name={categoryIconFor(category)} size={20} color={tone.foreground} /></View>
          <View style={{ flex: 1, gap: 3 }}><Text style={{ color: tone.foreground, fontSize: 12, fontWeight: "800" }}>{categoryDisplayName(category)}</Text><Text style={{ color: colors.navy, fontSize: 13, fontWeight: "700" }}>{problem || "Specific problem selected"}</Text></View>
          <Ionicons name="checkmark-circle" size={20} color={tone.foreground} />
        </View>
        {!!landmark && <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Ionicons name="navigate-outline" size={17} color={colors.muted} /><Text style={s.small}>{landmark}</Text></View>}
        {photo && <PhotoViewer source={{ uri: photo }} label="Report photograph" style={{ width: "100%", height: 190, borderRadius: 15, backgroundColor: "#eaf2f1" }} />}
      </View>
      <View style={[s.card, { gap: 10, padding: 12 }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 2 }}><View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: "#e5f6f2", alignItems: "center", justifyContent: "center" }}><Ionicons name="location" size={19} color={colors.teal} /></View><View style={{ flex: 1, gap: 2 }}><Text style={s.fieldLabel}>Issue location</Text><Text style={s.small}>{barangay || "Barangay not selected"} · Iligan City</Text></View><Ionicons name="checkmark-circle" size={20} color={colors.teal} /></View>
        <LocationMap height={154} point={{ latitude, longitude }} />
        <Text style={[s.small, { paddingHorizontal: 2 }]}>The pin is checked against Iligan’s barangay boundaries. The exact pin is shared with authorized city staff; the public sees an approximate location.</Text>
      </View>
    </>
  );
}

export function ReportForm({
  categories,
  barangays,
  onSaved,
  initialCategory = "",
  initialBarangay = "",
}: {
  categories: Lookup[];
  barangays: Lookup[];
  onSaved: () => void;
  initialCategory?: string;
  initialBarangay?: string;
}) {
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
    defaultValues: {
      title: "",
      description: "",
      category_id: initialCategory,
      barangay_id: initialBarangay,
      latitude: 8.228,
      longitude: 124.2452,
      landmark: "",
      problem_type: null,
      problem_other: null,
    },
  });
  const [step, setStep] = useState(0),
    [demoReview, setDemoReview] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [locationSource, setLocationSource] = useState<"gps" | "pin" | "coordinates" | null>(null),
    [locationAccuracy, setLocationAccuracy] = useState<number | null>(null),
    [detectedBarangayName, setDetectedBarangayName] = useState(""),
    [locationAddress, setLocationAddress] = useState(""),
    [cityConfirmed, setCityConfirmed] = useState(false),
    [manualBarangayConfirmed, setManualBarangayConfirmed] = useState(false),
    [barangayReviewRequired, setBarangayReviewRequired] = useState(false),
    [locating, setLocating] = useState(false),
    [locationError, setLocationError] = useState(""),
    [showCoordinates, setShowCoordinates] = useState(false),
    [photo, setPhoto] = useState<string | null>(null),
    [saved, setSaved] = useState<string | null>(null),
    [requestId, setRequestId] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [messageTone, setMessageTone] = useState<NoticeTone>("info"),
    [categorySheetOpen, setCategorySheetOpen] = useState(false),
    [barangaySelectionSource, setBarangaySelectionSource] = useState<"pin" | "manual" | null>(null),
    [uploaded, setUploaded] = useState(false),
    [draftKey, setDraftKey] = useState("");
  const values = watch();
  function showMessage(text: string, tone: NoticeTone = "info") { setMessage(text); setMessageTone(tone); }
  function clearMessage() { showMessage(""); }
  const locationRequest = useRef(0);
  const submissionLock = useRef(false);
  useEffect(() => () => { locationRequest.current++; }, []);
  const goBackStep = () => {
    if (demoReview) { setDemoReview(false); setStep(0); }
    else setStep((value) => Math.max(0, value - 1));
    clearMessage();
  };
  useEffect(() => {
    if (Platform.OS !== "android" || step === 0 || busy) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => { goBackStep(); return true; });
    return () => listener.remove();
  }, [step, busy, demoReview]);
  async function chooseLocation(
    point: { latitude: number; longitude: number },
    source: "gps" | "pin" | "coordinates",
    accuracy: number | null = null,
    activeRequest?: number,
  ) {
    const request = activeRequest ?? ++locationRequest.current;
    setLocating(true);
    setLocationError("");
    setConfirmed(false);
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
      setDetectedBarangayName(matchedBarangay?.name ?? "");
      setBarangayReviewRequired(!resolved.barangay_id);
      setLocationAddress(resolved.address);
      setCityConfirmed(true);
      setManualBarangayConfirmed(false);
      if (matchedBarangay) {
        setValue("barangay_id", matchedBarangay.id, { shouldValidate: true, shouldDirty: true });
        setBarangaySelectionSource("pin");
      } else {
        setValue("barangay_id", "", { shouldValidate: false, shouldDirty: true });
        setBarangaySelectionSource(null);
      }
      setLocationSource(source);
      setLocationAccuracy(accuracy);
      setLocationError(matchedBarangay ? "" : "Iligan City found. The available data does not identify one barangay here; please choose it below.");
      clearMessage();
      return true;
    } catch (error) {
      if (request === locationRequest.current) setLocationError((error as Error).message || "We couldn’t check this location. Please try again.");
      return false;
    } finally {
      if (request === locationRequest.current) setLocating(false);
    }
  }
  const selectedBarangay = barangays.find((item) => item.id === values.barangay_id);
  const detectedBarangay = barangays.find((item) => item.name === detectedBarangayName);
  const barangayMismatch = !!detectedBarangay && !!selectedBarangay && detectedBarangay.id !== selectedBarangay.id;
  const selectedCategory = categories.find((item) => item.id === values.category_id);
  const problemOptions = [...(selectedCategory?.problem_types ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const drainage = selectedCategory?.name.toLowerCase().startsWith("drainage");
  const problemLabel = problemOptions.find((item) => item.code === values.problem_type)?.label;
  const sampleCategory = categories.find((item) => /road|pothole/i.test(item.name)) ?? categories[0];
  const sampleProblem = sampleCategory?.problem_types?.[0];
  const sampleBarangay = barangays.find((item) => /pala-?o/i.test(item.name)) ?? barangays[0];
  const reviewValues = demoReview ? {
    ...values,
    category_id: sampleCategory?.id ?? values.category_id,
    problem_type: sampleProblem?.code ?? values.problem_type,
    problem_other: null,
    title: "Pothole collecting rainwater near Pala-o Market",
    description: "A deep pothole has formed beside the road and fills with water after rain. It is difficult for drivers and pedestrians to see, especially at night.",
    landmark: "Near Pala-o Market",
    barangay_id: sampleBarangay?.id ?? values.barangay_id,
    latitude: 8.228,
    longitude: 124.2452,
  } : values;
  const reviewCategory = categories.find((item) => item.id === reviewValues.category_id);
  const reviewProblem = reviewCategory?.problem_types?.find((item) => item.code === reviewValues.problem_type)?.label;
  async function reviewReport() {
    if (demoReview) { setStep(2); return; }
    if (!(await trigger(["category_id", "problem_type", "problem_other", "title", "description"]))) {
      setStep(0);
      showMessage(issueDetailsMessage(values), "warning");
      return;
    }
    if (!confirmed || !locationSource || locating || !(await trigger(["latitude", "longitude", "barangay_id"]))) {
      setStep(1);
      showMessage("Choose and confirm the issue location and barangay before reviewing.", "warning");
      return;
    }
    if (!cityConfirmed) {
      setStep(1);
      showMessage("Check the pin location before continuing.", "warning");
      return;
    }
    if (barangayReviewRequired && !manualBarangayConfirmed) {
      setStep(1);
      showMessage("Please review the suggested barangay below. Change it if needed, then tap Confirm barangay.", "warning");
      return;
    }
    if (barangayMismatch && !manualBarangayConfirmed) {
      setStep(1);
      showMessage(`Boundary data suggests ${detectedBarangayName}, but you selected ${selectedBarangay?.name}. Use the detected barangay or confirm your choice.`, "warning");
      return;
    }
    clearMessage();
    setStep(2);
  }
  const [coordinates, setCoordinates] = useState({
    latitude: "8.228",
    longitude: "124.2452",
  });
  useEffect(
    () =>
      setCoordinates({
        latitude: String(values.latitude),
        longitude: String(values.longitude),
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
    if (!photo || uploaded) return;
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
      setUploaded(true);
    } catch (e) {
      await db!.storage.from("report-evidence").remove([path]);
      throw e;
    }
  }
  async function submit(v: ReportInput) {
    if (submissionLock.current) return;
    if (!confirmed || !locationSource || !cityConfirmed || locating) {
      showMessage("Choose and confirm the issue location before submitting.", "warning");
      setStep(1);
      return;
    }
    if (barangayReviewRequired && !manualBarangayConfirmed) {
      showMessage("Please review and confirm the barangay before submitting.", "warning");
      setStep(1);
      return;
    }
    if (barangayMismatch && !manualBarangayConfirmed) {
      showMessage(`Boundary data suggests ${detectedBarangayName}, but you selected ${selectedBarangay?.name}. Please confirm the barangay before submitting.`, "warning");
      setStep(1);
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
          p_problem_type: v.problem_type,
          p_problem_other: v.problem_type === "other" ? v.problem_other?.trim() : null,
        }),
      );
      setSaved(id);
      await upload(id);
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
  return (
    <>
      <Text style={[s.heading, { fontSize: 28, lineHeight: 34 }]}>Report a concern</Text>
      {!!message && <ReportNotice tone={messageTone} message={message} onDismiss={clearMessage} />}
      {saved ? (
        <View style={s.card}>
          <Text style={s.eyebrow}>REPORT RECEIVED</Text>
          <Text style={s.title}>Thank you for speaking up.</Text>
          <Text style={s.body}>
            Your concern is ready for human review. Submission does not
            guarantee a repair date.
          </Text>
          <Text selectable style={s.small}>
            {saved}
          </Text>
          {photo && !uploaded && (
            <Button
              disabled={busy}
              title="Retry photograph upload"
              onPress={async () => {
                setBusy(true);
                try {
                  await upload(saved);
                  showMessage("Photograph attached.", "success");
                } catch (e) {
                  showMessage((e as Error).message, "error");
                } finally {
                  setBusy(false);
                }
              }}
            />
          )}
          <Button
            title="View your reports"
            onPress={() => void storage.removeItem(draftKey).then(onSaved)}
          />
        </View>
      ) : (
        <>
          {step > 0 && <AppBackNavigation label={demoReview ? "Back to details" : step === 1 ? "Back to details" : "Back to location"} onBack={goBackStep} />}
          <View style={{ position: "relative", flexDirection: "row", paddingVertical: 2 }}>
            <View pointerEvents="none" style={{ position: "absolute", top: 17, left: "16.67%", right: "16.67%", height: 4, borderRadius: 2, backgroundColor: "#e3ebf2" }}>
              <View style={{ width: `${step * 50}%`, height: "100%", borderRadius: 2, backgroundColor: colors.teal }} />
            </View>
            {["Details", "Location", "Review"].map((title, i) => <Pressable key={title} accessibilityRole="tab" accessibilityState={{ selected: step === i, disabled: busy }} disabled={busy} onPress={() => {
              if (i === 2) void reviewReport();
              else { setDemoReview(false); setStep(i); clearMessage(); }
            }} style={{ flex: 1, minHeight: 66, alignItems: "center", gap: 5 }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: i <= step ? colors.teal : "#e8eef5", borderWidth: i === step ? 2 : 0, borderColor: "#bcebe1" }}>
                <Text style={{ color: i <= step ? "white" : colors.muted, fontSize: 14, fontWeight: "800" }}>{i < step ? "✓" : i + 1}</Text>
              </View>
              <Text style={{ color: i <= step ? colors.teal : colors.muted, fontSize: 12, fontWeight: i === step ? "800" : "600" }}>{title}</Text>
            </Pressable>)}
          </View>
          <Text style={s.eyebrow}>
            STEP {step + 1} OF 3 · {["DESCRIBE", "LOCATE", "REVIEW"][step]}
          </Text>
          {step === 0 && (
            <>
              <Text style={s.subtitle}>
                Tell us what needs attention. Keep a safe distance from hazards.
              </Text>
              <View style={{ gap: 8 }}>
                <Text style={[s.fieldLabel, { fontSize: 15 }]}>Issue category</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={selectedCategory ? `Change issue category, currently ${categoryDisplayName(selectedCategory.name)}` : "Choose an issue category"} accessibilityHint="Opens the report type selector" onPress={() => setCategorySheetOpen(true)} style={({ pressed }) => [{ minHeight: 76, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 18, borderWidth: 1, borderColor: selectedCategory ? categoryToneFor(selectedCategory.name).foreground : "#e2eaf2", backgroundColor: selectedCategory ? "#fbfefd" : "white", flexDirection: "row", alignItems: "center", gap: 12 }, pressed && { opacity: 0.82 }]}>
                  <View style={{ width: 52, height: 52, borderRadius: 19, backgroundColor: selectedCategory ? categoryToneFor(selectedCategory.name).background : "#e5f6f2", alignItems: "center", justifyContent: "center" }}><Ionicons name={selectedCategory ? categoryIconFor(selectedCategory.name) : "grid-outline"} size={25} color={selectedCategory ? categoryToneFor(selectedCategory.name).foreground : colors.teal} /></View>
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <Text style={{ color: colors.navy, fontSize: 16, lineHeight: 20, fontWeight: "800" }}>{selectedCategory ? categoryDisplayName(selectedCategory.name) : "Choose a report type"}</Text>
                    {!!selectedCategory && <Text numberOfLines={2} style={s.small}>{categoryDescriptionFor(selectedCategory.name)}</Text>}
                  </View>
                  <Text style={{ color: colors.teal, fontSize: 14, fontWeight: "700" }}>{selectedCategory ? "Change" : "Choose"}</Text>
                </Pressable>
                {!!errors.category_id && <Text accessibilityRole="alert" style={s.error}>{errors.category_id.message}</Text>}
              </View>
              <SelectionSheet
                visible={categorySheetOpen}
                onClose={() => setCategorySheetOpen(false)}
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
              {!!selectedCategory && <View style={{ gap: 8 }}>
                <Text style={s.fieldLabel}>{drainage ? "What is the drainage problem?" : "What is the specific problem?"} <Text style={{ color: colors.muted }}>(required)</Text></Text>
                <Choices compact title={drainage ? "What is the drainage problem?" : `Problem type · ${categoryDisplayName(selectedCategory.name)}`} sheetTitle="Select a problem" subtitle={`Choose the specific ${categoryDisplayName(selectedCategory.name).toLowerCase()} issue to help route your report correctly.`} sheetKind="problem" categoryName={selectedCategory.name} placeholder="Select a problem" leadingIcon={categoryIconFor(selectedCategory.name)} items={problemOptions.map((item) => ({ id: item.code, name: item.label }))} value={values.problem_type || ""} onChange={(value) => {
                  if (value !== "other") setValue("problem_other", null);
                  clearErrors("problem_other");
                  setValue("problem_type", value, { shouldValidate: true });
                }} />
                {!problemOptions.length && <Text style={s.error}>Problem options are unavailable. Return Home and refresh before submitting.</Text>}
                {!!errors.problem_type && <Text accessibilityRole="alert" style={s.error}>{errors.problem_type.message}</Text>}
              </View>}
              {values.problem_type === "other" && <Controller control={control} name="problem_other" render={({ field }) => <View style={{ gap: 8 }}>
                <Field label={drainage ? "Please describe the drainage problem" : "Please describe the problem"} placeholder={drainage ? "Enter the drainage problem..." : "Enter the specific problem..."} value={field.value || ""} onChangeText={field.onChange} multiline maxLength={240} />
                <Text style={s.small}>Required for Others · {field.value?.length || 0}/240</Text>
                {!!errors.problem_other && <Text accessibilityRole="alert" style={s.error}>{errors.problem_other.message}</Text>}
              </View>} />}
              {(["title", "description", "landmark"] as const).map((name) => (
                <View key={name} style={{ gap: 7 }}>
                  <Controller
                    control={control}
                    name={name}
                    render={({ field }) => (
                      <Field
                        label={
                          name === "landmark"
                            ? "Landmark or location details (optional)"
                            : label(name)
                        }
                        leading={<Ionicons name={name === "title" ? "document-text-outline" : name === "description" ? "create-outline" : "location-outline"} size={21} color={name === "description" ? "#6f8199" : colors.teal} />}
                        value={field.value}
                        onChangeText={field.onChange}
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
                  {!!errors[name] && <Text accessibilityRole="alert" style={s.error}>{errors[name]?.message}</Text>}
                </View>
              ))}
              <View style={[s.card, { gap: 10, padding: 13, borderRadius: 18, backgroundColor: "#fbfdfd" }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: "#e5f6f2", alignItems: "center", justifyContent: "center" }}><Ionicons name="camera-outline" size={20} color={colors.teal} /></View>
                  <View style={{ flex: 1, gap: 2 }}><Text style={[s.fieldLabel, { fontSize: 14 }]}>Add a photo</Text><Text style={s.small}>Optional · Photograph the issue from a safe distance.</Text></View>
                </View>
                {photo ? <View style={{ flexDirection: "row", alignItems: "center", gap: 11, padding: 8, borderWidth: 1, borderColor: "#d8e9e6", borderRadius: 15, backgroundColor: "white" }}>
                  <PhotoViewer source={{ uri: photo }} label="Selected photograph preview" style={{ width: 72, height: 72, borderRadius: 11, backgroundColor: "#eaf2f1" }} />
                  <View style={{ flex: 1, gap: 4 }}><Text style={[s.fieldLabel, { color: colors.teal }]}>Photo ready</Text><Text style={s.small}>It will be attached privately to your report.</Text></View>
                  <Pressable accessibilityRole="button" accessibilityLabel="Replace photograph" onPress={() => void pick()} style={({ pressed }) => [{ width: 38, height: 38, borderRadius: 13, backgroundColor: "#eef4fc", alignItems: "center", justifyContent: "center" }, pressed && { opacity: 0.75 }]}><Ionicons name="images-outline" size={18} color="#526c9c" /></Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="Remove photograph" onPress={() => setPhoto(null)} style={({ pressed }) => [{ width: 40, height: 40, borderRadius: 13, backgroundColor: "#fff0ee", alignItems: "center", justifyContent: "center" }, pressed && { opacity: 0.75 }]}><Ionicons name="trash-outline" size={18} color="#a43d35" /></Pressable>
                </View> : <View style={s.actionRow}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Take a photo" onPress={() => void pick(true)} style={({ pressed }) => [{ flex: 1, minWidth: 0, minHeight: 58, padding: 8, borderRadius: 15, borderWidth: 1, borderColor: "#bfe7df", backgroundColor: "#effaf7", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }, pressed && { opacity: 0.78 }]}><View style={{ width: 32, height: 32, borderRadius: 11, backgroundColor: "#d9f2ec", alignItems: "center", justifyContent: "center" }}><Ionicons name="camera" size={17} color={colors.teal} /></View><Text style={{ color: colors.teal, fontSize: 12, fontWeight: "700" }}>Take photo</Text></Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="Upload a photo" onPress={() => void pick()} style={({ pressed }) => [{ flex: 1, minWidth: 0, minHeight: 58, padding: 8, borderRadius: 15, borderWidth: 1, borderColor: "#dce6f2", backgroundColor: "#f4f7fc", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }, pressed && { opacity: 0.78 }]}><View style={{ width: 32, height: 32, borderRadius: 11, backgroundColor: "#e5ecf8", alignItems: "center", justifyContent: "center" }}><Ionicons name="images" size={17} color="#526c9c" /></View><Text style={{ color: "#526c9c", fontSize: 12, fontWeight: "700" }}>Upload photo</Text></Pressable>
                </View>}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Preview a sample report review"
                onPress={() => {
                  if (!sampleCategory || !sampleProblem || !sampleBarangay) {
                    showMessage("The sample review is not ready yet. Please try again shortly.", "info");
                    return;
                  }
                  clearMessage();
                  setDemoReview(true);
                  setStep(2);
                }}
                style={({ pressed }) => [{ minHeight: 64, flexDirection: "row", alignItems: "center", gap: 11, padding: 12, borderWidth: 1, borderColor: "#cdece5", borderRadius: 17, backgroundColor: "#f1fbf8" }, pressed && { opacity: 0.82 }]}
              >
                <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: "#dff5ef", alignItems: "center", justifyContent: "center" }}><Ionicons name="eye-outline" size={20} color={colors.teal} /></View>
                <View style={{ flex: 1, gap: 3 }}><Text style={{ color: colors.navy, fontSize: 13, fontWeight: "800" }}>Preview a sample review</Text><Text style={s.small}>See how a completed report looks. Nothing will be sent.</Text></View>
                <Ionicons name="chevron-forward" size={18} color={colors.teal} />
              </Pressable>
            </>
          )}
          {step === 1 && (
            <>
              <View style={[s.card, { gap: 7, padding: 14, backgroundColor: "#f6fbfa", borderColor: "#dcefeb" }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: "#e1f5ef", alignItems: "center", justifyContent: "center" }}><Ionicons name="location-outline" size={22} color={colors.teal} /></View>
                  <View style={{ flex: 1, gap: 3 }}><Text style={s.fieldLabel}>Where is the issue?</Text><Text style={s.small}>Use your location or move the pin to the spot.</Text></View>
                </View>
                <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || locating, busy: locating }} disabled={busy || locating} onPress={async () => {
                  const request = ++locationRequest.current;
                  setLocating(true);
                  setLocationError("");
                  setConfirmed(false);
                  try {
                    const loc = await currentDeviceLocation();
                    if (request === locationRequest.current) await chooseLocation(loc, "gps", loc.accuracy, request);
                  } catch (e) {
                    if (request === locationRequest.current) setLocationError((e as Error).message);
                  } finally {
                    if (request === locationRequest.current) setLocating(false);
                  }
                }} style={({ pressed }) => [{ minHeight: 50, marginTop: 4, borderRadius: 14, backgroundColor: "#008d86", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, opacity: busy || locating ? 0.6 : pressed ? 0.84 : 1 }]}>
                  {locating ? <ActivityIndicator size="small" color="white" /> : <Ionicons name="locate-outline" size={19} color="white" />}
                  <Text style={{ color: "white", fontSize: 14, fontWeight: "800" }}>{locating ? "Checking location…" : "Use my current location"}</Text>
                </Pressable>
              </View>
              {!!locationError && <Text accessibilityRole="alert" style={s.error}>{locationError}</Text>}
              <View style={[s.card, { gap: 10, padding: 10 }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 4, paddingTop: 2 }}>
                  <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: "#edf3fb", alignItems: "center", justifyContent: "center" }}><Ionicons name="map-outline" size={19} color="#526c9c" /></View>
                  <View style={{ flex: 1, gap: 2 }}><Text style={[s.fieldLabel, { fontSize: 14 }]}>Place the issue pin</Text><Text style={s.small}>Tap the map to mark the exact spot.</Text></View>
                  {locationSource === "pin" && <View style={{ paddingHorizontal: 9, paddingVertical: 5, borderRadius: 12, backgroundColor: "#e6f7f1" }}><Text style={{ color: colors.teal, fontSize: 10, fontWeight: "800" }}>PIN SET</Text></View>}
                </View>
                <LocationMap height={300} point={locationSource ? { latitude: values.latitude, longitude: values.longitude } : undefined} onChoose={(point) => { void chooseLocation(point, "pin"); }} bounds={ILIGAN_MAP_BOUNDS} />
                <Text style={[s.small, { paddingHorizontal: 4 }]}>Free location check: PSGC (2023) and © OpenStreetMap contributors. Boundaries are indicative; confirm or correct the barangay below.</Text>
              </View>
              <View style={[s.card, { gap: 10, padding: 14 }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: confirmed ? "#e5f6f2" : "#fff5e7", alignItems: "center", justifyContent: "center" }}><Ionicons name={confirmed ? "checkmark-circle-outline" : "navigate-outline"} size={21} color={confirmed ? colors.teal : "#b7791f"} /></View>
                  <View style={{ flex: 1, gap: 3 }}><Text style={s.fieldLabel}>{confirmed ? "Location confirmed" : locationSource ? "Location checked" : "Choose a spot on the map"}</Text><Text numberOfLines={2} style={s.small}>{locationSource ? `${locationAddress || "Iligan City"} · ${values.latitude.toFixed(5)}, ${values.longitude.toFixed(5)}` : "Your report location stays private from the public."}</Text></View>
                </View>
                {locationSource === "gps" && <Text style={[s.small, { paddingLeft: 48 }]}>{locationAccuracy === null ? "GPS accuracy is unavailable. Check the pin before confirming." : `GPS accuracy: about ±${Math.round(locationAccuracy)} m.${locationAccuracy > 100 ? " Move the pin to the issue location." : " Move the pin if the issue is elsewhere."}`}</Text>}
                <Button secondary={confirmed} disabled={!locationSource || !cityConfirmed || locating} title={confirmed ? "Location confirmed" : "Confirm this location"} onPress={() => {
                  if (!locationSource || !cityConfirmed || locating) return;
                  if (coordinates.latitude !== String(values.latitude) || coordinates.longitude !== String(values.longitude)) {
                    showMessage("Apply your entered coordinates before confirming the point.", "warning");
                    return;
                  }
                  setLocationError("");
                  setConfirmed(true);
                  showMessage("Location confirmed.", "success");
                }} />
              </View>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: showCoordinates }} onPress={() => setShowCoordinates(!showCoordinates)} style={{ minHeight: 44, justifyContent: "center" }}><Text style={[s.small, { color: colors.teal, fontWeight: "700" }]}>{showCoordinates ? "Hide coordinate entry" : "Enter coordinates instead"}</Text></Pressable>
              {showCoordinates && <>{(["latitude", "longitude"] as const).map((name) => (
                <Field
                  key={name}
                  label={label(name)}
                  keyboardType="numbers-and-punctuation"
                  value={coordinates[name]}
                  onChangeText={(v) => {
                    setCoordinates((current) => ({ ...current, [name]: v }));
                    setConfirmed(false);
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
              <View style={[s.card, { gap: 8, padding: 14, backgroundColor: "#fbfdfd" }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}><Ionicons name="business-outline" size={20} color={colors.teal} /><Text style={s.fieldLabel}>Confirm the barangay</Text></View>
                <Text style={s.small}>{barangayReviewRequired ? detectedBarangayName ? `Nearest mapped barangay: ${detectedBarangayName}. We couldn’t identify an exact match at this pin. Please check the suggestion and change it below if needed.` : "We couldn’t identify a barangay here. Please choose and confirm the correct barangay below." : barangaySelectionSource === "pin" ? `Boundary data suggests ${detectedBarangayName}. You can change it if needed.` : barangaySelectionSource === "manual" ? `Barangay chosen manually${detectedBarangayName ? ` · Boundary data: ${detectedBarangayName}` : ""}.` : "Choose the barangay where the issue is. Your profile barangay is only a suggestion."}</Text>
                <Choices title="Choose a barangay" subtitle="Select the barangay where the issue is located." sheetKind="barangay" items={barangays} value={values.barangay_id} onChange={(value) => { setValue("barangay_id", value, { shouldValidate: true, shouldDirty: true }); setBarangaySelectionSource("manual"); setManualBarangayConfirmed(false); }} />
                {barangayReviewRequired && <View style={{ gap: 8, padding: 12, borderRadius: 14, backgroundColor: "#effaf7", borderWidth: 1, borderColor: "#cdece5" }}>
                  <Text accessibilityLiveRegion="polite" style={s.small}>{manualBarangayConfirmed ? `Barangay confirmed: ${selectedBarangay?.name}.` : "Review needed · The nearest barangay may not be the correct one for this location."}</Text>
                  <Button secondary={manualBarangayConfirmed} disabled={!selectedBarangay || !cityConfirmed || locating || manualBarangayConfirmed} title={manualBarangayConfirmed ? "Barangay confirmed" : "Confirm barangay"} onPress={() => setManualBarangayConfirmed(true)} />
                </View>}
                {barangayMismatch && !barangayReviewRequired && <View style={{ gap: 9, padding: 11, borderRadius: 14, borderWidth: 1, borderColor: manualBarangayConfirmed ? "#cdece5" : "#f0dfb8", backgroundColor: manualBarangayConfirmed ? "#f1fbf8" : "#fff9ed" }}>
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}><Ionicons name={manualBarangayConfirmed ? "checkmark-circle-outline" : "alert-circle-outline"} size={18} color={manualBarangayConfirmed ? colors.teal : "#a66a12"} /><Text style={{ flex: 1, color: colors.navy, fontSize: 12, lineHeight: 17 }}>{manualBarangayConfirmed ? `You’re keeping ${selectedBarangay?.name}; Boundary data suggests ${detectedBarangayName}.` : `Boundary data suggests ${detectedBarangayName}, but you selected ${selectedBarangay?.name}. Please check before continuing.`}</Text></View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Pressable accessibilityRole="button" onPress={() => { if (detectedBarangay) { setValue("barangay_id", detectedBarangay.id, { shouldValidate: true, shouldDirty: true }); setBarangaySelectionSource("pin"); setManualBarangayConfirmed(false); } }} style={{ minHeight: 38, flex: 1, paddingHorizontal: 8, borderRadius: 11, backgroundColor: colors.teal, alignItems: "center", justifyContent: "center" }}><Text numberOfLines={1} style={{ color: "white", fontSize: 11, fontWeight: "800" }}>Use {detectedBarangayName}</Text></Pressable>
                    <Pressable accessibilityRole="button" onPress={() => setManualBarangayConfirmed(true)} style={{ minHeight: 38, flex: 1, paddingHorizontal: 8, borderRadius: 11, borderWidth: 1, borderColor: "#d8e2ea", backgroundColor: "white", alignItems: "center", justifyContent: "center" }}><Text numberOfLines={1} style={{ color: colors.navy, fontSize: 11, fontWeight: "700" }}>Keep {selectedBarangay?.name}</Text></Pressable>
                  </View>
                </View>}
                {!!errors.barangay_id && <Text accessibilityRole="alert" style={s.error}>{errors.barangay_id.message}</Text>}
              </View>
            </>
          )}
          {step === 2 && <>
            {demoReview && <View style={{ flexDirection: "row", alignItems: "center", gap: 9, padding: 12, borderRadius: 15, borderWidth: 1, borderColor: "#cdece5", backgroundColor: "#effaf7" }}><Ionicons name="eye-outline" size={20} color={colors.teal} /><View style={{ flex: 1, gap: 2 }}><Text style={{ color: colors.teal, fontSize: 12, fontWeight: "800" }}>DEMO PREVIEW</Text><Text style={s.small}>This is a sample. Nothing will be submitted.</Text></View></View>}
            <ReportReviewCard
              category={reviewCategory?.name ?? "Report"}
              problem={reviewValues.problem_type === "other" ? reviewValues.problem_other || "Other" : reviewProblem || problemLabel || "Specific problem selected"}
              title={reviewValues.title}
              description={reviewValues.description}
              barangay={barangays.find((item) => item.id === reviewValues.barangay_id)?.name ?? ""}
              landmark={reviewValues.landmark}
              latitude={reviewValues.latitude}
              longitude={reviewValues.longitude}
              photo={demoReview ? null : photo}
            />
          </>}
          {step < 2 ? (
            <Button
              title="Continue"
              disabled={busy}
              onPress={async () => {
                clearMessage();
                if (step === 1) { await reviewReport(); return; }
                if (await trigger(["category_id", "problem_type", "problem_other", "title", "description"])) { clearMessage(); setStep(1); }
                    else showMessage(issueDetailsMessage(values), "warning");
              }}
            />
          ) : demoReview ? (
            <View style={{ minHeight: 56, padding: 12, borderRadius: 15, backgroundColor: "#effaf7", borderWidth: 1, borderColor: "#cdece5", flexDirection: "row", alignItems: "center", gap: 9 }}><Ionicons name="information-circle-outline" size={19} color={colors.teal} /><Text style={[s.small, { flex: 1 }]}>Demo only. Go back to edit the report or explore the sample layout.</Text></View>
          ) : (
            <Button
              title={busy ? "Sending report…" : "Submit report"}
              disabled={busy || !requestId}
              onPress={() => void handleSubmit(submit, (invalid) => {
                const detailFields = ["category_id", "problem_type", "problem_other", "title", "description"];
                const detailsIncomplete = Object.keys(invalid).some((field) => detailFields.includes(field));
                setStep(detailsIncomplete ? 0 : 1);
                showMessage(detailsIncomplete ? issueDetailsMessage(values) : "Choose and confirm the issue location and barangay before submitting.", "warning");
              })()}
            />
          )}
        </>
      )}
    </>
  );
}
export function ReportTracking({
  report: r,
  close,
  backLabel = "Back to reports",
  categoryName = "Community report",
  barangayName = "Not specified",
}: {
  report: Report;
  close: () => void;
  backLabel?: string;
  categoryName?: string;
  barangayName?: string;
}) {
  const [message, setMessage] = useState(""),
    [moreOpen, setMoreOpen] = useState(false);
  const { width: windowWidth } = useWindowDimensions();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["timeline", r.id],
    queryFn: async ({ signal }) => {
      const [problem, engagement, history, following, office] = await Promise.all([
        r.problem_type ? result<{ label: string }>(db!.from("report_problem_types").select("label").eq("category_id", r.category_id).eq("code", r.problem_type).abortSignal(signal).single()) : null,
        result<{ followers: number; endorsements: number }>(db!.rpc("report_engagement", { p_id: r.id }).abortSignal(signal)),
        result<{ id: number; new_status: string; public_note: string; created_at: string }[]>(
          db!.from("report_status_history").select("id,new_status,public_note,created_at").eq("report_id", r.id).order("created_at").abortSignal(signal)),
        result<{ report_id: string }[]>(db!.from("report_followers").select("report_id").eq("report_id", r.id).abortSignal(signal)),
        r.organization_id ? result<Lookup>(db!.from("organizations").select("id,name").eq("id", r.organization_id).abortSignal(signal).single()) : null,
      ]);
      return { problem, engagement, history, following, office };
    },
  });
  const attachments = useQuery({
    queryKey: ["report-detail-attachments", r.id],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const rows = await result<{ path: string }[]>(db!.from("report_attachments").select("path").eq("report_id", r.id).order("path"));
      if (!rows.length) return [] as { path: string; url: string }[];
      const signed = await db!.storage.from("report-evidence").createSignedUrls(rows.map((item) => item.path), 600);
      if (signed.error) throw signed.error;
      return rows.flatMap((item, index) => signed.data[index]?.signedUrl ? [{ path: item.path, url: signed.data[index].signedUrl! }] : []);
    },
  });
  const goBack = () => { setMoreOpen(false); close(); };
  const following = !!q.data?.following.length;
  const tone = reportStatusTone(r.status);
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
  const actionButton = (icon: "share-social-outline" | "ellipsis-horizontal", labelText: string, onPress: () => void) => <Pressable key={labelText} accessibilityRole="button" accessibilityLabel={labelText} onPress={onPress} style={({ pressed }) => [{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "white", borderWidth: 1, borderColor: "#edf2f1" }, pressed && { opacity: 0.7 }]}><Ionicons name={icon} size={20} color={colors.navy} /></Pressable>;
  return (
    <>
      <AppBackNavigation label={backLabel} onBack={goBack} actions={<>
        {actionButton("share-social-outline", "Share public report summary", shareSummary)}
        {actionButton("ellipsis-horizontal", "More report options", () => setMoreOpen(true))}
      </>} />
      <View style={{ gap: 9, paddingHorizontal: 2, paddingBottom: 2 }}>
        <View style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 20, backgroundColor: tone.background }}><Ionicons name={r.status === "resolved" ? "checkmark-circle" : r.status === "rejected" ? "close-circle" : "time-outline"} size={16} color={tone.foreground} /><Text style={{ color: tone.foreground, fontSize: 12, fontWeight: "800" }}>{label(r.status)}</Text></View>
        <Text accessibilityRole="header" style={[s.heading, { fontSize: 25, lineHeight: 31 }]}>{r.title}</Text>
        {!!r.description && <Text style={[s.body, { color: "#637c91" }]}>{r.description}</Text>}
        {r.is_demo && <Text style={{ color: "#9a6410", fontSize: 12, fontWeight: "700" }}>Demonstration record</Text>}
        <View style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 13, backgroundColor: categoryTone.background }}><Ionicons name={categoryIconFor(categoryName)} size={16} color={categoryTone.foreground} /><Text style={{ color: categoryTone.foreground, fontSize: 12, fontWeight: "800" }}>{categoryDisplayName(categoryName)}{q.data?.problem ? ` · ${q.data.problem.label}` : ""}</Text></View>
        {!!r.problem_other && <Text style={s.small}>{r.problem_other}</Text>}
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 9 }}>
        <View style={[s.card, { width: windowWidth < 360 ? "100%" : "48.5%", minHeight: 106, justifyContent: "center", gap: 9, padding: 12, borderColor: "#e0efec", backgroundColor: "#fff" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}><View style={{ width: 30, height: 30, borderRadius: 11, backgroundColor: "#e5f6f2", alignItems: "center", justifyContent: "center" }}><Ionicons name="location-outline" size={17} color={colors.teal} /></View><Text style={{ color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 0.6 }}>BARANGAY</Text></View>
          <View style={{ gap: 2 }}><Text numberOfLines={2} style={{ color: colors.navy, fontSize: 14, lineHeight: 18, fontWeight: "800" }}>{barangayName === "Not specified" ? "Not specified" : barangayName}</Text><Text numberOfLines={1} style={{ color: colors.muted, fontSize: 10, lineHeight: 14 }}>Iligan City · Lanao del Norte</Text></View>
        </View>
        <View style={[s.card, { width: windowWidth < 360 ? "100%" : "48.5%", minHeight: 106, justifyContent: "center", gap: 9, padding: 12, borderColor: "#e0efec", backgroundColor: "#fff" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}><View style={{ width: 30, height: 30, borderRadius: 11, backgroundColor: "#eaf2ff", alignItems: "center", justifyContent: "center" }}><Ionicons name="business-outline" size={17} color="#3972b8" /></View><Text style={{ color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 0.6 }}>ASSIGNED OFFICE</Text></View>
          <Text style={{ color: colors.navy, fontSize: 14, lineHeight: 18, fontWeight: "800" }}>{q.isPending ? "Loading office…" : q.data?.office?.name || (r.organization_id ? "Office details unavailable" : "Awaiting assignment")}</Text>
        </View>
      </View>

      <View style={[s.card, { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 8, gap: 6, backgroundColor: "#eff9f6", borderColor: "#eff9f6" }]}>
        <EngagementMetric icon="people-outline" value={q.data?.engagement.followers} label="Followers" />
        <View style={{ width: 1, height: 38, backgroundColor: "#cfe7e1" }} />
        <EngagementMetric icon="share-social-outline" value={q.data?.engagement.endorsements} label="Shared experience" />
        <View style={{ width: 1, height: 38, backgroundColor: "#cfe7e1" }} />
        <EngagementMetric icon="time-outline" value={q.data?.history.length} label="Updates" />
      </View>

      <View style={{ borderRadius: 20, overflow: "hidden", borderWidth: 1, borderColor: colors.line }}>
        <LocationMap point={{ latitude: r.latitude, longitude: r.longitude, title: r.title, categoryName, color: categoryTone.foreground, subtitle: `${barangayName === "Not specified" ? "Iligan City" : barangayName} · approximate location` }} height={Math.max(190, Math.min(320, Math.round(windowWidth * 0.62)))} bounds={ILIGAN_MAP_BOUNDS} />
        <View style={{ minHeight: 64, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 13, backgroundColor: "white" }}><View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: "#e5f6f2", alignItems: "center", justifyContent: "center" }}><Ionicons name="calendar-outline" size={19} color={colors.teal} /></View><View style={{ flex: 1, gap: 2 }}><Text style={s.fieldLabel}>Submitted</Text><Text style={s.small}>{new Date(r.created_at).toLocaleString()}</Text></View></View>
      </View>

      <View style={s.card}>
        <View style={{ gap: 3 }}><Text style={s.title}>Report timeline</Text><Text style={s.small}>Track the progress of this report from submission to resolution.</Text></View>
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
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: q.isPending }} disabled={q.isPending} onPress={() => void toggleFollow()} style={{ minHeight: 52, flexDirection: "row", alignItems: "center", gap: 11, borderRadius: 14, paddingHorizontal: 12, backgroundColor: "#f2f8f6" }}><Ionicons name={following ? "bookmark" : "bookmark-outline"} size={20} color={colors.teal} /><Text style={{ flex: 1, color: colors.navy, fontSize: 14, fontWeight: "700" }}>{following ? "Unfollow report updates" : "Follow report updates"}</Text><Ionicons name="chevron-forward" size={18} color={colors.muted} /></Pressable>
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
  if (value.includes("review")) return { background: "#eaf2ff", foreground: "#315b92" };
  if (value.includes("assigned")) return { background: "#f0eaff", foreground: "#6844a3" };
  if (value.includes("verified")) return { background: "#e8f1ff", foreground: "#3264a0" };
  return statusToneFor(status);
}

function EngagementMetric({ icon, value, label: text }: { icon: "people-outline" | "share-social-outline" | "time-outline"; value?: number; label: string }) {
  return <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }}><Ionicons name={icon} size={19} color={colors.teal} /><View style={{ flex: 1, minWidth: 0, gap: 3 }}>{value === undefined ? <View style={{ width: 20, height: 14, borderRadius: 4, backgroundColor: "#dce7e3" }} /> : <Text style={{ color: colors.navy, fontSize: 15, fontWeight: "800" }}>{value}</Text>}<Text numberOfLines={2} style={{ color: colors.muted, fontSize: 9, lineHeight: 12 }}>{text}</Text></View></View>;
}

function ReportTimelineSkeleton() {
  return <View style={{ gap: 0 }}>
    {[0, 1, 2].map((item) => <View key={item} style={{ minHeight: 66, flexDirection: "row", gap: 12 }}>
      <View style={{ width: 22, alignItems: "center" }}><View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: "#dce7e3" }} />{item < 2 && <View style={{ width: 2, flex: 1, backgroundColor: "#e2eeea" }} />}</View>
      <View style={{ flex: 1, gap: 8, paddingBottom: 12 }}><View style={{ width: "38%", height: 13, borderRadius: 5, backgroundColor: "#dce7e3" }} /><View style={{ width: "78%", height: 11, borderRadius: 5, backgroundColor: "#e7eeeb" }} /></View>
    </View>)}
  </View>;
}

function ReportTimeline({ history, currentStatus }: { history: { id: number; new_status: string; public_note: string; created_at: string }[]; currentStatus: string }) {
  return <View>
    {history.map((event, index) => {
      const isCurrent = index === history.length - 1 && event.new_status === currentStatus;
      const tone = reportStatusTone(event.new_status);
      const exceptional = /rejected|cancelled/i.test(event.new_status);
      return <View key={event.id} style={{ minHeight: 66, flexDirection: "row", gap: 12 }}>
        <View style={{ width: 22, alignItems: "center" }}><View style={{ width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: tone.foreground }}><Ionicons name={exceptional ? "close" : "checkmark"} size={14} color="white" /></View>{index < history.length - 1 && <View style={{ width: 2, flex: 1, backgroundColor: "#b9dfd5" }} />}</View>
        <View style={{ flex: 1, minWidth: 0, gap: 3, paddingBottom: index < history.length - 1 ? 13 : 0 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 4 }}><Text style={{ flexShrink: 1, color: colors.navy, fontSize: 14, fontWeight: "800" }}>{label(event.new_status)}{isCurrent ? " · Current" : ""}</Text><Text style={{ color: colors.muted, fontSize: 10 }}>{new Date(event.created_at).toLocaleString()}</Text></View>
          {!!event.public_note && <Text style={s.small}>{event.public_note}</Text>}
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
    <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}><Ionicons name="images-outline" size={21} color={colors.teal} /><View style={{ flex: 1, gap: 2 }}><Text style={s.title}>Photos and attachments</Text><Text style={s.small}>View photos or files related to this report.</Text></View><Pressable accessibilityRole="button" accessibilityLabel={`View all ${items.length} report photos`} disabled={!items.length} onPress={() => showPhoto(0)} style={{ minHeight: 40, paddingHorizontal: 10, borderRadius: 13, backgroundColor: "#e5f6f2", flexDirection: "row", alignItems: "center", gap: 5, opacity: items.length ? 1 : 0.5 }}><Text style={{ color: colors.teal, fontSize: 11, fontWeight: "800" }}>View all ({loading ? "…" : items.length})</Text><Ionicons name="chevron-forward" size={16} color={colors.teal} /></Pressable></View>
    {loading ? <View style={{ height: 92, borderRadius: 13, backgroundColor: "#e7eeeb" }} /> : error ? <View style={{ gap: 8 }}><Text accessibilityRole="alert" style={s.error}>{error}</Text><Button secondary title="Retry attachments" onPress={onRetry} /></View> : items.length ? <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ gap: 9 }}>
      {items.map((item, itemIndex) => <Pressable key={item.path} accessibilityRole="button" accessibilityLabel={`View report photo ${itemIndex + 1} of ${items.length}`} onPress={() => showPhoto(itemIndex)} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}><Image source={{ uri: item.url }} resizeMode="cover" style={{ width: Math.min(152, width * 0.42), height: 92, borderRadius: 13, backgroundColor: "#eaf2f1", borderWidth: 1, borderColor: colors.line }} /><View pointerEvents="none" style={{ position: "absolute", right: 6, bottom: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: "#ffffffed", alignItems: "center", justifyContent: "center" }}><Ionicons name="expand-outline" size={13} color={colors.navy} /></View></Pressable>)}
    </ScrollView> : <View style={{ minHeight: 74, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 13, backgroundColor: "#f5f9f7" }}><Ionicons name="image-outline" size={18} color={colors.muted} /><Text style={s.small}>No photos or files are attached to this report.</Text></View>}
    {open && <Modal visible transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={() => setOpen(false)} onShow={() => viewer.current?.scrollTo({ x: index * slideWidth, animated: false })}>
      <View style={{ flex: 1, backgroundColor: "#06111e", justifyContent: "center" }}>
        <ScrollView ref={viewer} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={(event) => setIndex(Math.round(event.nativeEvent.contentOffset.x / slideWidth))}>
          {items.map((item) => <View key={item.path} style={{ width: slideWidth, height, alignItems: "center", justifyContent: "center" }}><Image source={{ uri: item.url }} resizeMode="contain" style={{ width: slideWidth, height: height * 0.82 }} /></View>)}
        </ScrollView>
        <Pressable accessibilityRole="button" accessibilityLabel="Close photo viewer" onPress={() => setOpen(false)} style={{ position: "absolute", top: 48, right: 18, width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffffed" }}><Ionicons name="close" size={24} color={colors.navy} /></Pressable>
        {items.length > 1 && <>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous photo" disabled={!index} onPress={() => move(index - 1)} style={{ position: "absolute", left: 12, top: "48%", width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffffdd", opacity: index ? 1 : 0.45 }}><Ionicons name="chevron-back" size={23} color={colors.navy} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Next photo" disabled={index >= items.length - 1} onPress={() => move(index + 1)} style={{ position: "absolute", right: 12, top: "48%", width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffffdd", opacity: index < items.length - 1 ? 1 : 0.45 }}><Ionicons name="chevron-forward" size={23} color={colors.navy} /></Pressable>
        </>}
        <Text style={{ position: "absolute", bottom: 28, alignSelf: "center", color: "white", fontSize: 13, fontWeight: "700" }}>{index + 1} of {items.length}</Text>
      </View>
    </Modal>}
  </View>;
}
export function Explore({
  categories,
  barangays,
  onOpenReport,
  suspendExpandedMap = false,
}: {
  categories: Lookup[];
  barangays: Lookup[];
  onOpenReport: (report: Report) => void;
  suspendExpandedMap?: boolean;
}) {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const thumbnailWidth = windowWidth < 360 ? 76 : 92;
  const mapHeight = Math.max(330, Math.min(400, Math.round(windowHeight * 0.43)));
  const [category, setCategory] = useState(""),
    [barangay, setBarangay] = useState(""),
    [search, setSearch] = useState(""),
    [appliedSearch, setAppliedSearch] = useState(""),
    [showMap, setShowMap] = useState(true),
    [showBarangayMap, setShowBarangayMap] = useState(false),
    [barangayMetric, setBarangayMetric] = useState<"density" | "count">("density"),
    [selectedChoroplethName, setSelectedChoroplethName] = useState(""),
    [density, setDensity] = useState(true),
    [mapStatus, setMapStatus] = useState("active"),
    [hoveredStatus, setHoveredStatus] = useState<string | null>(null),
    [recentOnly, setRecentOnly] = useState(false),
    [expandedMap, setExpandedMap] = useState(false),
    [mapStyle, setMapStyle] = useState<MapStyle>("satellite"),
    [showPins, setShowPins] = useState(true),
    [densityCellCount, setDensityCellCount] = useState<number | null>(null),
    [selectedReportId, setSelectedReportId] = useState<string | null>(null),
    [selectedListReportId, setSelectedListReportId] = useState<string | null>(null),
    [failedPhotos, setFailedPhotos] = useState<Record<string, boolean>>({}),
    [currentLocation, setCurrentLocation] = useState<{ latitude: number; longitude: number } | undefined>(),
    [locating, setLocating] = useState(false),
    [nearbyRadius, setNearbyRadius] = useState("0"),
    [page, setPage] = useState(0),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const mapViewport = useRef<Region>({ latitude: 8.228, longitude: 124.2452, latitudeDelta: 0.05, longitudeDelta: 0.05 });
  const setMapViewport = useCallback((region: Region) => { mapViewport.current = region; }, []);
  const selectMapPoint = useCallback((point: Point) => setSelectedReportId(point.id ?? null), []);
  const expandMap = useCallback(() => setExpandedMap(true), []);
  useEffect(() => {
    const timer = setTimeout(() => setAppliedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const q = useQuery({
    queryKey: ["public-reports"],
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
    !!currentLocation && distanceMeters(currentLocation, item) <= Number(nearbyRadius)),
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
    queryFn: async () => {
      try {
        const attachments = await result<{ report_id: string; path: string }[]>(
          db!.from("report_attachments").select("report_id,path").in("report_id", photoReportIds),
        );
        if (!attachments.length) return {} as Record<string, string>;
        const urls = await db!.storage.from("report-evidence").createSignedUrls(
          attachments.map((item) => item.path), 3600,
        );
        if (urls.error) return {} as Record<string, string>;
        return Object.fromEntries(attachments.flatMap((item, index) =>
          urls.data[index]?.signedUrl ? [[item.report_id, urls.data[index].signedUrl!]] : [],
        ));
      } catch {
        // Public report evidence remains subject to the existing attachment and storage RLS policies.
        return {} as Record<string, string>;
      }
    },
  });
  const mapPoints = useMemo(() => mapReports.map((report) => {
    const categoryName = categoryNames.get(report.category_id) || "Other reports";
    return { ...report, createdAt: report.created_at, categoryName, color: categoryToneFor(categoryName).foreground,
      photoUrl: reportPhotos.data?.[report.id],
      statusLabel: label(report.status),
      barangayName: barangayNames.get(report.barangay_id) ?? "Iligan City",
      subtitle: `${label(report.status)} · ${barangayNames.get(report.barangay_id) ?? "Community"}` };
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
  const demoMapReports = mapReports.filter((item) => item.is_demo).length;
  const mapScope = [
    mapStatus !== "all" && (mapStatus === "active" ? "Unresolved" : "Resolved"),
    recentOnly && "Last 30 days",
    demoMapReports ? `${mapReports.length - demoMapReports} non-demo · ${demoMapReports} demo preview` : "Published reports",
  ].filter(Boolean).join(" · ");
  const pinCategories = [...new Map(mapPoints.map((point) => [point.categoryName, point.color])).entries()];
  const selectedMapReport = showPins ? mapPoints.find((point) => point.id === selectedReportId) : undefined;
  const selectedListReport = reports.find((item) => item.id === selectedListReportId);
  const hasActiveFilters = !!(category || barangay || search || mapStatus !== "active" || recentOnly);
  const renderBarangayReportRows = (items: Report[]) => items.map((report) => {
    const name = categoryNames.get(report.category_id) || "Other reports";
    const tone = categoryToneFor(name);
    const photo = reportPhotos.data?.[report.id];
    return <Pressable key={report.id} accessibilityRole="button" accessibilityLabel={`Open report: ${report.title}`} onPress={() => onOpenReport(report)} style={({ pressed }) => [{ minHeight: 60, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderTopWidth: 1, borderColor: "#e7eff1" }, pressed && { opacity: 0.75 }]}>
      {photo && !failedPhotos[report.id] ? <PhotoViewer source={{ uri: photo }} label={`${categoryDisplayName(name)} report photo`} onError={() => setFailedPhotos((value) => ({ ...value, [report.id]: true }))} style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: tone.background }} /> : <View style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: tone.background, alignItems: "center", justifyContent: "center" }}><Ionicons name={categoryIconFor(name)} size={19} color={tone.foreground} /></View>}
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text numberOfLines={1} style={{ color: colors.navy, fontSize: 12, fontWeight: "700" }}>{report.title}</Text><Text numberOfLines={1} style={s.small}>{categoryDisplayName(name)} · {label(report.status)} · {new Date(report.created_at).toLocaleDateString()}</Text></View><Ionicons name="chevron-forward" size={17} color={colors.muted} />
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
  return (
    <>
      <View style={{ minHeight: 112, justifyContent: "center", overflow: "hidden", paddingVertical: 16 }}>
        <View pointerEvents="none" style={{ position: "absolute", right: -18, top: -4, width: 360, height: 120, opacity: 0.42 }}><Image source={require("../assets/iligan-explore-header.jpg")} accessible={false} resizeMode="contain" style={{ width: "100%", height: "100%" }} /></View>
        <Text style={[s.title, { fontSize: 24 }]}>Around your community</Text>
        <Text style={[s.subtitle, { maxWidth: 300, marginTop: 8 }]}>See what neighbors have reported nearby. Locations are approximate.</Text>
      </View>
      <View style={[s.segmented, { minHeight: 56, backgroundColor: "white", borderWidth: 1, borderColor: "#e3edf0", borderRadius: 16 }]}>
        {([
          ["map", "Map", "map-outline"],
          ["barangays", "Barangays", "map"],
          ["list", "List", "list-outline"],
        ] as const).map(([mode, title, icon]) => (
          <Pressable
            key={mode}
            accessibilityRole="tab"
            accessibilityLabel={`${title} view`}
            accessibilityState={{ selected: mode === "list" ? !showMap : showMap && showBarangayMap === (mode === "barangays") }}
            onPress={() => { setShowMap(mode !== "list"); setShowBarangayMap(mode === "barangays"); setSelectedReportId(null); setDensityCellCount(null); }}
            style={[s.segment, { minHeight: 48, paddingHorizontal: 8 }, (mode === "list" ? !showMap : showMap && showBarangayMap === (mode === "barangays")) && s.segmentActive]}
          >
            <View style={[s.row, { flexWrap: "nowrap", gap: 8 }]}>
              <Ionicons name={icon} size={17} color={(mode === "list" ? !showMap : showMap && showBarangayMap === (mode === "barangays")) ? colors.teal : colors.muted} />
              <Text style={[s.small, (mode === "list" ? !showMap : showMap && showBarangayMap === (mode === "barangays")) && { color: colors.teal, fontWeight: "700" }]}>{title}</Text>
            </View>
          </Pressable>
        ))}
      </View>
      <View style={{ gap: 4 }}>
        <View style={[s.card, { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 58, paddingVertical: 8 }]}>
          <Ionicons name="search" size={20} color={colors.muted} />
          <TextInput accessibilityLabel="Search public reports" placeholder="Search public reports" placeholderTextColor="#8499aa" value={search} onChangeText={(v) => { setSearch(v); setDensityCellCount(null); setPage(0); }} returnKeyType="search" style={{ flex: 1, minWidth: 0, minHeight: 42, color: colors.navy, fontSize: 14 }} />
          {!!search && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => { setSearch(""); setAppliedSearch(""); setDensityCellCount(null); setPage(0); }} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}><Ionicons name="close-circle" size={19} color={colors.muted} /></Pressable>}
        </View>
        <Text style={{ color: colors.muted, fontSize: 11, lineHeight: 16, paddingHorizontal: 12 }}>Try ‘pothole’, ‘streetlight’, or a barangay</Text>
      </View>
      <View style={{ flexDirection: windowWidth < 400 ? "column" : "row", alignItems: "stretch", gap: windowWidth < 400 ? 8 : 12 }}>
        <Choices
          grow={windowWidth >= 400}
          items={[{ id: "", name: "All categories" }, ...categories]}
          value={category}
          compact
          title="Choose a report type"
          leadingIcon="grid-outline"
          shortCategoryNames
          onChange={(v) => { setCategory(v); setDensityCellCount(null); setPage(0); }}
        />
        <Choices
          grow={windowWidth >= 400}
          items={[{ id: "", name: "All barangays" }, ...barangays]}
          value={barangay}
          leadingIcon="location-outline"
          onChange={(v) => { setBarangay(v); setDensityCellCount(null); setPage(0); }}
        />
      </View>
      <View style={[s.card, { gap: 12, borderColor: "#d8f0eb", shadowOpacity: 0.06, shadowRadius: 12 }]}>
        <View style={[s.row, { flexWrap: "nowrap", justifyContent: "space-between", alignItems: "center" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 9, flex: 1, minWidth: 0 }}>
            <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: "#e5f8f4", alignItems: "center", justifyContent: "center" }}><Ionicons name="options" size={18} color={colors.teal} /></View>
            <Text style={[s.title, { fontSize: 16, lineHeight: 20, flexShrink: 1 }]}>Filter reports</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Clear all report filters" disabled={!hasActiveFilters} onPress={() => { setCategory(""); setBarangay(""); setSearch(""); setAppliedSearch(""); setMapStatus("active"); setRecentOnly(false); setNearbyRadius("0"); setDensityCellCount(null); setSelectedReportId(null); setPage(0); }} style={({ pressed }) => [{ minHeight: 40, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 4, opacity: hasActiveFilters ? 1 : 0.48 }, pressed && hasActiveFilters && { opacity: 0.72 }]}><Ionicons name="refresh" size={17} color={colors.muted} /><Text style={[s.small, { fontSize: 12, fontWeight: "600" }]}>Clear all</Text></Pressable>
        </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
          {[
            { id: "all", title: "All statuses", count: counts.all_count },
            { id: "active", title: "Unresolved", count: counts.active_count },
            { id: "resolved", title: "Resolved", count: counts.resolved_count },
          ].map(({ id, title, count }) => {
            const selected = mapStatus === id;
            const hovered = hoveredStatus === id;
            return <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected }} onHoverIn={() => setHoveredStatus(id)} onHoverOut={() => setHoveredStatus((value) => value === id ? null : value)} onPress={() => { setMapStatus(id); setDensityCellCount(null); setSelectedReportId(null); setPage(0); }} style={({ pressed }) => [{ flex: 1, minWidth: 0, minHeight: 46, borderRadius: 15, borderWidth: 1, borderColor: selected ? colors.teal : "#d8f0eb", backgroundColor: selected ? colors.teal : hovered ? "#effaf7" : "white", alignItems: "center", justifyContent: "center", paddingHorizontal: 3 }, pressed && { opacity: 0.82 }]}><Text numberOfLines={2} style={{ color: selected ? "white" : colors.muted, fontSize: 11, lineHeight: 14, fontWeight: selected ? "700" : "600", textAlign: "center" }}>{title} ({count})</Text></Pressable>;
          })}
        </View>
        <View style={{ height: 1, backgroundColor: "#d8f0eb" }} />
        <Pressable accessibilityRole="switch" accessibilityLabel="Reported in last 30 days" accessibilityState={{ checked: recentOnly }} onPress={() => { setRecentOnly(!recentOnly); setDensityCellCount(null); setSelectedReportId(null); setPage(0); }} style={({ pressed }) => [{ minHeight: 54, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 15, borderWidth: 1, borderColor: recentOnly ? "#b8e9df" : "#d8f0eb", backgroundColor: recentOnly ? "#f2fbf8" : "white", paddingHorizontal: 10 }, pressed && { opacity: 0.82 }]}>
          <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: "#e5f8f4", alignItems: "center", justifyContent: "center" }}><Ionicons name="calendar" size={18} color={colors.teal} /></View>
          <Text style={[s.body, { flex: 1, fontSize: 13, fontWeight: "600" }]}>Reported in last 30 days</Text>
          <View style={{ width: 38, height: 23, borderRadius: 12, padding: 3, backgroundColor: recentOnly ? colors.teal : "#d5e0e8", justifyContent: "center" }}><View style={{ width: 17, height: 17, borderRadius: 9, backgroundColor: "white", alignSelf: recentOnly ? "flex-end" : "flex-start", shadowColor: "#123", shadowOpacity: 0.14, shadowRadius: 3, elevation: 1 }} /></View>
        </Pressable>
      </View>
      {showMap && (
        <>
          {mapQuery.error && <View style={s.card}><Text style={s.error}>Could not refresh map reports.</Text><Button secondary title="Retry map" loading={mapQuery.isFetching} onPress={() => void mapQuery.refetch()} /></View>}
          {!showBarangayMap && <>
            <View style={{ flexDirection: windowWidth < 360 ? "column" : "row", alignItems: windowWidth < 360 ? "stretch" : "center", gap: 8 }}>
              <View style={{ flex: 1, minWidth: windowWidth < 360 ? 0 : 108 }}><Text accessibilityLiveRegion="polite" style={[s.body, { fontSize: 14, fontWeight: "700" }]}>{mapQuery.isFetching ? "Updating…" : `${mapReports.length} reports`}</Text><Text numberOfLines={2} style={s.small}>{mapScope}</Text></View>
              <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
                {([[showPins, setShowPins, "Pins", "location"], [density, setDensity, "Heat", "layers"]] as const).map(([enabled, setEnabled, title, icon]) => <Pressable key={title} accessibilityRole="checkbox" accessibilityLabel={`${title === "Heat" ? "Heat Map" : title} layer`} accessibilityState={{ checked: enabled }} onPress={() => { setEnabled(!enabled); if (title === "Heat") setDensityCellCount(null); }} style={({ pressed }) => [{ minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12, borderWidth: 1, borderColor: enabled ? colors.teal : colors.line, paddingHorizontal: 10, backgroundColor: enabled ? colors.teal : "white" }, pressed && { opacity: 0.78 }]}><Ionicons name={icon} size={15} color={enabled ? "white" : colors.muted} /><Text style={{ color: enabled ? "white" : colors.muted, fontSize: 11, fontWeight: "700" }}>{title} {enabled ? "On" : "Off"}</Text></Pressable>)}
              </View>
            </View>
          </>}
          {expandedMap ? <View style={{ height: mapHeight }} /> : <LocationMap
            points={mapPoints}
            height={mapHeight}
            density={!showBarangayMap && density}
            showPoints={!showBarangayMap && showPins}
            showClusterCounts={!showBarangayMap}
            onDensityCellPress={setDensityCellCount}
            selectedCellCount={densityCellCount}
            userPoint={currentLocation}
            locating={locating}
            onLocate={locateOnMap}
            selectedPointId={selectedReportId ?? undefined}
            onPointPress={selectMapPoint}
            onExpand={expandMap}
            showBarangayBoundaries={showBarangayMap}
            barangayCounts={barangayCounts}
            barangayMetric={barangayMetric}
            onBarangayPress={selectBarangayOnMap}
            onMapBackgroundPress={() => setSelectedChoroplethName("")}
            selectedBarangayName={selectedChoroplethName}
            mapStyle={mapStyle}
            onMapStyleChange={setMapStyle}
            initialRegion={mapViewport.current}
            onViewportChange={setMapViewport}
            bounds={ILIGAN_MAP_BOUNDS}
          />}
          {showBarangayMap && <View style={[s.card, { gap: 12 }]}>
            <View style={[s.row, { flexWrap: "nowrap", alignItems: "center", justifyContent: "space-between" }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}><Ionicons name="analytics-outline" size={19} color={colors.teal} /><Text style={[s.title, { fontSize: 15 }]}>Barangay report heat</Text></View>
              <Text style={[s.small, { fontWeight: "700" }]}>{mappedBarangayReportCount} mapped</Text>
            </View>
            <Text style={s.small}>{barangayMetric === "density" ? "Heat is normalized by barangay area, making differently sized areas easier to compare." : "Shows total matching reports assigned to each barangay."} Uses your selected filters.</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {([["density", "Reports / km²"], ["count", "Total reports"]] as const).map(([value, title]) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: barangayMetric === value }} onPress={() => setBarangayMetric(value)} style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 12, backgroundColor: barangayMetric === value ? colors.teal : "#f2f7f8", alignItems: "center", justifyContent: "center" }}><Text style={{ color: barangayMetric === value ? "white" : colors.muted, fontSize: 11, fontWeight: "700" }}>{title}</Text></Pressable>)}
            </View>
            <View accessibilityLabel={barangayMetric === "density" ? "Relative report density legend" : "Report count legend"} style={{ flexDirection: "row", flexWrap: "wrap", gap: 11 }}>
              {(barangayMetric === "density" ? [["#34d399", "Low"], ["#facc15", "Moderate"], ["#f97316", "High"], ["#ef4444", "Highest"]] : [["#cbd5e1", "0"], ["#38bdf8", "1–2"], ["#14b8a6", "3–5"], ["#f59e0b", "6–10"], ["#ef4444", "11+"]]).map(([color, text]) => <View key={text} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><View style={{ width: 11, height: 11, borderRadius: 3, backgroundColor: color }} /><Text style={[s.small, { fontSize: 11 }]}>{text}</Text></View>)}
            </View>
            {!!barangayHeatStats.top.length && <View style={{ gap: 5, paddingTop: 2 }}>
              <Text style={{ color: colors.navy, fontSize: 12, fontWeight: "800" }}>Highest report density</Text>
              {barangayHeatStats.top.map((row, index) => <Pressable key={row.name} accessibilityRole="button" accessibilityLabel={`${row.name}, ${row.count} reports, ${row.density.toFixed(1)} per square kilometer`} accessibilityState={{ selected: selectedChoroplethName === row.name }} onPress={() => setSelectedChoroplethName((current) => current === row.name ? "" : row.name)} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 8, borderRadius: 10, backgroundColor: selectedChoroplethName === row.name ? "#effaf7" : "transparent" }}>
                <Text style={{ width: 20, color: colors.muted, fontSize: 12, fontWeight: "700" }}>{index + 1}</Text><View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: barangayDensityColor(row.density, barangayHeatStats.maxDensity) }} /><Text numberOfLines={1} style={{ flex: 1, color: colors.navy, fontSize: 13, fontWeight: selectedChoroplethName === row.name ? "800" : "600" }}>{row.name}</Text><Text style={{ color: colors.muted, fontSize: 12 }}>{row.count} · {row.density.toFixed(1)}/km²</Text>
              </Pressable>)}
            </View>}
            {!!selectedChoroplethName && <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
              <Text style={[s.small, { color: colors.teal, fontWeight: "700", flex: 1 }]}>{selectedChoroplethName}: {barangayCounts[barangayMapKey(selectedChoroplethName)] ?? 0} matching reports · tap area again to clear</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Clear barangay selection" onPress={() => setSelectedChoroplethName("")} style={{ minHeight: 36, justifyContent: "center", paddingHorizontal: 8 }}><Text style={{ color: colors.muted, fontSize: 11, fontWeight: "700" }}>Clear</Text></Pressable>
              <Pressable accessibilityRole="button" onPress={() => { const item = barangays.find((entry) => barangayMapKey(entry.name) === barangayMapKey(selectedChoroplethName)); if (item) { setBarangay(item.id); setSelectedReportId(null); setPage(0); } }} style={{ minHeight: 36, justifyContent: "center", paddingHorizontal: 10, borderRadius: 11, backgroundColor: "#e5f6f2" }}><Text style={{ color: colors.teal, fontSize: 11, fontWeight: "700" }}>Filter here</Text></Pressable>
            </View>}
            {!!selectedChoroplethName && <View style={{ gap: 4 }}>
              <Text style={{ color: colors.navy, fontSize: 12, fontWeight: "800" }}>Reports in {selectedChoroplethName} · {selectedBarangayReports.length}</Text>
              {selectedBarangayReports.length ? renderBarangayReportRows(selectedBarangayReports) : <Text style={s.small}>No reports in this barangay match the current filters.</Text>}
            </View>}
            {mappedBarangayReportCount < mapReports.length && <Text style={[s.small, { fontSize: 10 }]}>{mapReports.length - mappedBarangayReportCount} reports have no matching barangay boundary and are not shaded.</Text>}
            <Text style={[s.small, { fontSize: 10 }]}>Boundary source: 2023 PSGC snapshot · indicative mapped boundaries</Text>
            {mapQuery.data?.length === 500 && <Text style={[s.small, { color: colors.muted }]}>Counts use the latest 500 published reports. Narrow the filters for more detail.</Text>}
          </View>}
          {expandedMap && <Modal visible={!suspendExpandedMap} animationType="slide" onRequestClose={() => setExpandedMap(false)}>
            <View style={{ flex: 1, backgroundColor: colors.paper, paddingTop: 14 }}>
              <View style={{ minHeight: 58, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View><Text style={s.title}>{showBarangayMap ? "Barangay heatmap" : "Explore Iligan"}</Text><Text style={s.small}>{showBarangayMap ? `${mappedBarangayReportCount} mapped reports · tap a barangay` : `${mapReports.length} matching reports · approximate locations`}</Text></View>
                <Pressable accessibilityRole="button" accessibilityLabel="Close expanded map" onPress={() => setExpandedMap(false)} style={{ width: 46, height: 46, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "white" }}><Ionicons name="close" size={23} color={colors.navy} /></Pressable>
              </View>
              <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 24, gap: 12 }}>
                <LocationMap points={mapPoints} height={showBarangayMap ? Math.max(310, windowHeight * 0.5) : Math.max(320, windowHeight - 92)} density={!showBarangayMap && density} showPoints={!showBarangayMap && showPins} showClusterCounts={!showBarangayMap} onDensityCellPress={setDensityCellCount} selectedCellCount={densityCellCount} userPoint={currentLocation} locating={locating} onLocate={locateOnMap} selectedPointId={selectedReportId ?? undefined} onPointPress={selectMapPoint} mapStyle={mapStyle} onMapStyleChange={setMapStyle} initialRegion={mapViewport.current} onViewportChange={setMapViewport} bounds={ILIGAN_MAP_BOUNDS} showBarangayBoundaries={showBarangayMap} barangayCounts={barangayCounts} barangayMetric={barangayMetric} onBarangayPress={selectBarangayOnMap} onMapBackgroundPress={() => setSelectedChoroplethName("")} selectedBarangayName={selectedChoroplethName} />
                {showBarangayMap && <View style={[s.card, { gap: 12 }]}>
                  <View style={[s.row, { flexWrap: "nowrap", justifyContent: "space-between", alignItems: "center" }]}><Text style={[s.title, { fontSize: 15, flex: 1 }]}>{selectedChoroplethName || "Barangay report heat"}</Text><Text style={[s.small, { fontWeight: "700" }]}>{selectedChoroplethName ? `${selectedBarangayReports.length} reports` : `${mappedBarangayReportCount} mapped`}</Text>{!!selectedChoroplethName && <Pressable accessibilityRole="button" accessibilityLabel="Clear barangay selection" onPress={() => setSelectedChoroplethName("")} style={{ minHeight: 34, justifyContent: "center", paddingHorizontal: 8 }}><Text style={{ color: colors.teal, fontSize: 11, fontWeight: "800" }}>Clear</Text></Pressable>}</View>
                  <Text style={s.small}>{selectedChoroplethName ? "Tap this barangay again, tap outside it on the map, or choose Clear to return to the heat summary." : barangayMetric === "density" ? "Color shows reports per km²; counts below use your current map filters." : "Color shows total matching reports for each barangay."}</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {([["density", "Reports / km²"], ["count", "Total reports"]] as const).map(([value, title]) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: barangayMetric === value }} onPress={() => setBarangayMetric(value)} style={{ minHeight: 35, paddingHorizontal: 11, borderRadius: 11, backgroundColor: barangayMetric === value ? colors.teal : "#f2f7f8", justifyContent: "center" }}><Text style={{ color: barangayMetric === value ? "white" : colors.muted, fontSize: 11, fontWeight: "700" }}>{title}</Text></Pressable>)}
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>{(barangayMetric === "density" ? [["#34d399", "Low"], ["#facc15", "Moderate"], ["#f97316", "High"], ["#ef4444", "Highest"]] : [["#cbd5e1", "0"], ["#38bdf8", "1–2"], ["#14b8a6", "3–5"], ["#f59e0b", "6–10"], ["#ef4444", "11+"]]).map(([color, title]) => <View key={title} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} /><Text style={[s.small, { fontSize: 10 }]}>{title}</Text></View>)}</View>
                  <View style={{ height: 1, backgroundColor: colors.line }} />
                  <Text style={{ color: colors.navy, fontSize: 12, fontWeight: "800" }}>{selectedChoroplethName ? `Reports in ${selectedChoroplethName}` : "Busiest barangays"}</Text>
                  {!selectedChoroplethName && barangayHeatStats.top.map((row) => <Pressable key={row.name} accessibilityRole="button" onPress={() => setSelectedChoroplethName(row.name)} style={{ minHeight: 38, flexDirection: "row", alignItems: "center", gap: 8 }}><View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: barangayDensityColor(row.density, barangayHeatStats.maxDensity) }} /><Text style={{ flex: 1, color: colors.navy, fontSize: 12 }}>{row.name}</Text><Text style={s.small}>{row.count} · {row.density.toFixed(1)}/km²</Text></Pressable>)}
                  {!!selectedChoroplethName && selectedBarangayReports.length === 0 && <Text style={s.small}>No reports in this barangay match the current filters.</Text>}
                  {selectedBarangayReports.map((report) => {
                    const name = categoryNames.get(report.category_id) || "Other reports";
                    const tone = categoryToneFor(name);
                    return <Pressable key={report.id} accessibilityRole="button" accessibilityLabel={`Open report: ${report.title}`} onPress={() => onOpenReport(report)} style={({ pressed }) => [{ minHeight: 60, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderTopWidth: 1, borderColor: "#e7eff1" }, pressed && { opacity: 0.75 }]}>
                      {reportPhotos.data?.[report.id] && !failedPhotos[report.id] ? <PhotoViewer source={{ uri: reportPhotos.data[report.id] }} label={`${categoryDisplayName(name)} report photo`} onError={() => setFailedPhotos((value) => ({ ...value, [report.id]: true }))} style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: tone.background }} /> : <View style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: tone.background, alignItems: "center", justifyContent: "center" }}><Ionicons name={categoryIconFor(name)} size={19} color={tone.foreground} /></View>}
                      <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text numberOfLines={1} style={{ color: colors.navy, fontSize: 12, fontWeight: "700" }}>{report.title}</Text><Text numberOfLines={1} style={s.small}>{categoryDisplayName(name)} · {label(report.status)} · {new Date(report.created_at).toLocaleDateString()}</Text></View><Ionicons name="chevron-forward" size={17} color={colors.muted} />
                    </Pressable>;
                  })}
                </View>}
              </ScrollView>
            </View>
          </Modal>}
          {!showBarangayMap && !density && !showPins && <Text style={s.small}>Both layers are off. Turn on Pins or Heat to see reports.</Text>}
          {!showBarangayMap && !mapQuery.isPending && !mapQuery.error && !mapPoints.length && <View style={s.card}><Text style={s.title}>No reports match these map filters</Text><Text style={s.small}>Try Any distance, All statuses, another barangay, or a wider date range.</Text></View>}
          {selectedMapReport && (() => {
            const tone = categoryToneFor(selectedMapReport.categoryName);
            const status = statusToneFor(selectedMapReport.statusLabel);
            const failed = failedPhotos[selectedMapReport.id!];
            return <View style={[s.card, { borderRadius: 19, borderLeftWidth: 4, borderLeftColor: selectedMapReport.color, gap: 10 }]}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Open full details for ${selectedMapReport.title}`} onPress={() => onOpenReport(selectedMapReport)} style={({ pressed }) => [pressed && { opacity: 0.82 }]}>
            <View style={{ flexDirection: "row", alignItems: "stretch", gap: 11 }}>
              {selectedMapReport.photoUrl && !failed ? <PhotoViewer source={{ uri: selectedMapReport.photoUrl }} label={`${categoryDisplayName(selectedMapReport.categoryName)} report photo`} onError={() => setFailedPhotos((value) => ({ ...value, [selectedMapReport.id!]: true }))} style={{ width: thumbnailWidth, minHeight: 108, borderRadius: 13, backgroundColor: "#eaf2f1" }} /> : <View style={{ width: thumbnailWidth, minHeight: 108, borderRadius: 13, backgroundColor: tone.background, borderWidth: 1, borderColor: `${tone.foreground}20`, alignItems: "center", justifyContent: "center" }}><Ionicons name={categoryIconFor(selectedMapReport.categoryName)} size={32} color={tone.foreground} /></View>}
              <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
                  <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 }}><View style={{ width: 27, height: 27, borderRadius: 9, backgroundColor: tone.background, alignItems: "center", justifyContent: "center" }}><Ionicons name={categoryIconFor(selectedMapReport.categoryName)} size={15} color={tone.foreground} /></View><Text numberOfLines={1} style={[s.eyebrow, { flex: 1, fontSize: 10 }]}>{categoryDisplayName(selectedMapReport.categoryName)}</Text></View>
                  <View style={{ paddingHorizontal: 8, paddingVertical: 5, borderRadius: 20, backgroundColor: status.background }}><Text numberOfLines={1} style={{ color: status.foreground, fontSize: 10, fontWeight: "700" }}>{selectedMapReport.statusLabel}</Text></View>
                  <Pressable accessibilityRole="button" accessibilityLabel="Close selected report" onPress={() => setSelectedReportId(null)} style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: "#f2f7f6" }}><Ionicons name="close" size={18} color={colors.muted} /></Pressable>
                </View>
                <Text numberOfLines={2} style={[s.title, { fontSize: 14, lineHeight: 18 }]}>{selectedMapReport.title}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}><Ionicons name="location-outline" size={14} color={colors.muted} /><Text numberOfLines={1} style={[s.small, { flex: 1 }]}>{selectedMapReport.barangayName} · approx. location</Text></View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}><Ionicons name="calendar-outline" size={14} color={colors.muted} /><Text style={s.small}>{new Date(selectedMapReport.created_at).toLocaleDateString()}</Text></View>
                {currentLocation && <Text numberOfLines={1} style={[s.small, { color: colors.teal, fontWeight: "700" }]}>About {(distanceMeters(currentLocation, selectedMapReport) / 1000).toFixed(1)} km away</Text>}
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4, paddingTop: 2 }}><Text style={{ color: colors.teal, fontSize: 12, fontWeight: "700" }}>View report details</Text><Ionicons name="chevron-forward" size={16} color={colors.teal} /></View>
            </Pressable>
            <Button secondary title={follows.data?.some((item) => item.report_id === selectedMapReport.id) ? "Following · Unfollow" : "Follow updates & support"} disabled={busy || follows.isPending || !!follows.error} loading={busy} onPress={() => void toggleFollow(selectedMapReport.id)} />
          </View>;
          })()}
          {showPins && pinCategories.length > 0 && <View style={{ minHeight: 34, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 2 }}>
            <Text style={{ color: colors.muted, fontSize: 10, fontWeight: "800" }}>Types</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ flexDirection: "row", alignItems: "center", gap: 12 }} style={{ flex: 1, minWidth: 0 }}>
              {pinCategories.map(([name, color]) => <View key={name} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Ionicons name={categoryIconFor(name)} color={color} size={14} />
                <Text numberOfLines={1} style={{ color: colors.navy, fontSize: 11, fontWeight: "600" }}>{categoryDisplayName(name)}</Text>
              </View>)}
            </ScrollView>
          </View>}
          {mapQuery.data?.length === 500 && <Text style={s.small}>Showing the latest 500 published locations. Use the barangay or category filters to narrow the map.</Text>}
          <View style={[s.card, { gap: 10 }]}>
            <View style={[s.row, { flexWrap: "nowrap", alignItems: "center" }]}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#e5f6f2", alignItems: "center", justifyContent: "center" }}><Ionicons name="navigate" size={19} color={colors.teal} /></View>
              <View style={{ flex: 1, gap: 3 }}><Text style={s.title}>Explore nearby</Text><Text style={s.small}>Find published reports around your current location</Text></View>
              <Ionicons name="chevron-forward" size={19} color={colors.muted} />
            </View>
            <Button title={locating ? "Finding your location…" : currentLocation ? "Update nearby reports" : "Find near me"} loading={locating} onPress={() => void locateNearby(currentLocation ? nearbyRadius : "3000")} />
            {currentLocation && <Choices columns={2} title="Search radius" items={[{ id: "0", name: "Any" }, { id: "1000", name: "1 km" }, { id: "3000", name: "3 km" }, { id: "5000", name: "5 km" }]} value={nearbyRadius} onChange={(value) => { setNearbyRadius(value); setDensityCellCount(null); setSelectedReportId(null); }} />}
          </View>
        </>
      )}
      {!!message && <Text accessibilityRole="alert" style={s.body}>{message}</Text>}
      {follows.error && <View style={s.card}><Text style={s.error}>Could not load your followed reports.</Text><Button secondary title="Retry followed reports" onPress={() => void follows.refetch()} /></View>}
      {!showMap && <>
      {q.isPending && <ListSkeleton variant="publicReport" count={3} label="Loading public reports" />}
      {q.error && <View style={s.card}><Text style={s.error}>{q.error.message}</Text><Button secondary title="Retry reports" onPress={() => void q.refetch()} /></View>}
      {!q.isPending && !q.error && !reports.length && (
        <View style={[s.card, { alignItems: "center", gap: 8, paddingVertical: 22 }]}><Ionicons name="search-outline" size={27} color={colors.muted} /><Text style={s.title}>No reports found</Text><Text style={[s.subtitle, { textAlign: "center" }]}>Try adjusting your search or filters.</Text><Button secondary title="Reset filters" onPress={() => { setCategory(""); setBarangay(""); setSearch(""); setAppliedSearch(""); setMapStatus("active"); setRecentOnly(false); setNearbyRadius("0"); setDensityCellCount(null); setSelectedReportId(null); setPage(0); }} /></View>
      )}
      {reports.map((r) => {
        const following = follows.data?.some((f) => f.report_id === r.id);
        const categoryName = categories.find((c) => c.id === r.category_id)?.name ?? "Community report";
        const photoUrl = reportPhotos.data?.[r.id];
        const statusTone = statusToneFor(r.status);
        return (
          <View style={[s.card, { gap: 12 }]} key={r.id}>
            <Pressable accessibilityRole="button" accessibilityLabel={`View public details for ${r.title}`} onPress={() => setSelectedListReportId(r.id)} style={({ pressed }) => [{ flexDirection: "row", alignItems: "stretch", gap: 11 }, pressed && { opacity: 0.84 }]}>
              {photoUrl && !failedPhotos[r.id] ? <PhotoViewer source={{ uri: photoUrl }} label={`${categoryDisplayName(categoryName)} report photo`} onError={() => setFailedPhotos((value) => ({ ...value, [r.id]: true }))} style={{ width: thumbnailWidth, minHeight: 108, borderRadius: 13, backgroundColor: "#eaf2f1" }} /> : <View style={{ width: thumbnailWidth, minHeight: 108, borderRadius: 13, backgroundColor: categoryToneFor(categoryName).background, borderWidth: 1, borderColor: `${categoryToneFor(categoryName).foreground}20`, alignItems: "center", justifyContent: "center" }}><Ionicons name={categoryIconFor(categoryName)} size={32} color={categoryToneFor(categoryName).foreground} /></View>}
              <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 5 }}>
                  <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 }}><View style={{ width: 27, height: 27, borderRadius: 9, backgroundColor: categoryToneFor(categoryName).background, alignItems: "center", justifyContent: "center" }}><Ionicons name={categoryIconFor(categoryName)} size={15} color={categoryToneFor(categoryName).foreground} /></View><Text numberOfLines={1} style={[s.eyebrow, { flex: 1, fontSize: 10 }]}>{categoryDisplayName(categoryName)}</Text></View>
                  <View style={{ paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20, backgroundColor: statusTone.background }}><Text numberOfLines={1} style={{ color: statusTone.foreground, fontSize: 10, fontWeight: "700" }}>{label(r.status)}</Text></View>
                </View>
                <Text numberOfLines={2} style={[s.title, { fontSize: 14, lineHeight: 18 }]}>{r.title}{r.is_demo && !r.title.includes("[DEMO]") ? " [DEMO]" : ""}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}><Ionicons name="location-outline" size={14} color={colors.muted} /><Text numberOfLines={1} style={[s.small, { flex: 1 }]}>{barangays.find((b) => b.id === r.barangay_id)?.name ?? "Iligan City"} · approx. location</Text></View>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 5 }}><View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}><Ionicons name="calendar-outline" size={14} color={colors.muted} /><Text style={s.small}>{new Date(r.created_at).toLocaleDateString()}</Text></View><Ionicons name="chevron-forward" size={18} color={colors.muted} /></View>
              </View>
            </Pressable>
            <View style={{ flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 10 }}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Show ${r.title} on map`} onPress={() => { setCategory(r.category_id); setBarangay(r.barangay_id); setSearch(""); setAppliedSearch(""); setMapStatus("all"); setRecentOnly(false); setNearbyRadius("0"); setSelectedReportId(r.id); setShowMap(true); }} style={{ minHeight: 38, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8 }}><Ionicons name="map-outline" size={16} color={colors.muted} /><Text style={s.small}>View map</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={following ? "Unfollow report" : "Follow report updates"} accessibilityState={{ checked: !!following, disabled: busy || follows.isPending || !!follows.error }} disabled={busy || follows.isPending || !!follows.error} onPress={() => void toggleFollow(r.id)} style={{ minHeight: 38, flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 12, paddingHorizontal: 10, backgroundColor: following ? "#e5f6f2" : "#f4f8f7", opacity: busy || follows.isPending || !!follows.error ? 0.55 : 1 }}><Ionicons name={following ? "bookmark" : "bookmark-outline"} size={16} color={colors.teal} /><Text style={{ color: colors.teal, fontSize: 11, fontWeight: "700" }}>{following ? "Following" : "Follow updates"}</Text></Pressable>
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
      <Modal visible={!!selectedListReport} animationType="slide" transparent onRequestClose={() => setSelectedListReportId(null)}>
        {selectedListReport && (() => {
          const categoryName = categories.find((item) => item.id === selectedListReport.category_id)?.name ?? "Community report";
          const tone = statusToneFor(selectedListReport.status);
          const photoUrl = reportPhotos.data?.[selectedListReport.id];
          return <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#0a253344" }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close report details" onPress={() => setSelectedListReportId(null)} style={{ flex: 1 }} />
            <View style={{ maxHeight: "82%", borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20, paddingBottom: 28, gap: 13, backgroundColor: "white" }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Text style={[s.eyebrow, { color: colors.teal }]}>PUBLIC REPORT</Text><Pressable accessibilityRole="button" accessibilityLabel="Close report details" onPress={() => setSelectedListReportId(null)} style={{ width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: "#f2f7f6" }}><Ionicons name="close" size={21} color={colors.navy} /></Pressable></View>
              {photoUrl && !failedPhotos[selectedListReport.id] ? <PhotoViewer source={{ uri: photoUrl }} label={`${categoryDisplayName(categoryName)} report photo`} onError={() => setFailedPhotos((value) => ({ ...value, [selectedListReport.id]: true }))} style={{ width: "100%", height: 190, borderRadius: 17, backgroundColor: "#eaf2f1" }} /> : <View style={{ width: "100%", height: 140, borderRadius: 17, backgroundColor: categoryToneFor(categoryName).background, alignItems: "center", justifyContent: "center" }}><Ionicons name={categoryIconFor(categoryName)} size={48} color={categoryToneFor(categoryName).foreground} /></View>}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}><View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}><Ionicons name={categoryIconFor(categoryName)} size={18} color={categoryToneFor(categoryName).foreground} /><Text style={[s.eyebrow, { flexShrink: 1 }]}>{categoryDisplayName(categoryName)}</Text></View><View style={{ borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: tone.background }}><Text style={{ color: tone.foreground, fontSize: 11, fontWeight: "700" }}>{label(selectedListReport.status)}</Text></View></View>
              <Text style={[s.title, { fontSize: 21, lineHeight: 27 }]}>{selectedListReport.title}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Ionicons name="location-outline" size={18} color={colors.muted} /><Text style={[s.body, { flex: 1 }]}>{barangays.find((item) => item.id === selectedListReport.barangay_id)?.name ?? "Iligan City"} · approximate public location</Text></View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Ionicons name="calendar-outline" size={18} color={colors.muted} /><Text style={s.body}>{new Date(selectedListReport.created_at).toLocaleDateString()}</Text></View>
              <Text style={s.small}>Exact report locations and private descriptions are not shown in public details.</Text>
              <View style={{ flexDirection: "row", gap: 9 }}><Pressable accessibilityRole="button" onPress={() => { const report = selectedListReport; setSelectedListReportId(null); setCategory(report.category_id); setBarangay(report.barangay_id); setSearch(""); setAppliedSearch(""); setMapStatus("all"); setRecentOnly(false); setNearbyRadius("0"); setSelectedReportId(report.id); setShowMap(true); }} style={{ flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: "#eff6f4", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }}><Ionicons name="map-outline" size={17} color={colors.teal} /><Text style={{ color: colors.teal, fontWeight: "700" }}>View on map</Text></Pressable><Pressable accessibilityRole="button" disabled={busy || follows.isPending || !!follows.error} onPress={() => void toggleFollow(selectedListReport.id)} style={{ flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: colors.teal, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, opacity: busy || follows.isPending || !!follows.error ? 0.55 : 1 }}><Ionicons name={follows.data?.some((item) => item.report_id === selectedListReport.id) ? "bookmark" : "bookmark-outline"} size={17} color="white" /><Text style={{ color: "white", fontWeight: "700" }}>{follows.data?.some((item) => item.report_id === selectedListReport.id) ? "Following" : "Follow"}</Text></Pressable></View>
            </View>
          </View>;
        })()}
      </Modal>
    </>
  );
}
