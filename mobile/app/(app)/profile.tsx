import { useMemo, useState, type ReactNode } from "react";
import { Alert, Image, Platform, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import Toast from "react-native-toast-message";
import { getAuth, sendPasswordResetEmail } from "firebase/auth";

import AnimatedView from "../../components/ui/AnimatedView";
import BrandedHeader from "../../components/ui/BrandedHeader";
import Button from "../../components/ui/Button";
import Badge, { type BadgeVariant } from "../../components/ui/Badge";
import { useAuthStore } from "../../stores/auth.store";
import { useAppStore } from "../../stores/app.store";
import { useAuth } from "../../hooks/useAuth";
import type { SkillLevel, UserRole } from "../../types";
import { colors, shadows, trackColors } from "../../constants/theme";
import { tapHaptic } from "../../lib/haptics";
import { ADMIN_PORTAL_URL } from "../../config/runtime";

const PRIVACY_POLICY_URL = "https://vprep.app/privacy";
const TERMS_URL = "https://vprep.app/terms";

const roleBadgeVariant: Record<UserRole, BadgeVariant> = {
  candidate: "success",
  admin: "warning",
  superadmin: "danger",
};

const roleLabel: Record<UserRole, string> = {
  candidate: "Candidate",
  admin: "Admin",
  superadmin: "Superadmin",
};

const skillLabel: Record<SkillLevel, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

function StatTile({
  icon,
  value,
  label,
  tone,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
  tone: string;
}) {
  return (
    <View
      className="flex-1 items-center rounded-2xl border border-border-soft bg-background-card px-2 py-4"
      style={shadows.card}
    >
      <View className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: `${tone}1F` }}>
        <Ionicons name={icon} size={18} color={tone} />
      </View>
      <Text className="mt-2 text-2xl font-bold" style={{ color: tone }}>
        {value}
      </Text>
      <Text className="mt-0.5 text-center text-[10px] font-bold uppercase tracking-wide text-text-secondary">
        {label}
      </Text>
    </View>
  );
}

function SettingsRow({
  icon,
  label,
  detail,
  danger = false,
  external = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  detail?: string;
  danger?: boolean;
  external?: boolean;
  onPress?: () => void;
}) {
  const isPressable = Boolean(onPress);

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!isPressable}
      activeOpacity={isPressable ? 0.82 : 1}
      className="flex-row items-center justify-between border-b border-border-soft px-4 py-4 last:border-b-0"
    >
      <View className="min-w-0 flex-1 flex-row items-center gap-3 pr-3">
        <View
          className="h-10 w-10 items-center justify-center rounded-xl"
          style={{ backgroundColor: danger ? "#FFDAD6" : colors.background.surface }}
        >
          <Ionicons name={icon} size={19} color={danger ? colors.danger : colors.text.secondary} />
        </View>
        <View className="min-w-0 flex-1">
          <Text
            numberOfLines={1}
            className={`text-base ${danger ? "font-bold text-danger" : "text-text-primary"}`}
          >
            {label}
          </Text>
          {detail ? (
            <Text numberOfLines={1} className="mt-0.5 text-xs text-text-muted">
              {detail}
            </Text>
          ) : null}
        </View>
      </View>
      {isPressable ? (
        <Ionicons
          name={external ? "open-outline" : danger ? "close" : "chevron-forward"}
          size={19}
          color={danger ? colors.danger : colors.text.muted}
        />
      ) : null}
    </TouchableOpacity>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <View className="rounded-full border border-border-soft bg-background-surface px-3 py-1.5">
      <Text className="text-xs font-semibold text-text-secondary">{label}</Text>
    </View>
  );
}

