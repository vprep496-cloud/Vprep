import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import type { RoleSeniority, TargetRole } from "../../types";
import { colors, shadows } from "../../constants/theme";
import { tapHaptic } from "../../lib/haptics";

const CUSTOM = "__custom__";

const SENIORITY_STYLE: Record<RoleSeniority, { bg: string; fg: string }> = {
  junior: { bg: `${colors.success}1F`, fg: colors.success },
  mid: { bg: `${colors.primary[500]}1F`, fg: colors.primary[500] },
  senior: { bg: `${colors.warning}1F`, fg: colors.warning },
};

export interface RoleSelectionResult {
  targetRoleId?: string;
  targetRole?: string;
}

interface RolePickerModalProps {
  visible: boolean;
  trackName: string;
  roles: TargetRole[];
  loading: boolean;
  saving: boolean;
  currentRoleId: string | null;
  currentLabel: string | null;
  onClose: () => void;
  onSubmit: (selection: RoleSelectionResult) => void;
}

export default function RolePickerModal({
  visible,
  trackName,
  roles,
  loading,
  saving,
  currentRoleId,
  currentLabel,
  onClose,
  onSubmit,
}: RolePickerModalProps) {
  // Whether the current role is a custom (non-catalog) label.
  const currentIsCustom = useMemo(
    () => !currentRoleId && !!currentLabel && !roles.some((role) => role.label === currentLabel),
    [currentRoleId, currentLabel, roles]
  );

  const [selectedId, setSelectedId] = useState<string>(currentRoleId ?? (currentIsCustom ? CUSTOM : ""));
  const [customText, setCustomText] = useState<string>(currentIsCustom ? currentLabel ?? "" : "");

  // Re-seed selection whenever the sheet (re)opens or roles arrive.
  useEffect(() => {
    if (!visible) return;
    setSelectedId(currentRoleId ?? (currentIsCustom ? CUSTOM : ""));
    setCustomText(currentIsCustom ? currentLabel ?? "" : "");
  }, [visible, currentRoleId, currentIsCustom, currentLabel]);

  const canSave =
    selectedId === CUSTOM ? customText.trim().length >= 2 : selectedId.length > 0 && !saving;

  const handleSave = () => {
    if (!canSave || saving) return;
    if (selectedId === CUSTOM) {
      onSubmit({ targetRole: customText.trim() });
    } else {
      onSubmit({ targetRoleId: selectedId });
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 justify-end bg-black/50"
      >
        <View
          className="max-h-[88%] rounded-t-3xl bg-background-card pb-2 pt-2"
          style={shadows.lift}
        >
          <View className="items-center pt-1">
            <View className="h-1.5 w-10 rounded-full bg-border" />
          </View>

          <View className="flex-row items-start justify-between px-5 pb-3 pt-3">
            <View className="flex-1 pr-3">
              <Text className="text-xl font-bold text-text-primary">Target role</Text>
              <Text className="mt-0.5 text-sm text-text-muted">
                What are you preparing for on {trackName}? Questions and difficulty adapt to your choice.
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={8} className="p-1">
              <Ionicons name="close" size={22} color={colors.text.muted} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View className="items-center py-12">
              <ActivityIndicator size="large" color={colors.primary[500]} />
            </View>
          ) : (
            <ScrollView
              className="px-5"
              contentContainerStyle={{ paddingBottom: 8 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {roles.map((role) => {
                const active = selectedId === role.id;
                const tone = SENIORITY_STYLE[role.seniority] ?? SENIORITY_STYLE.mid;
                return (
                  <TouchableOpacity
                    key={role.id}
                    activeOpacity={0.85}
                    onPress={() => {
                      tapHaptic();
                      setSelectedId(role.id);
                    }}
                    className="mb-2.5 flex-row items-center rounded-2xl border px-4 py-3.5"
                    style={{
                      borderColor: active ? colors.primary[500] : colors.borderSoft,
                      backgroundColor: active ? `${colors.primary[500]}0F` : colors.background.surface,
                    }}
                  >
                    <View className="flex-1 pr-3">
                      <View className="flex-row items-center gap-2">
                        <Text className="text-base font-bold text-text-primary">{role.label}</Text>
                        <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: tone.bg }}>
                          <Text className="text-[10px] font-bold uppercase tracking-wide" style={{ color: tone.fg }}>
                            {role.seniorityLabel}
                          </Text>
                        </View>
                      </View>
                      {role.focus.length > 0 ? (
                        <Text numberOfLines={1} className="mt-1 text-xs text-text-muted">
                          {role.focus.slice(0, 4).join(" · ")}
                        </Text>
                      ) : null}
                    </View>
                    <Ionicons
                      name={active ? "checkmark-circle" : "ellipse-outline"}
                      size={22}
                      color={active ? colors.primary[500] : colors.border}
                    />
                  </TouchableOpacity>
                );
              })}

              {/* Custom role option */}
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => {
                  tapHaptic();
                  setSelectedId(CUSTOM);
                }}
                className="mb-2 flex-row items-center rounded-2xl border px-4 py-3.5"
                style={{
                  borderColor: selectedId === CUSTOM ? colors.primary[500] : colors.borderSoft,
                  backgroundColor: selectedId === CUSTOM ? `${colors.primary[500]}0F` : colors.background.surface,
                }}
              >
                <View className="flex-1 pr-3">
                  <Text className="text-base font-bold text-text-primary">Custom role</Text>
                  <Text className="mt-1 text-xs text-text-muted">Type a specific role not listed above.</Text>
                </View>
                <Ionicons
                  name={selectedId === CUSTOM ? "checkmark-circle" : "ellipse-outline"}
                  size={22}
                  color={selectedId === CUSTOM ? colors.primary[500] : colors.border}
                />
              </TouchableOpacity>

              {selectedId === CUSTOM ? (
                <View className="mb-2 flex-row items-center rounded-xl border border-border-soft bg-background-surface px-3">
                  <Ionicons name="briefcase-outline" size={18} color={colors.text.muted} />
                  <TextInput
                    value={customText}
                    onChangeText={setCustomText}
                    placeholder="e.g. Prompt Engineer, Data Engineer"
                    placeholderTextColor={colors.text.muted}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={handleSave}
                    className="ml-2 h-12 flex-1 text-base text-text-primary"
                  />
                </View>
              ) : null}
            </ScrollView>
          )}

          <View className="flex-row gap-3 border-t border-border-soft px-5 pb-5 pt-3">
            <TouchableOpacity
              onPress={onClose}
              disabled={saving}
              className="flex-1 items-center rounded-xl border border-border-soft py-3"
            >
              <Text className="text-sm font-semibold text-text-secondary">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSave}
              disabled={!canSave || saving}
              className="flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-primary-500 py-3"
              style={!canSave || saving ? { opacity: 0.6 } : undefined}
            >
              {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
              <Text className="text-sm font-bold text-white">Save role</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
