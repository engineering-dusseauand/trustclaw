/**
 * Slack default allowlist — PM preset.
 *
 * Scope: list channels and users, read conversation history and
 * threads, send messages, search, react. Excluded from defaults
 * (user opts in): destructive actions (delete, archive), channel
 * creation, user/group admin, DND/snooze/profile mutations.
 *
 * Slug names verified against Composio's live catalog
 * (https://backend.composio.dev/api/v3/tools?toolkit_slug=slack) on
 * 2026-05-17. Catalog has 132 total slack slugs; this curates 10.
 */

const CHANNELS = [
  "SLACK_LIST_ALL_CHANNELS",
  "SLACK_FIND_CHANNELS",
] as const;

const MESSAGES = [
  "SLACK_SEND_MESSAGE",
  "SLACK_FETCH_CONVERSATION_HISTORY",
  "SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION",
  "SLACK_ADD_REACTION_TO_AN_ITEM",
] as const;

const SEARCH = [
  "SLACK_SEARCH_MESSAGES",
] as const;

const USERS = [
  "SLACK_LIST_ALL_USERS",
  "SLACK_FIND_USERS",
  "SLACK_FIND_USER_BY_EMAIL_ADDRESS",
] as const;

export const DEFAULT_SLUGS: readonly string[] = [
  ...CHANNELS,
  ...MESSAGES,
  ...SEARCH,
  ...USERS,
];

export const CATEGORIES: readonly {
  label: string;
  slugs: readonly string[];
}[] = [
  { label: "Channels", slugs: CHANNELS },
  { label: "Messages", slugs: MESSAGES },
  { label: "Search", slugs: SEARCH },
  { label: "Users", slugs: USERS },
];
