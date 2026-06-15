/**
 * CodingQuestionCard — professional display for coding_logic phase questions.
 *
 * Parsing strategy: split the AI-generated text by blank lines and leading
 * markers to produce labelled blocks (code, list, prose). Each block renders
 * with its own visual style. We deliberately avoid `gap` (React Native web
 * compatibility) and `overflow:"hidden"` on the outer card (which can cause
 * height-measurement bugs). All spacing is via explicit marginBottom.
 */
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, shadows } from "../../constants/theme";

// ─── Design tokens ────────────────────────────────────────────────────────────
const CODE_BG        = "#1A1625";
const CODE_TEXT      = "#E2CFFF";
const ACCENT         = "#7A6A9E";          // indigo – coding phase
const ACCENT_LIGHT   = "rgba(122,106,158,0.09)";
const ACCENT_BORDER  = "rgba(122,106,158,0.22)";
const INLINE_BG      = "rgba(96,22,75,0.08)";
const INLINE_COL     = colors.primary[500];

// ─── Parsed block types ───────────────────────────────────────────────────────
type Block =
  | { kind: "heading"; text: string }
  | { kind: "code_block"; lines: string[] }
  | { kind: "prose"; text: string }
  | { kind: "bullet"; items: string[] }
  | { kind: "numbered"; items: string[] };

/**
 * Parse a raw question string into a flat list of typed blocks.
 * Rules (in order):
 *   - A line matching /^\*\*[^*]+:\*\*$/ is a section heading.
 *   - Consecutive lines starting with "- " collapse into a bullet block.
 *   - Consecutive lines matching /^\d+\. / collapse into a numbered block.
 *   - A line that is ONLY a backtick code span OR starts with 4 spaces
 *     contributes to a code_block.
 *   - Everything else is prose.
 * Adjacent same-kind blocks are merged.
 */
function parseBlocks(raw: string): Block[] {
  if (!raw || !raw.trim()) return [];

  const rawLines = raw.split("\n");
  const blocks: Block[] = [];

  let i = 0;
  while (i < rawLines.length) {
    const line = rawLines[i];
    const t = line.trim();

    // blank line → skip
    if (!t) { i++; continue; }

    // ── Section heading: **Title:** (whole line)
    const headingMatch = t.match(/^\*\*([^*]+):\*\*\s*$/);
    if (headingMatch) {
      blocks.push({ kind: "heading", text: headingMatch[1] });
      i++;
      continue;
    }

    // ── Bullet list: collect consecutive "- " lines
    if (t.startsWith("- ")) {
      const items: string[] = [];
      while (i < rawLines.length) {
        const lt = rawLines[i].trim();
        if (!lt.startsWith("- ")) break;
        items.push(lt.slice(2));
        i++;
      }
      blocks.push({ kind: "bullet", items });
      continue;
    }

    // ── Numbered list: collect consecutive "N. " lines
    const numStart = t.match(/^(\d+)\.\s+(.+)$/);
    if (numStart) {
      const items: string[] = [];
      while (i < rawLines.length) {
        const lt = rawLines[i].trim();
        const nm = lt.match(/^(\d+)\.\s+(.+)$/);
        if (!nm) break;
        items.push(nm[2]);
        i++;
      }
      blocks.push({ kind: "numbered", items });
      continue;
    }

    // ── Code block: a line that is ONLY a backtick span, OR starts with
    //    spaces/tabs (indented code), OR starts with ``` fences.
    const isFence = t.startsWith("```");
    const isOnlyBacktick = /^`[^`]+`$/.test(t);
    const isIndented = line.startsWith("    ") || line.startsWith("\t");
    if (isFence || isOnlyBacktick || isIndented) {
      const lines: string[] = [];
      if (isFence) {
        i++; // skip opening fence
        while (i < rawLines.length && !rawLines[i].trim().startsWith("```")) {
          lines.push(rawLines[i]);
          i++;
        }
        i++; // skip closing fence
      } else if (isOnlyBacktick) {
        lines.push(t.slice(1, -1));
        i++;
        // Collect more contiguous backtick-only lines
        while (i < rawLines.length && /^`[^`]+`$/.test(rawLines[i].trim())) {
          lines.push(rawLines[i].trim().slice(1, -1));
          i++;
        }
      } else {
        // Indented block
        while (i < rawLines.length && (rawLines[i].startsWith("    ") || rawLines[i].startsWith("\t") || !rawLines[i].trim())) {
          if (rawLines[i].trim()) lines.push(rawLines[i].replace(/^\t/, "    "));
          i++;
        }
      }
      if (lines.length > 0) blocks.push({ kind: "code_block", lines });
      continue;
    }

    // ── Prose: strip inline backtick spans but keep bold markers as plain text
    // We merge adjacent prose lines into a single paragraph.
    let prose = t;
    i++;
    while (i < rawLines.length) {
      const nt = rawLines[i].trim();
      if (!nt) { i++; break; } // blank line ends paragraph
      // Stop at heading / list / code
      if (
        /^\*\*[^*]+:\*\*\s*$/.test(nt) ||
        nt.startsWith("- ") ||
        /^(\d+)\.\s/.test(nt) ||
        /^`[^`]+`$/.test(nt) ||
        rawLines[i].startsWith("    ")
      ) break;
      prose += " " + nt;
      i++;
    }
    blocks.push({ kind: "prose", text: prose });
  }

  return blocks;
}

