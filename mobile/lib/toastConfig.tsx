import { BaseToast, ErrorToast } from "react-native-toast-message";
import type { ToastConfig } from "react-native-toast-message";
import { colors, radius } from "../constants/theme";

// Re-skin the toast variants we use so success/error messages sit naturally
// inside the Stitch light theme.
const sharedTextStyles = {
  text1Style: { fontSize: 14, fontWeight: "600" as const, color: colors.text.primary },
  text2Style: { fontSize: 12, fontWeight: "400" as const, color: colors.text.secondary },
};

const sharedContainerStyle = {
  backgroundColor: colors.background.card,
  borderRadius: radius.md,
  height: "auto" as const,
  paddingVertical: 12,
};

export const toastConfig: ToastConfig = {
  success: (props) => (
    <BaseToast
      {...props}
      style={{ ...sharedContainerStyle, borderLeftColor: colors.success, borderLeftWidth: 4 }}
      contentContainerStyle={{ paddingHorizontal: 14 }}
      {...sharedTextStyles}
    />
  ),
  error: (props) => (
    <ErrorToast
      {...props}
      style={{ ...sharedContainerStyle, borderLeftColor: colors.danger, borderLeftWidth: 4 }}
      contentContainerStyle={{ paddingHorizontal: 14 }}
      {...sharedTextStyles}
    />
  ),
};
