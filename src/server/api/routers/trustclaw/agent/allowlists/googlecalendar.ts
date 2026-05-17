/**
 * Google Calendar default allowlist — PM preset.
 *
 * Scope: list/find/create/update events, list calendars, find free
 * slots, check current time. Excluded from defaults (user opts in):
 * destructive actions (delete event, clear/delete calendar), calendar
 * inserts, ACL changes, settings mutations.
 *
 * Note: Composio's toolkit slug is `googlecalendar` (single word), so
 * tool slugs are `GOOGLECALENDAR_*` not `GOOGLE_CALENDAR_*`. The
 * `buildAllowlistConfig` helper picks this up via the standard
 * `slug.split("_")[0]` heuristic without special-casing.
 *
 * Slug names verified against Composio's live catalog
 * (https://backend.composio.dev/api/v3/tools?toolkit_slug=googlecalendar)
 * on 2026-05-17. Catalog has 28 total googlecalendar slugs; this
 * curates 10.
 */

const EVENTS = [
  "GOOGLECALENDAR_EVENTS_LIST",
  "GOOGLECALENDAR_FIND_EVENT",
  "GOOGLECALENDAR_CREATE_EVENT",
  "GOOGLECALENDAR_QUICK_ADD",
  "GOOGLECALENDAR_UPDATE_EVENT",
  "GOOGLECALENDAR_PATCH_EVENT",
] as const;

const CALENDARS = [
  "GOOGLECALENDAR_LIST_CALENDARS",
  "GOOGLECALENDAR_GET_CALENDAR",
] as const;

const SCHEDULING = [
  "GOOGLECALENDAR_FIND_FREE_SLOTS",
  "GOOGLECALENDAR_FREE_BUSY_QUERY",
  "GOOGLECALENDAR_GET_CURRENT_DATE_TIME",
] as const;

export const DEFAULT_SLUGS: readonly string[] = [
  ...EVENTS,
  ...CALENDARS,
  ...SCHEDULING,
];

export const CATEGORIES: readonly {
  label: string;
  slugs: readonly string[];
}[] = [
  { label: "Events", slugs: EVENTS },
  { label: "Calendars", slugs: CALENDARS },
  { label: "Scheduling", slugs: SCHEDULING },
];
