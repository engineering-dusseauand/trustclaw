/**
 * Multi-word toolkit prefixes that must be detected before the
 * single-word `split("_")[0]` heuristic. Update when a new toolkit
 * with a compound name (e.g. MICROSOFT_TEAMS, ZOOM_VIDEO) is added —
 * otherwise `MICROSOFT_TEAMS_SEND_MESSAGE` would parse as toolkit
 * `microsoft` and Composio's session config would silently drop it.
 */
const KNOWN_MULTI_WORD_TOOLKITS = ["GOOGLE_CALENDAR", "GOOGLE_DRIVE"];

/**
 * Groups a flat list of Composio tool slugs by toolkit, producing the
 * shape Composio's `composio.create({ tools: ... })` config expects.
 *
 * @param effective - the per-instance `allowedToolSlugs` array.
 * @returns `{ [toolkit]: { enable: string[] } }`, ready to pass to
 *          `composio.create()` as the `tools` field. Toolkit keys are
 *          lowercase; slug values are uppercased.
 */
export function buildAllowlistConfig(
  effective: string[],
): Record<string, { enable: string[] }> {
  const grouped = new Map<string, string[]>();
  for (const raw of effective) {
    if (typeof raw !== "string" || raw.length === 0) continue;
    const slug = raw.toUpperCase();
    const multi = KNOWN_MULTI_WORD_TOOLKITS.find((p) => slug.startsWith(`${p}_`));
    const head = multi ?? slug.split("_")[0];
    if (!head) continue;
    const toolkit = head.toLowerCase();
    if (!toolkit) continue;
    if (!grouped.has(toolkit)) grouped.set(toolkit, []);
    grouped.get(toolkit)!.push(slug);
  }
  const out: Record<string, { enable: string[] }> = {};
  for (const [toolkit, slugs] of grouped) {
    out[toolkit] = { enable: slugs };
  }
  return out;
}