// ─── Inline markup renderer ───────────────────────────────────────────────────
// Takes a string with optional **bold** and `code` markers and renders it as a
// single <Text> node with nested spans. We explicitly key every nested span and
// wrap the map result in a fragment to avoid React Native web array issues.
function InlineMarkup({ text, baseStyle }: { text: string; baseStyle: object }) {
  // Strip leading **bold:** heading marker from prose lines (section headings
  // are already rendered separately).
  const cleaned = text.replace(/^\*\*[^*]+:\*\*\s*/, "");

  const parts = cleaned.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  if (parts.length === 0) return <Text style={baseStyle}>{cleaned}</Text>;
  if (parts.length === 1 && !parts[0].startsWith("`") && !parts[0].startsWith("**")) {
    return <Text style={baseStyle}>{parts[0]}</Text>;
  }

  return (
    <Text style={baseStyle}>
      {parts.map((part, idx) => {
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
          return (
            <Text key={idx} style={s.inlineCode}>{part.slice(1, -1)}</Text>
          );
        }
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
          return (
            <Text key={idx} style={s.bold}>{part.slice(2, -2)}</Text>
          );
        }
        return <Text key={idx}>{part}</Text>;
      })}
    </Text>
  );
}

// ─── Block renderers ──────────────────────────────────────────────────────────
function ProseBlock({ text }: { text: string }) {
  return (
    <View style={s.blockSpacing}>
      <InlineMarkup text={text} baseStyle={s.prose} />
    </View>
  );
}

function HeadingBlock({ text }: { text: string }) {
  const isCode     = /signature|function|method|class|syntax/i.test(text);
  const isInput    = /input|param|argument/i.test(text);
  const isOutput   = /output|return|result/i.test(text);
  const isReq      = /requirement|task|objective|constraint/i.test(text);

  const icon: keyof typeof Ionicons.glyphMap = isCode
    ? "code-slash-outline"
    : isInput
    ? "arrow-down-outline"
    : isOutput
    ? "arrow-up-outline"
    : isReq
    ? "list-outline"
    : "chevron-forward";

  return (
    <View style={[s.headingRow, s.blockSpacing]}>
      <View style={s.headingIconWrap}>
        <Ionicons name={icon} size={11} color={ACCENT} />
      </View>
      <Text style={s.headingText}>{text.toUpperCase()}</Text>
    </View>
  );
}

function CodeBlock({ lines }: { lines: string[] }) {
  return (
    <View style={[s.codeCard, s.blockSpacing]}>
      {/* Traffic-light title bar */}
      <View style={s.codeBar}>
        <View style={[s.dot, { backgroundColor: "#FF5F57" }]} />
        <View style={[s.dot, { backgroundColor: "#FEBC2E" }]} />
        <View style={[s.dot, { backgroundColor: "#28C840" }]} />
      </View>
      <View style={s.codeBody}>
        {lines.map((ln, idx) => (
          <Text key={idx} style={s.codeLine}>{ln || " "}</Text>
        ))}
      </View>
    </View>
  );
}

function BulletBlock({ items }: { items: string[] }) {
  return (
    <View style={[s.listCard, s.blockSpacing]}>
      {items.map((item, idx) => (
        <View key={idx} style={[s.listRow, idx < items.length - 1 && s.listRowGap]}>
          <View style={s.bulletDot} />
          <InlineMarkup text={item} baseStyle={s.listText} />
        </View>
      ))}
    </View>
  );
}

