/**
 * V-Prep brand logo — renders the exact logo PNG from the design files.
 *
 * Props:
 *   size  — width and height in dp (the image is rendered contain-fit; default 40)
 *   style — optional additional ImageStyle overrides
 */
import { Image, type ImageStyle, type StyleProp } from "react-native";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const logoSource = require("../../assets/images/vprep-logo.png") as number;

export default function VPrepLogo({
  size = 40,
  style,
}: {
  size?: number;
  style?: StyleProp<ImageStyle>;
}) {
  return (
    <Image
      source={logoSource}
      style={[{ width: size, height: size }, style]}
      resizeMode="contain"
      accessibilityLabel="V-Prep logo"
      accessibilityRole="image"
    />
  );
}
