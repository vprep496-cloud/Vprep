import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { colors, shadows } from "../../constants/theme";
import { tapHaptic } from "../../lib/haptics";
import VPrepLogo from "./VPrepLogo";

interface BrandedHeaderProps {
  title?: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  /** Icon shown on the right action button. Defaults to `person-circle-outline`. */
  rightIcon?: keyof typeof Ionicons.glyphMap;
  onRightPress?: () => void;
  /** Show a small dot badge on the right icon (e.g. unread notifications). */
  rightBadge?: boolean;
  /** Second icon shown to the left of the primary right icon. */
  rightIcon2?: keyof typeof Ionicons.glyphMap;
  onRightPress2?: () => void;
}

export default function BrandedHeader({
  title = "V-PREP",
  subtitle,
  showBack = false,
  onBack,
  rightIcon = "person-circle-outline",
  onRightPress,
  rightBadge = false,
  rightIcon2,
  onRightPress2,
}: BrandedHeaderProps) {
  const router = useRouter();

  const handleBack = () => {
    tapHaptic();
    if (onBack) { onBack(); return; }
    router.back();
  };

  const handleRightPress = () => {
    tapHaptic();
    if (onRightPress) { onRightPress(); return; }
    router.push("/(app)/profile");
  };

  const handleRightPress2 = () => {
    tapHaptic();
    onRightPress2?.();
  };

  return (
    <SafeAreaView edges={["top"]} style={[hStyles.safeArea, shadows.card]}>
      <View style={hStyles.bar}>
        {/* Left — back or logo */}
        <View style={hStyles.leftSection}>
          {showBack ? (
            <TouchableOpacity onPress={handleBack} hitSlop={10} style={hStyles.iconBtn}>
              <Ionicons name="arrow-back" size={22} color={colors.text.inverse} />
            </TouchableOpacity>
          ) : (
            <VPrepLogo size={40} />
          )}

          <View style={hStyles.titleBlock}>
            <Text style={hStyles.title} numberOfLines={1}>{title}</Text>
            {subtitle ? (
              <Text style={hStyles.subtitle} numberOfLines={1}>{subtitle}</Text>
            ) : null}
          </View>
        </View>

        {/* Right actions */}
        <View style={hStyles.rightSection}>
          {rightIcon2 && onRightPress2 ? (
            <TouchableOpacity onPress={handleRightPress2} hitSlop={10} style={hStyles.iconBtn}>
              <Ionicons name={rightIcon2} size={22} color={colors.primary[100]} />
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity onPress={handleRightPress} hitSlop={10} style={hStyles.iconBtn}>
            <Ionicons name={rightIcon} size={23} color={colors.primary[100]} />
            {rightBadge ? <View style={hStyles.badge} /> : null}
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const hStyles = StyleSheet.create({
  safeArea: { backgroundColor: colors.primary[500] },
  bar: {
    height: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  leftSection: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  rightSection: { flexDirection: "row", alignItems: "center", gap: 4 },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  titleBlock: { flex: 1 },
  title: { fontSize: 19, fontWeight: "800", color: colors.text.inverse },
  subtitle: { fontSize: 11, fontWeight: "500", color: colors.primary[100], marginTop: 1 },
  badge: {
    position: "absolute",
    top: 7,
    right: 7,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.cranberry,
    borderWidth: 1.5,
    borderColor: colors.primary[500],
  },
});
