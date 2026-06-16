import { useState } from "react";
import { Image, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
// expo-file-system v19+ moved readAsStringAsync/EncodingType to legacy sub-path.
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import Ionicons from "@expo/vector-icons/Ionicons";

import { colors } from "../../constants/theme";
import { errorHaptic, tapHaptic } from "../../lib/haptics";

export interface ImageAnswerValue {
  base64: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
}

interface ImageAnswerProps {
  value: ImageAnswerValue | null;
  onChange: (value: ImageAnswerValue | null) => void;
  disabled?: boolean;
  /** When true, shows coding-specific design (purple accent + numbered submit steps). */
  forCoding?: boolean;
}

const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const MIN_IMAGE_EDGE = 700;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function approximateBytesFromBase64(base64: string): number {
  return Math.ceil((base64.length * 3) / 4);
}

async function assetToBase64(asset: ImagePicker.ImagePickerAsset): Promise<ImageAnswerValue> {
  const base64 =
    asset.base64 ??
    (await FileSystem.readAsStringAsync(asset.uri, {
      encoding: FileSystem.EncodingType.Base64,
    }));
  return {
    base64,
    mimeType: asset.mimeType ?? "image/jpeg",
    width: asset.width ?? 0,
    height: asset.height ?? 0,
    sizeBytes: approximateBytesFromBase64(base64),
  };
}

function qualityScore(value: ImageAnswerValue): { label: string; color: string; icon: string } {
  const minEdge = Math.min(value.width, value.height);
  const maxEdge = Math.max(value.width, value.height);
  if (minEdge >= 1200 && maxEdge >= 1600) {
    return { label: "Excellent quality", color: colors.success, icon: "checkmark-circle" };
  }
  if (minEdge >= 700) {
    return { label: "Good quality", color: "#F59E0B", icon: "checkmark-circle-outline" };
  }
  return { label: "Low quality — retake", color: colors.danger, icon: "warning-outline" };
}

// Photo tips shown in the empty state
const PHOTO_TIPS = [
  { icon: "sunny-outline" as const, text: "Use bright, even lighting — avoid harsh shadows" },
  { icon: "phone-portrait-outline" as const, text: "Hold camera directly above the paper, no angle" },
  { icon: "pencil-outline" as const, text: "Write clearly with dark pen, large enough to read" },
  { icon: "crop-outline" as const, text: "Crop close to your solution — exclude blank margins" },
];

const CODING_STEPS = [
  { icon: "pencil-outline" as const, label: "Write", text: "Solve on paper — clearly, large handwriting" },
  { icon: "camera-outline" as const, label: "Snap", text: "Take photo directly above, good lighting" },
  { icon: "cloud-upload-outline" as const, label: "Submit", text: "AI OCR scores your handwritten solution" },
];

const CODING_ACCENT = "#7A6A9E";

export default function ImageAnswer({ value, onChange, disabled = false, forCoding = false }: ImageAnswerProps) {
  const accent = forCoding ? CODING_ACCENT : colors.primary[500];
  const [error, setError] = useState<string | null>(null);
  const [zoomVisible, setZoomVisible] = useState(false);

  const pickImage = async (source: "camera" | "library") => {
    if (disabled) return;
    tapHaptic();
    setError(null);
    try {
      const permission =
        source === "camera"
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        errorHaptic();
        setError("Permission required — allow access in your device settings.");
        return;
      }

      const pickerOptions: ImagePicker.ImagePickerOptions = {
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.92,          // Higher quality for better OCR
        allowsEditing: true,
        aspect: [4, 3],
        base64: true,
      };

      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync(pickerOptions)
          : await ImagePicker.launchImageLibraryAsync(pickerOptions);

      if (result.canceled || result.assets.length === 0) return;
      const nextValue = await assetToBase64(result.assets[0]);

      if (!SUPPORTED_IMAGE_TYPES.has(nextValue.mimeType)) {
        errorHaptic();
        setError("Unsupported format. Please use JPEG, PNG, WEBP, HEIC, or HEIF.");
        return;
      }
      if (Math.max(nextValue.width, nextValue.height) < MIN_IMAGE_EDGE) {
        errorHaptic();
        setError("Image is too small for accurate OCR. Move closer and retake.");
        return;
      }
      if (nextValue.sizeBytes > MAX_IMAGE_BYTES) {
        errorHaptic();
        setError("Image too large (max 8 MB). Crop closer to your solution.");
        return;
      }
      onChange(nextValue);
    } catch (err) {
      console.error("[ImageAnswer] failed to pick image:", err);
      errorHaptic();
      setError("Couldn't attach that image. Please try again.");
    }
  };

  const clearImage = () => {
    tapHaptic();
    setError(null);
    onChange(null);
  };

  // ── Preview state ─────────────────────────────────────────────────────────
  if (value) {
    const quality = qualityScore(value);
    const sizeMB = (value.sizeBytes / (1024 * 1024)).toFixed(1);

    return (
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.previewHeader}>
          <View style={styles.previewHeaderLeft}>
            <Ionicons name="checkmark-circle" size={18} color={colors.success} />
            <Text style={styles.previewHeaderText}>Solution captured</Text>
          </View>
          <TouchableOpacity
            onPress={clearImage}
            disabled={disabled}
            style={[styles.retakeButton, disabled && styles.disabled]}
            hitSlop={8}
          >
            <Ionicons name="refresh" size={14} color={colors.primary[500]} />
            <Text style={styles.retakeText}>Retake</Text>
          </TouchableOpacity>
        </View>

        {/* Image preview — tap to zoom */}
        <TouchableOpacity
          onPress={() => { tapHaptic(); setZoomVisible(true); }}
          activeOpacity={0.9}
          style={styles.imageWrapper}
        >
          <Image
            source={{ uri: `data:${value.mimeType};base64,${value.base64}` }}
            resizeMode="contain"
            style={styles.previewImage}
          />
          <View style={styles.zoomBadge}>
            <Ionicons name="expand-outline" size={14} color="#FFFFFF" />
            <Text style={styles.zoomBadgeText}>Tap to zoom</Text>
          </View>
        </TouchableOpacity>

        {/* Quality + meta bar */}
        <View style={styles.metaRow}>
          <View style={styles.qualityBadge}>
            <Ionicons name={quality.icon as any} size={13} color={quality.color} />
            <Text style={[styles.qualityText, { color: quality.color }]}>{quality.label}</Text>
          </View>
          <Text style={styles.metaText}>
            {value.width}×{value.height} · {sizeMB} MB
          </Text>
        </View>

        {quality.label === "Low quality — retake" && (
          <View style={styles.qualityWarning}>
            <Ionicons name="information-circle-outline" size={14} color={colors.warning} />
            <Text style={styles.qualityWarningText}>
              Low resolution may reduce OCR accuracy. For best results, move closer and retake.
            </Text>
          </View>
        )}

        {/* Zoom modal */}
        <Modal visible={zoomVisible} transparent animationType="fade" onRequestClose={() => setZoomVisible(false)}>
          <View style={styles.modalOverlay}>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setZoomVisible(false)}>
              <Ionicons name="close-circle" size={32} color="#FFFFFF" />
            </TouchableOpacity>
            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              maximumZoomScale={Platform.OS !== "web" ? 4 : 1}
              minimumZoomScale={1}
            >
              <Image
                source={{ uri: `data:${value.mimeType};base64,${value.base64}` }}
                resizeMode="contain"
                style={styles.zoomImage}
              />
            </ScrollView>
          </View>
        </Modal>
      </View>
    );
  }

  // ── Empty / tips state ────────────────────────────────────────────────────
  return (
    <View style={[styles.container, forCoding && { borderColor: `${CODING_ACCENT}30`, backgroundColor: `${CODING_ACCENT}05` }]}>
      {/* Icon + headline */}
      <View style={styles.emptyIconRow}>
        <View style={[styles.emptyIconCircle, { backgroundColor: `${accent}18` }]}>
          <Ionicons name={forCoding ? "image-outline" : "camera"} size={26} color={accent} />
        </View>
        <View style={styles.emptyTextBlock}>
          <Text style={styles.emptyTitle}>
            {forCoding ? "Submit your handwritten solution" : "Upload your handwritten solution"}
          </Text>
          <Text style={styles.emptySubtitle}>
            {forCoding
              ? "AI-powered OCR reads & scores your code — photo quality matters"
              : "OCR extracts your code — quality matters for accurate scoring"}
          </Text>
        </View>
      </View>

      {/* Coding: numbered steps. Generic: photo tips */}
      {forCoding ? (
        <View style={[styles.tipsBlock, { borderColor: `${CODING_ACCENT}20` }]}>
          <Text style={[styles.tipsTitle, { color: CODING_ACCENT }]}>How to submit</Text>
          {CODING_STEPS.map((step, idx) => (
            <View key={idx} style={styles.tipRow}>
              <View style={[styles.codingStepNum, { backgroundColor: `${CODING_ACCENT}18` }]}>
                <Text style={[styles.codingStepNumText, { color: CODING_ACCENT }]}>{idx + 1}</Text>
              </View>
              <View style={styles.emptyTextBlock}>
                <Text style={[styles.codingStepLabel, { color: CODING_ACCENT }]}>{step.label}</Text>
                <Text style={styles.tipText}>{step.text}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.tipsBlock}>
          <Text style={styles.tipsTitle}>Tips for best OCR results</Text>
          {PHOTO_TIPS.map((tip) => (
            <View key={tip.icon} style={styles.tipRow}>
              <View style={[styles.tipIconWrap, { backgroundColor: `${accent}10` }]}>
                <Ionicons name={tip.icon} size={14} color={accent} />
              </View>
              <Text style={styles.tipText}>{tip.text}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Action buttons */}
      <View style={styles.buttonRow}>
        <TouchableOpacity
          onPress={() => pickImage("camera")}
          disabled={disabled}
          style={[styles.btnPrimary, { backgroundColor: accent }, disabled && styles.disabled]}
          activeOpacity={0.85}
        >
          <Ionicons name="camera-outline" size={18} color="#FFFFFF" />
          <Text style={styles.btnPrimaryText}>{forCoding ? "Snap Photo" : "Take Photo"}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => pickImage("library")}
          disabled={disabled}
          style={[styles.btnSecondary, disabled && styles.disabled]}
          activeOpacity={0.85}
        >
          <Ionicons name="images-outline" size={18} color={colors.text.secondary} />
          <Text style={styles.btnSecondaryText}>Library</Text>
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle-outline" size={14} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#F9F5F7",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E8D8E0",
    padding: 16,
  },
  // ── Preview ─────────────────────────────────────────────────────────
  previewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  previewHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  previewHeaderText: { fontSize: 14, fontWeight: "600", color: colors.text.primary },
  retakeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary[500],
    backgroundColor: `${colors.primary[500]}10`,
  },
  retakeText: { fontSize: 12, fontWeight: "600", color: colors.primary[500] },
  imageWrapper: {
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E8D8E0",
    position: "relative",
  },
  previewImage: { width: "100%", height: 220 },
  zoomBadge: {
    position: "absolute",
    bottom: 8,
    right: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  zoomBadgeText: { fontSize: 11, color: "#FFFFFF", fontWeight: "600" },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
  },
  qualityBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  qualityText: { fontSize: 12, fontWeight: "600" },
  metaText: { fontSize: 11, color: colors.text.muted },
  qualityWarning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: 10,
    backgroundColor: "#FEF3C7",
    borderRadius: 8,
    padding: 10,
  },
  qualityWarningText: { fontSize: 12, color: "#92400E", flex: 1, lineHeight: 18 },
  // ── Zoom modal ──────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalCloseBtn: { position: "absolute", top: 48, right: 20, zIndex: 10 },
  modalScroll: { width: "100%" },
  modalScrollContent: { alignItems: "center", justifyContent: "center", flexGrow: 1 },
  zoomImage: { width: "100%", height: 500 },
  // ── Empty state ──────────────────────────────────────────────────────
  emptyIconRow: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 16 },
  emptyIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: `${colors.primary[500]}18`,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTextBlock: { flex: 1 },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: colors.text.primary, marginBottom: 4 },
  emptySubtitle: { fontSize: 12, color: colors.text.muted, lineHeight: 17 },
  // ── Tips ─────────────────────────────────────────────────────────────
  tipsBlock: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#EDE4E9",
  },
  tipsTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.text.muted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  tipRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  tipIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: `${colors.primary[500]}10`,
    alignItems: "center",
    justifyContent: "center",
  },
  tipText: { fontSize: 12, color: colors.text.secondary, flex: 1, lineHeight: 17 },
  // Coding step numbering
  codingStepNum: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  codingStepNumText: { fontSize: 12, fontWeight: "800" },
  codingStepLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 1 },
  // ── Buttons ────────────────────────────────────────────────────────
  buttonRow: { flexDirection: "row", gap: 10 },
  btnPrimary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: colors.primary[500],
    borderRadius: 12,
    paddingVertical: 13,
  },
  btnPrimaryText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  btnSecondary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E8D8E0",
    paddingVertical: 13,
  },
  btnSecondaryText: { color: colors.text.secondary, fontSize: 14, fontWeight: "600" },
  // ── Error ──────────────────────────────────────────────────────────
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 10,
    backgroundColor: "#FEE2E2",
    borderRadius: 8,
    padding: 10,
  },
  errorText: { fontSize: 12, color: colors.danger, flex: 1 },
  disabled: { opacity: 0.5 },
});