function ProfileSubsection({
  icon,
  title,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  children: ReactNode;
}) {
  return (
    <View className="border-b border-border-soft px-4 py-4 last:border-b-0">
      <View className="mb-2.5 flex-row items-center gap-2">
        <Ionicons name={icon} size={15} color={colors.primary[500]} />
        <Text className="text-xs font-bold uppercase tracking-wide text-text-secondary">{title}</Text>
      </View>
      {children}
    </View>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <View className="gap-1.5">
      {items.map((item, index) => (
        <View key={`${index}-${item.slice(0, 12)}`} className="flex-row gap-2">
          <Text className="text-text-muted text-sm leading-6">•</Text>
          <Text className="flex-1 text-sm leading-6 text-text-secondary">{item}</Text>
        </View>
      ))}
    </View>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const enrollments = useAppStore((s) => s.enrollments);
  const { signOut } = useAuth();
  const [, setIsSigningOut] = useState(false);

  const averageProgress = useMemo(() => {
    if (enrollments.length === 0) return 0;
    const total = enrollments.reduce(
      (sum, enrollment) => sum + enrollment.currentDay / enrollment.track.totalDays,
      0
    );
    return Math.round((total / enrollments.length) * 100);
  }, [enrollments]);

  if (!user) return null;

  const initial = user.displayName.trim().charAt(0).toUpperCase() || "?";
  const isAdminUser = user.role === "admin" || user.role === "superadmin";
  const profile = user.profile ?? null;
  const profileLevel = user.normalizedLevel ?? profile?.normalizedLevel ?? null;
  const profileRole = user.targetRole ?? profile?.targetRole ?? null;
  const profileCvName = user.cvFilename ?? profile?.cv?.filename ?? null;
  const cvExtracted = profile?.cv?.extracted ?? false;
  const profileSummary = profile?.summary ?? user.cvSummary ?? null;
  const yearsExperience = profile?.yearsExperience ?? user.yearsExperience ?? null;
  const skills = profile?.skills ?? [];
  const projects = profile?.projects ?? [];
  const education = profile?.education ?? [];
  const hasRichProfile =
    cvExtracted || skills.length > 0 || projects.length > 0 || education.length > 0 || !!profileSummary;
  const experienceLabel =
    yearsExperience != null
      ? `${yearsExperience % 1 === 0 ? yearsExperience : yearsExperience.toFixed(1)} yr${yearsExperience === 1 ? "" : "s"}`
      : "—";
  const personalizationDetail = [
    profileLevel ? skillLabel[profileLevel] : "Level not set",
    profileRole || "Target role not set",
  ].join(" · ");

  const doSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
    } catch {
      // signOut clears local session even if Firebase/network calls fail
    } finally {
      setIsSigningOut(false);
    }
    // Belt-and-suspenders: drive navigation explicitly after auth state is
    // cleared.  The AuthGuard routing useEffect also fires, but on Expo Web
    // (New Architecture + React 18 batching) the effect can be deferred long
    // enough for the screen to appear frozen.  Calling replace() here makes
    // sign-out instant on every platform.
    router.replace("/(auth)/login");
  };

  const confirmSignOut = () => {
    if (Platform.OS === "web") {
      // On Expo Web, Alert.alert with button callbacks is unreliable (it
      // delegates to window.confirm which can swallow async callbacks in the
      // New Architecture).  Use window.confirm directly so we control the flow.
      if (typeof window !== "undefined" && window.confirm("Sign out of V-Prep?")) {
        doSignOut();
      }
      return;
    }

    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: doSignOut },
    ]);
  };

  const openAdminPortal = () => {
    tapHaptic();
    if (ADMIN_PORTAL_URL) {
      WebBrowser.openBrowserAsync(ADMIN_PORTAL_URL);
    }
  };

  const openPersonalization = () => {
    tapHaptic();
    router.push("/onboarding");
  };

  const handleChangePassword = () => {
    tapHaptic();
    if (!user?.email) return;
    Alert.alert(
      "Reset Password",
      `We'll send a password-reset link to ${user.email}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send Link",
          onPress: async () => {
            try {
              await sendPasswordResetEmail(getAuth(), user.email);
              Toast.show({
                type: "success",
                text1: "Reset email sent",
                text2: `Check your inbox at ${user.email}`,
              });
            } catch {
              Toast.show({
                type: "error",
                text1: "Couldn't send reset email",
                text2: "Please try again or contact support.",
              });
            }
          },
        },
      ]
    );
  };

  const openPrivacyPolicy = () => {
    tapHaptic();
    WebBrowser.openBrowserAsync(PRIVACY_POLICY_URL);
  };

  const openTerms = () => {
    tapHaptic();
    WebBrowser.openBrowserAsync(TERMS_URL);
  };

  const openNotifications = () => {
    tapHaptic();
    router.push("/(app)/notifications");
  };

  return (
    <View className="flex-1 bg-background">
      <BrandedHeader
        title="Profile"
        subtitle="Account and readiness"
        rightIcon="notifications-outline"
        onRightPress={() => router.push("/(app)/notifications")}
      />
      <SafeAreaView className="flex-1" edges={["bottom", "left", "right"]}>
        <ScrollView
          className="flex-1 px-4"
          contentContainerStyle={{ paddingTop: 24, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
        >
          <AnimatedView
            from={{ opacity: 0, translateY: -12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: "timing", duration: 360 }}
            className="overflow-hidden rounded-3xl"
            style={shadows.lift}
          >
            <LinearGradient
              colors={[colors.primary[600], colors.primary[500], colors.secondary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ paddingHorizontal: 24, paddingVertical: 28, alignItems: "center" }}
            >
              <View>
                {user.photoUrl ? (
                  <Image
                    source={{ uri: user.photoUrl }}
                    className="h-28 w-28 rounded-full border-4"
                    style={{ borderColor: "rgba(255,255,255,0.35)" }}
                    accessibilityLabel={`${user.displayName}'s profile photo`}
                  />
                ) : (
                  <View
                    className="h-28 w-28 items-center justify-center rounded-full border-4 bg-white/15"
                    style={{ borderColor: "rgba(255,255,255,0.35)" }}
                  >
                    <Text className="text-4xl font-bold text-white">{initial}</Text>
                  </View>
                )}
                <TouchableOpacity
                  onPress={openPersonalization}
                  hitSlop={8}
                  className="absolute -bottom-1 -right-1 h-11 w-11 items-center justify-center rounded-full bg-cranberry"
                  style={shadows.card}
                >
                  <Ionicons name="pencil" size={17} color={colors.primary[700]} />
                </TouchableOpacity>
              </View>
              <Text className="mt-5 text-2xl font-bold text-white">{user.displayName}</Text>
              <Text className="mt-1 text-sm text-primary-100">{user.email}</Text>
              <View className="mt-3 flex-row items-center gap-2">
                <Badge label={roleLabel[user.role]} variant={roleBadgeVariant[user.role]} />
                {profileLevel ? (
                  <View className="rounded-full bg-white/20 px-3 py-1">
                    <Text className="text-xs font-bold text-white">{skillLabel[profileLevel]}</Text>
                  </View>
                ) : null}
              </View>
            </LinearGradient>
          </AnimatedView>

          <AnimatedView
            from={{ opacity: 0, translateY: 14 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: "timing", duration: 320, delay: 80 }}
            className="mt-5 flex-row gap-3"
          >
            <StatTile
              icon="map-outline"
              value={`${enrollments.length}`}
              label="Tracks"
              tone={colors.primary[500]}
            />
            <StatTile
              icon="analytics-outline"
              value={`${averageProgress}%`}
              label="Avg Progress"
              tone={colors.secondary}
            />
            <StatTile
              icon="trophy-outline"
              value={averageProgress >= 80 ? "High" : averageProgress >= 40 ? "Mid" : "New"}
              label="Readiness"
              tone={colors.success}
            />
          </AnimatedView>

          <AnimatedView
            from={{ opacity: 0, translateY: 16 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: "timing", duration: 320, delay: 160 }}
            className="mt-6 overflow-hidden rounded-2xl border border-border-soft bg-background-card"
            style={shadows.card}
          >
            <View className="flex-row items-center justify-between border-b border-border-soft px-4 py-4">
              <Text className="text-xl font-bold text-primary-700">Interview Profile</Text>
              <TouchableOpacity
                onPress={openPersonalization}
                hitSlop={8}
                className="flex-row items-center gap-1 rounded-full bg-primary-500/10 px-3 py-1.5"
              >
                <Ionicons name="create-outline" size={15} color={colors.primary[500]} />
                <Text className="text-xs font-bold text-primary-600">Edit</Text>
              </TouchableOpacity>
            </View>

            {hasRichProfile ? (
              <>
                {profileSummary ? (
                  <ProfileSubsection icon="person-outline" title="Summary">
                    <Text className="text-sm leading-6 text-text-secondary">{profileSummary}</Text>
                  </ProfileSubsection>
                ) : null}

                {/* Level + experience only — the target role is per-track and
                    lives in the "Tracks & Roles" card below, since each track
                    is prepared for a different role. */}
                <View className="flex-row border-b border-border-soft">
                  <View className="flex-1 border-r border-border-soft px-4 py-4">
                    <Text className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Level</Text>
                    <Text className="mt-1 text-sm font-bold text-text-primary">
                      {profileLevel ? skillLabel[profileLevel] : "—"}
                    </Text>
                  </View>
                  <View className="flex-1 px-4 py-4">
                    <Text className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Experience</Text>
                    <Text className="mt-1 text-sm font-bold text-text-primary">{experienceLabel}</Text>
                  </View>
                </View>

                {skills.length > 0 ? (
                  <ProfileSubsection icon="construct-outline" title="Skills">
                    <View className="flex-row flex-wrap gap-2">
                      {skills.map((skill, index) => (
                        <Chip key={`${index}-${skill}`} label={skill} />
                      ))}
                    </View>
                  </ProfileSubsection>
                ) : null}

                {projects.length > 0 ? (
                  <ProfileSubsection icon="cube-outline" title="Projects">
                    <BulletList items={projects} />
                  </ProfileSubsection>
                ) : null}

                {education.length > 0 ? (
                  <ProfileSubsection icon="school-outline" title="Education">
                    <BulletList items={education} />
                  </ProfileSubsection>
                ) : null}

                <SettingsRow
                  icon="document-text-outline"
                  label={profileCvName ? profileCvName : "CV on file"}
                  detail={cvExtracted ? "Auto-filled from your CV · tap to refresh" : "Tap to upload a CV"}
                  onPress={openPersonalization}
                />
              </>
            ) : (
              <>
                {/* No CV processed yet — prompt the candidate to upload one so
                    the platform can auto-fill this profile and personalize
                    questions per track. */}
                <View className="items-center px-5 py-7">
                  <View className="h-14 w-14 items-center justify-center rounded-full bg-primary-500/12">
                    <Ionicons name="document-attach-outline" size={26} color={colors.primary[500]} />
                  </View>
                  <Text className="mt-3 text-base font-bold text-text-primary">Build your profile from your CV</Text>
                  <Text className="mt-1 text-center text-sm leading-6 text-text-muted">
                    Upload your CV and we&apos;ll extract your experience, skills, and projects to
                    auto-fill this profile and tailor interview questions to you.
                  </Text>
                  <View className="mt-4 w-full">
                    <Button label="Upload CV" icon="cloud-upload-outline" onPress={openPersonalization} fullWidth />
                  </View>
                </View>
                <SettingsRow
                  icon="sparkles-outline"
                  label="Personalization"
                  detail={personalizationDetail}
                  onPress={openPersonalization}
                />
              </>
            )}
          </AnimatedView>

          {enrollments.length > 0 ? (
            <AnimatedView
              from={{ opacity: 0, translateY: 16 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: "timing", duration: 320, delay: 220 }}
              className="mt-6 overflow-hidden rounded-2xl border border-border-soft bg-background-card"
              style={shadows.card}
            >
              <View className="border-b border-border-soft px-4 py-4">
                <Text className="text-xl font-bold text-primary-700">Tracks &amp; Roles</Text>
                <Text className="mt-0.5 text-xs text-text-muted">
                  Each track targets its own role — tap to refine it.
                </Text>
              </View>
              {enrollments.map((enrollment) => {
                const accent = trackColors[enrollment.trackId] ?? colors.primary[500];
                return (
                  <TouchableOpacity
                    key={enrollment.trackId}
                    activeOpacity={0.82}
                    onPress={() => {
                      tapHaptic();
                      router.push(`/(app)/plan/${enrollment.trackId}`);
                    }}
                    className="flex-row items-center justify-between border-b border-border-soft px-4 py-3.5 last:border-b-0"
                  >
                    <View className="min-w-0 flex-1 flex-row items-center gap-3 pr-3">
                      <View
                        className="h-10 w-10 items-center justify-center rounded-xl"
                        style={{ backgroundColor: `${accent}1F` }}
                      >
                        <Ionicons
                          name={(enrollment.track.icon as keyof typeof Ionicons.glyphMap) ?? "layers-outline"}
                          size={18}
                          color={accent}
                        />
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text numberOfLines={1} className="text-base font-semibold text-text-primary">
                          {enrollment.track.name}
                        </Text>
                        <Text numberOfLines={1} className="mt-0.5 text-xs text-text-muted">
                          {enrollment.targetRole || "Set a target role"}
                        </Text>
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.text.muted} />
                  </TouchableOpacity>
                );
              })}
            </AnimatedView>
          ) : null}

          <AnimatedView
            from={{ opacity: 0, translateY: 16 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: "timing", duration: 320, delay: 280 }}
            className="mt-6 overflow-hidden rounded-2xl border border-border-soft bg-background-card"
            style={shadows.card}
          >
            <View className="border-b border-border-soft px-4 py-4">
              <Text className="text-xl font-bold text-primary-700">Account Settings</Text>
            </View>
            <SettingsRow
              icon="notifications-outline"
              label="Notifications"
              detail="Daily reminders, results, achievements"
              onPress={openNotifications}
            />
            <SettingsRow
              icon="lock-closed-outline"
              label="Change Password"
              detail="Send a reset link to your email"
              onPress={handleChangePassword}
            />
            <SettingsRow
              icon="language-outline"
              label="Language"
              detail="English (US)"
              onPress={() => {
                tapHaptic();
                Toast.show({ type: "info", text1: "Coming soon", text2: "Multiple language support is in development." });
              }}
            />
            <SettingsRow
              icon="shield-checkmark-outline"
              label="Privacy Policy"
              external
              onPress={openPrivacyPolicy}
            />
            <SettingsRow
              icon="document-text-outline"
              label="Terms of Service"
              external
              onPress={openTerms}
            />
            {isAdminUser ? (
              <SettingsRow icon="desktop-outline" label="Open Admin Portal" external onPress={openAdminPortal} />
            ) : null}
            <SettingsRow icon="log-out-outline" label="Sign Out" danger onPress={confirmSignOut} />
          </AnimatedView>

          <AnimatedView
            from={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "timing", duration: 340, delay: 340 }}
            className="mt-7 overflow-hidden rounded-2xl"
            style={shadows.lift}
          >
            <LinearGradient
              colors={[colors.primary[600], colors.secondary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ padding: 24 }}
            >
              <Text className="text-center text-2xl font-bold text-cranberry">Ready to go Pro?</Text>
              <Text className="mt-3 text-center text-base leading-6 text-primary-100">
                Unlock unlimited AI-simulated interviews and deeper coaching analytics.
              </Text>
              <View className="mt-5">
                <Button label="Browse Tracks" onPress={() => router.push("/(app)/tracks")} fullWidth />
              </View>
            </LinearGradient>
          </AnimatedView>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
