import React, { useState } from "react";
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AntDesign from "@expo/vector-icons/AntDesign";
import Ionicons from "@expo/vector-icons/Ionicons";

import { useAuth } from "../../hooks/useAuth";
import { colors, shadows } from "../../constants/theme";
import { tapHaptic } from "../../lib/haptics";
import VPrepLogo from "../../components/ui/VPrepLogo";

const DEMO_ACCOUNTS = [
  { key: "candidate1", label: "Ahmad Raza", initials: "AR", tone: colors.primary[500], description: "ML/AI candidate" },
  { key: "candidate2", label: "Fatima Malik", initials: "FM", tone: colors.cranberry, description: "Web Dev candidate" },
  { key: "admin", label: "Admin", initials: "AD", tone: colors.secondary, description: "Operations portal" },
  { key: "superadmin", label: "Superadmin", initials: "SA", tone: colors.success, description: "Full system access" },
] as const;

type DemoKey = (typeof DEMO_ACCOUNTS)[number]["key"];

export default function LoginScreen() {
  const { signInWithGoogle, signInWithDemo, isGoogleSignInAvailable, isSigningIn, error } = useAuth();
  const [demoLoading, setDemoLoading] = useState<DemoKey | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);

  const handleGooglePress = () => {
    tapHaptic();
    signInWithGoogle();
  };

  const handleDemoPress = async (key: DemoKey) => {
    setDemoError(null);
    setDemoLoading(key);
    try {
      tapHaptic();
      await signInWithDemo(key);
    } catch {
      setDemoError("Login failed. Check that the backend is running on port 8000.");
    } finally {
      setDemoLoading(null);
    }
  };

  const isBusy = isSigningIn || demoLoading !== null;
  const displayError = demoError ?? error;

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.primary[500] }}>
        <View className="h-[92px] flex-row items-center px-7">
          <VPrepLogo size={52} />
          <Text className="ml-4 text-3xl font-bold text-text-inverse">V-Prep</Text>
        </View>
      </SafeAreaView>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingVertical: 28 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View
          className="rounded-[32px] border border-border-soft bg-background-card px-6 py-8"
          style={shadows.lift}
        >
          <View className="items-center">
            <VPrepLogo size={88} />
            <Text className="mt-6 text-center text-4xl font-bold text-text-primary">Welcome Back</Text>
            <Text className="mt-3 text-center text-lg leading-7 text-text-secondary">
              Prepare with precision. Lead with confidence.
            </Text>
          </View>

          {displayError ? (
            <View className="mt-6 rounded-2xl border border-danger bg-[#FFEEEE] px-4 py-3">
              <Text className="text-center text-sm font-semibold text-danger">{displayError}</Text>
            </View>
          ) : null}

          {isGoogleSignInAvailable ? (
            <>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Continue with Google"
                disabled={isBusy}
                onPress={handleGooglePress}
                activeOpacity={0.86}
                className="mt-8 h-16 flex-row items-center justify-center rounded-full bg-primary-500"
                style={[shadows.card, isBusy ? { opacity: 0.72 } : undefined]}
              >
                {isSigningIn && demoLoading === null ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <AntDesign name="google" size={20} color="#FFFFFF" />
                    <Text className="ml-3 text-base font-bold text-text-inverse">Continue with Google</Text>
                    <Ionicons name="arrow-forward" size={22} color="#FFFFFF" style={{ marginLeft: 12 }} />
                  </>
                )}
              </TouchableOpacity>

              <View className="my-7 flex-row items-center gap-3">
                <View className="h-px flex-1 bg-border-soft" />
                <Text className="text-xs font-bold uppercase tracking-[3px] text-text-muted">Or use demo</Text>
                <View className="h-px flex-1 bg-border-soft" />
              </View>
            </>
          ) : (
            <View className="mt-8" />
          )}

          <View className="flex-row flex-wrap gap-3">
            {DEMO_ACCOUNTS.map((account) => {
              const loading = demoLoading === account.key;
              return (
                <TouchableOpacity
                  key={account.key}
                  onPress={() => handleDemoPress(account.key)}
                  disabled={isBusy}
                  activeOpacity={0.8}
                  className="rounded-2xl border border-border-soft bg-background-card p-3"
                  style={{
                    width: "47.5%",
                    opacity: isBusy && !loading ? 0.45 : 1,
                  }}
                >
                  <View className="flex-row items-center gap-3">
                    <View
                      className="h-11 w-11 items-center justify-center rounded-full"
                      style={{ backgroundColor: account.tone }}
                    >
                      {loading ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <Text className="text-xs font-bold text-text-inverse">{account.initials}</Text>
                      )}
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text numberOfLines={1} className="text-sm font-bold text-text-primary">
                        {account.label}
                      </Text>
                      <Text numberOfLines={1} className="mt-0.5 text-xs text-text-muted">
                        {account.description}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <Text className="mt-8 text-center text-xs leading-5 text-text-muted">
          By continuing you agree to V-Prep's Privacy Policy and Terms of Service.
        </Text>
      </ScrollView>
    </View>
  );
}
