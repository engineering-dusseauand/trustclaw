/**
 * Multi-word toolkit prefixes detected before the default
 * `split("_")[0]` heuristic. **Composio's actual catalog uses
 * single-word toolkit slugs even for compound names** — Google
 * Calendar tools are `GOOGLECALENDAR_*` not `GOOGLE_CALENDAR_*`,
 * Google Drive is `GOOGLEDRIVE_*`. So this list is empty by default.
 * Add an entry only if a future toolkit ships with an underscore in
 * its Composio slug name; verify against
 * https://backend.composio.dev/api/v3/tools?toolkit_slug=<name>
 * before adding.
 */
const KNOWN_MULTI_WORD_TOOLKITS: readonly string[] = [];

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
