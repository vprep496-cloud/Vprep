import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as DocumentPicker from "expo-document-picker";
import Toast from "react-native-toast-message";
import { useQuery } from "@tanstack/react-query";

import AnimatedView from "../components/ui/AnimatedView";
import Button from "../components/ui/Button";
import Skeleton from "../components/ui/Skeleton";
import { colors, radius, shadows, trackColors } from "../constants/theme";
import { tapHaptic } from "../lib/haptics";
import { getTracks } from "../services/enrollment.service";
import { completeOnboarding } from "../services/user.service";
import { useAuthStore } from "../stores/auth.store";
import type { SkillLevel, Track, TrackId } from "../types";

const LEVELS: {
  id: SkillLevel;
  label: string;
  detail: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { id: "beginner", label: "Beginner", detail: "0-1 years", icon: "leaf-outline" },
  { id: "intermediate", label: "Intermediate", detail: "1-4 years", icon: "trending-up-outline" },
  { id: "advanced", label: "Advanced", detail: "4+ years", icon: "flame-outline" },
];

const PICKER_TYPES = ["application/pdf", "text/plain", "image/jpeg", "image/png", "image/webp"];

type PickedCv = {
  uri: string;
  name: string;
  mimeType: string | null;
  size?: number | null;
  file?: unknown;
};

