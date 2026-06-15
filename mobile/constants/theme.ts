import type { TrackId } from "../types";

export const colors = {
  primary: {
    50: "#FFD8EC",
    100: "#FFAEDD",
    200: "#DC80B9",
    300: "#AE5A91",
    400: "#924177",
    500: "#60164B",
    600: "#430033",
    700: "#3B002D",
    800: "#2D0022",
    900: "#210019",
  },
  secondary: "#A53842",
  cranberry: "#FD7B82",
  background: {
    DEFAULT: "#FFF8F2",
    card: "#FFFFFF",
    surface: "#F4EDE5",
    elevated: "#FAF2EA",
    muted: "#E9E1D9",
  },
  text: {
    primary: "#1E1B17",
    secondary: "#51434A",
    muted: "#84727B",
    inverse: "#FFFFFF",
  },
  danger: "#BA1A1A",
  warning: "#A53842",
  success: "#6B8E6B",
  border: "#D6C1CA",
  borderSoft: "#E8D8E0",
} as const;

export const trackColors: Record<TrackId, string> = {
  ml_ai: "#60164B",
  web_dev: "#A53842",
  devops: "#C07A45",
  data_science: "#6B8E6B",
  cloud: "#7A6A9E",
  mobile_dev: "#D06D9F",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

export const shadows = {
  card: {
    shadowColor: colors.primary[500],
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 16,
    elevation: 3,
  },
  lift: {
    shadowColor: colors.primary[500],
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 28,
    elevation: 6,
  },
} as const;