function NumberedBlock({ items }: { items: string[] }) {
  return (
    <View style={[s.listCard, s.blockSpacing]}>
      {items.map((item, idx) => (
        <View key={idx} style={[s.listRow, idx < items.length - 1 && s.listRowGap]}>
          <View style={s.numBadge}>
            <Text style={s.numBadgeText}>{idx + 1}</Text>
          </View>
          <InlineMarkup text={item} baseStyle={s.listText} />
        </View>
      ))}
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
interface CodingQuestionCardProps {
  questionText: string;
  questionNumber: number;
  totalInPhase: number;
}

export default function CodingQuestionCard({
  questionText,
  questionNumber,
  totalInPhase,
}: CodingQuestionCardProps) {
  const pct     = totalInPhase > 0 ? Math.round((questionNumber / totalInPhase) * 100) : 0;
  const blocks  = parseBlocks(questionText ?? "");

  return (
    <View style={s.card}>
      {/* ── Header row ─────────────────────────────────────────── */}
      <View style={s.header}>
        <View style={s.badge}>
          <Ionicons name="code-slash-outline" size={12} color={ACCENT} />
          <Text style={s.badgeText}>CODING CHALLENGE</Text>
        </View>
        <View style={s.qPill}>
          <Text style={s.qPillText}>{questionNumber} / {totalInPhase}</Text>
        </View>
      </View>

      {/* ── Progress bar ───────────────────────────────────────── */}
      <View style={s.track}>
        <View style={[s.fill, { width: (pct + "%") as unknown as number }]} />
      </View>

      {/* ── Question body ──────────────────────────────────────── */}
      <View style={s.body}>
        {blocks.length === 0 ? (
          /* Fallback: if parsing produced nothing, show the raw text. */
          <Text style={s.prose}>{questionText}</Text>
        ) : (
          blocks.map((block, idx) => {
            switch (block.kind) {
              case "heading":  return <HeadingBlock  key={idx} text={block.text} />;
              case "code_block": return <CodeBlock   key={idx} lines={block.lines} />;
              case "prose":    return <ProseBlock    key={idx} text={block.text} />;
              case "bullet":   return <BulletBlock   key={idx} items={block.items} />;
              case "numbered": return <NumberedBlock key={idx} items={block.items} />;
              default:         return null;
            }
          })
        )}
      </View>

      {/* ── Write-on-paper tip ─────────────────────────────────── */}
      <View style={s.tip}>
        <Ionicons name="pencil-outline" size={14} color={colors.primary[500]} />
        <Text style={s.tipText}>
          Write your solution on paper with a dark pen — then snap a clear photo below for AI scoring.
        </Text>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
// NOTE: No `gap` is used anywhere — gap has React Native web compatibility issues
// when children are JSX array expressions. All spacing is via explicit marginBottom.
// The outer card has NO `overflow:"hidden"` — that can collapse height on web.
const s = StyleSheet.create({
  // ── Card shell (no overflow:hidden — causes height=0 on web)
  card: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: "#FFFFFF",
    marginBottom: 4,
    ...shadows.card,
  },

  // ── Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: ACCENT_LIGHT,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: ACCENT,
    letterSpacing: 0.6,
    marginLeft: 5,
  },
  qPill: {
    backgroundColor: ACCENT_LIGHT,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  qPillText: { fontSize: 12, fontWeight: "700", color: ACCENT },

  // ── Progress bar
  track: {
    height: 3,
    backgroundColor: ACCENT_LIGHT,
    marginHorizontal: 0,
  },
  fill: { height: 3, backgroundColor: ACCENT },

  // ── Body — explicit padding, NO gap
  body: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },

  // ── Block spacing helper (applied to each rendered block)
  blockSpacing: { marginBottom: 14 },

  // ── Prose text
  prose: {
    fontSize: 14.5,
    color: colors.text.primary,
    lineHeight: 23,
  },

  // ── Inline markup
  inlineCode: {
    fontFamily: "monospace",
    fontSize: 13,
    color: INLINE_COL,
    backgroundColor: INLINE_BG,
    borderRadius: 4,
    paddingHorizontal: 2,
  },
  bold: { fontWeight: "700", color: colors.text.primary },

  // ── Section heading row
  headingRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  headingIconWrap: {
    width: 20,
    height: 20,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: ACCENT_LIGHT,
    marginRight: 7,
  },
  headingText: {
    fontSize: 10,
    fontWeight: "800",
    color: ACCENT,
    letterSpacing: 0.7,
  },

  // ── Dark code card (function signature / code block)
  codeCard: {
    backgroundColor: CODE_BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#3D3354",
  },
  codeBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: "#13101E",
    borderBottomWidth: 1,
    borderBottomColor: "#3D3354",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
  },
  codeBody: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
  },
  codeLine: {
    fontFamily: "monospace",
    fontSize: 13.5,
    color: CODE_TEXT,
    lineHeight: 22,
    marginBottom: 1,
  },

  // ── List card (bullet or numbered)
  listCard: {
    backgroundColor: "#FAFAFA",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 6,
  },
  listRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  listRowGap: { marginBottom: 10 },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: ACCENT,
    marginTop: 8,
    marginRight: 10,
    flexShrink: 0,
  },
  numBadge: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: ACCENT_LIGHT,
    marginRight: 10,
    marginTop: 1,
    flexShrink: 0,
  },
  numBadgeText: { fontSize: 11, fontWeight: "800", color: ACCENT },
  listText: {
    flex: 1,
    fontSize: 13.5,
    color: colors.text.secondary,
    lineHeight: 21,
  },

  // ── Bottom tip
  tip: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "rgba(96,22,75,0.04)",
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  tipText: {
    flex: 1,
    fontSize: 12.5,
    color: colors.primary[500],
    lineHeight: 19,
    fontWeight: "500",
    marginLeft: 9,
  },
});