function fileSizeLabel(size?: number | null) {
  if (!size) return null;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function trackAccent(track: Track) {
  return trackColors[track.id] ?? track.color ?? colors.primary[500];
}

export default function OnboardingScreen() {
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const currentUser = useAuthStore((s) => s.user);

  const initialLevel =
    currentUser?.selfReportedLevel ??
    currentUser?.profile?.selfReportedLevel ??
    currentUser?.normalizedLevel ??
    "beginner";
  const initialTargetRole = currentUser?.targetRole ?? currentUser?.profile?.targetRole ?? "";
  const existingCvName = currentUser?.cvFilename ?? currentUser?.profile?.cv?.filename ?? null;
  const isUpdatingProfile = currentUser?.profileComplete === true;

  const [level, setLevel] = useState<SkillLevel>(initialLevel);
  const [targetRole, setTargetRole] = useState(initialTargetRole);
  const [selectedTrackId, setSelectedTrackId] = useState<TrackId | null>(
    currentUser?.preferredTrackId ?? null
  );
  const [cv, setCv] = useState<PickedCv | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  const tracksQuery = useQuery<Track[]>({
    queryKey: ["tracks", "catalog", "onboarding"],
    queryFn: getTracks,
  });

  const selectedTrack = useMemo(
    () => tracksQuery.data?.find((track: Track) => track.id === selectedTrackId) ?? null,
    [tracksQuery.data, selectedTrackId]
  );

  const chooseLevel = (nextLevel: SkillLevel) => {
    tapHaptic();
    setLevel(nextLevel);
  };

  const chooseTrack = (trackId: TrackId) => {
    tapHaptic();
    setSelectedTrackId((current) => (current === trackId ? null : trackId));
  };

  const pickCv = async () => {
    tapHaptic();
    const result = await DocumentPicker.getDocumentAsync({
      type: PICKER_TYPES,
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0] as DocumentPicker.DocumentPickerAsset & { file?: unknown };
    setCv({
      uri: asset.uri,
      name: asset.name || "cv.pdf",
      mimeType: asset.mimeType ?? null,
      size: asset.size,
      file: asset.file,
    });
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const user = await completeOnboarding({
        selfReportedLevel: level,
        targetRole,
        preferredTrackId: selectedTrackId,
        cv,
      });
      setUser(user);
      Toast.show({
        type: "success",
        text1: isUpdatingProfile ? "Profile updated" : "Profile ready",
        text2: "Your practice path is now personalized.",
      });
      router.replace("/(app)/tracks");
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      Toast.show({
        type: "error",
        text1: "Setup failed",
        text2: typeof detail === "string" ? detail : "Please check your CV and try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.primary[500] }}>
        <View className="px-6 pb-6 pt-4">
          <View className="flex-row items-center justify-between gap-4">
            {isUpdatingProfile ? (
              <TouchableOpacity
                onPress={() => {
                  tapHaptic();
                  router.back();
                }}
                hitSlop={10}
                className="h-11 w-11 items-center justify-center rounded-full"
                style={{ backgroundColor: "rgba(255,255,255,0.12)" }}
              >
                <Ionicons name="arrow-back" size={22} color={colors.text.inverse} />
              </TouchableOpacity>
            ) : null}
            <View className="flex-1">
              <Text className="text-xs font-bold uppercase tracking-[2px] text-primary-100">
                {isUpdatingProfile ? "Personalization" : "Candidate Setup"}
              </Text>
              <Text className="mt-2 text-3xl font-bold text-text-inverse">
                {isUpdatingProfile ? "Update your profile" : "Build your level"}
              </Text>
            </View>
            <View className="h-12 w-12 items-center justify-center rounded-2xl bg-background-card">
              <Ionicons name="sparkles-outline" size={24} color={colors.primary[500]} />
            </View>
          </View>
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 22, paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <AnimatedView
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: "timing", duration: 320 }}
          >
            <Text className="text-text-primary text-2xl font-bold">Your starting point</Text>
            <Text className="text-text-secondary text-sm leading-6 mt-2">
              Pick the level that feels closest. Your CV can refine it before interviews begin.
            </Text>
          </AnimatedView>

          <View className="mt-5 gap-3">
            {LEVELS.map((item, index) => {
              const isSelected = item.id === level;
              return (
                <AnimatedView
                  key={item.id}
                  from={{ opacity: 0, translateY: 14 }}
                  animate={{ opacity: 1, translateY: 0 }}
                  transition={{ type: "timing", duration: 260, delay: index * 50 }}
                >
                  <TouchableOpacity
                    onPress={() => chooseLevel(item.id)}
                    activeOpacity={0.84}
                    className="flex-row items-center rounded-2xl border px-4 py-4"
                    style={{
                      backgroundColor: isSelected ? `${colors.primary[500]}12` : colors.background.card,
                      borderColor: isSelected ? colors.primary[500] : colors.borderSoft,
                      ...shadows.card,
                    }}
                  >
                    <View
                      className="h-11 w-11 items-center justify-center rounded-full"
                      style={{ backgroundColor: isSelected ? colors.primary[500] : colors.background.surface }}
                    >
                      <Ionicons
                        name={item.icon}
                        size={21}
                        color={isSelected ? "#FFFFFF" : colors.primary[500]}
                      />
                    </View>
                    <View className="ml-3 flex-1">
                      <Text className="text-base font-bold text-text-primary">{item.label}</Text>
                      <Text className="mt-0.5 text-xs text-text-muted">{item.detail}</Text>
                    </View>
                    <Ionicons
                      name={isSelected ? "checkmark-circle" : "ellipse-outline"}
                      size={23}
                      color={isSelected ? colors.primary[500] : colors.border}
                    />
                  </TouchableOpacity>
                </AnimatedView>
              );
            })}
          </View>

          <View className="mt-7 rounded-2xl border border-border-soft bg-background-card p-4" style={shadows.card}>
            <Text className="text-sm font-bold text-text-primary">Target role</Text>
            <View className="mt-3 flex-row items-center rounded-xl border border-border-soft bg-background-surface px-3">
              <Ionicons name="briefcase-outline" size={18} color={colors.text.muted} />
              <TextInput
                value={targetRole}
                onChangeText={setTargetRole}
                placeholder="Frontend Developer, ML Engineer..."
                placeholderTextColor={colors.text.muted}
                className="ml-2 h-12 flex-1 text-base text-text-primary"
              />
            </View>
          </View>

          <View className="mt-7">
            <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mb-3">
              Focus Track
            </Text>
            {tracksQuery.isLoading ? (
              <View className="flex-row flex-wrap gap-3">
                {[0, 1, 2, 3].map((item) => (
                  <Skeleton key={item} width="47.5%" height={74} borderRadius={radius.lg} />
                ))}
              </View>
            ) : (
              <View className="flex-row flex-wrap gap-3">
                {(tracksQuery.data ?? []).map((track: Track) => {
                  const accent = trackAccent(track);
                  const isSelected = selectedTrackId === track.id;
                  return (
                    <TouchableOpacity
                      key={track.id}
                      onPress={() => chooseTrack(track.id)}
                      activeOpacity={0.84}
                      className="rounded-2xl border p-3"
                      style={{
                        width: "47.5%",
                        minHeight: 82,
                        backgroundColor: isSelected ? `${accent}16` : colors.background.card,
                        borderColor: isSelected ? accent : colors.borderSoft,
                      }}
                    >
                      <View className="flex-row items-center justify-between">
                        <View className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: `${accent}22` }}>
                          <Ionicons name={track.icon as keyof typeof Ionicons.glyphMap} size={18} color={accent} />
                        </View>
                        {isSelected ? <Ionicons name="checkmark-circle" size={20} color={accent} /> : null}
                      </View>
                      <Text numberOfLines={1} className="mt-2 text-sm font-bold text-text-primary">
                        {track.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>

          <View className="mt-7 rounded-2xl border border-border-soft bg-background-card p-4" style={shadows.card}>
            <View className="flex-row items-start justify-between gap-4">
              <View className="flex-1">
                <Text className="text-sm font-bold text-text-primary">CV</Text>
                <Text className="mt-1 text-xs leading-5 text-text-muted">
                  PDF, TXT, JPG, PNG, or WEBP. Max 8 MB.
                </Text>
              </View>
              <TouchableOpacity
                onPress={pickCv}
                activeOpacity={0.84}
                className="h-11 w-11 items-center justify-center rounded-full bg-primary-500"
              >
                <Ionicons name="cloud-upload-outline" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            {cv ? (
              <View className="mt-4 flex-row items-center rounded-xl bg-background-surface px-3 py-3">
                <Ionicons name="document-text-outline" size={20} color={colors.primary[500]} />
                <View className="ml-3 min-w-0 flex-1">
                  <Text numberOfLines={1} className="text-sm font-semibold text-text-primary">
                    {cv.name}
                  </Text>
                  <Text className="mt-0.5 text-xs text-text-muted">
                    {[cv.mimeType, fileSizeLabel(cv.size)].filter(Boolean).join(" · ")}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setCv(null)} className="p-2">
                  <Ionicons name="close-circle" size={20} color={colors.text.muted} />
                </TouchableOpacity>
              </View>
            ) : null}
            {!cv && existingCvName ? (
              <View className="mt-4 flex-row items-center rounded-xl bg-background-surface px-3 py-3">
                <Ionicons name="document-attach-outline" size={20} color={colors.primary[500]} />
                <View className="ml-3 min-w-0 flex-1">
                  <Text numberOfLines={1} className="text-sm font-semibold text-text-primary">
                    Current CV: {existingCvName}
                  </Text>
                  <Text className="mt-0.5 text-xs text-text-muted">
                    Upload a new CV to refresh personalization.
                  </Text>
                </View>
              </View>
            ) : null}
          </View>

          {selectedTrack ? (
            <View className="mt-5 rounded-2xl px-4 py-4" style={{ backgroundColor: `${trackAccent(selectedTrack)}12` }}>
              <Text className="text-xs font-semibold uppercase tracking-wide" style={{ color: trackAccent(selectedTrack) }}>
                Selected path
              </Text>
              <Text className="mt-1 text-base font-bold text-text-primary">
                {level[0].toUpperCase() + level.slice(1)} · {selectedTrack.name}
              </Text>
            </View>
          ) : null}
        </ScrollView>

        <View className="absolute bottom-0 left-0 right-0 border-t border-border-soft bg-background px-5 pb-5 pt-3">
          <Button
            label={isUpdatingProfile ? "Save personalization" : "Continue"}
            icon="arrow-forward"
            fullWidth
            loading={isSubmitting}
            disabled={tracksQuery.isLoading}
            onPress={handleSubmit}
          />
          {isSubmitting ? (
            <View className="mt-3 flex-row items-center justify-center gap-2">
              <ActivityIndicator size="small" color={colors.primary[500]} />
              <Text className="text-xs font-semibold text-text-muted">Reading profile signals</Text>
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
