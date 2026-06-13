/**
 * V-Prep brand logo — renders the exact logo PNG from the design files.
 *
 * Props:
 *   size      — target size in px (applied to both width and height; default 36)
 *   className — extra Tailwind/CSS classes for positioning or margin
 */
import Image from "next/image";

export default function VPrepLogo({
  size = 36,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Image
      src="/vprep-logo.png"
      width={size}
      height={size}
      alt="V-Prep"
      className={className}
      style={{ objectFit: "contain", display: "block" }}
      priority
    />
  );
}
