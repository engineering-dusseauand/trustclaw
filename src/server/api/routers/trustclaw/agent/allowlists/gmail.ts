/**
 * Gmail default allowlist — PM preset.
 *
 * Scope: read inbox + threads, send mail and replies, manage drafts
 * and labels. Excluded from defaults (user opts in): destructive
 * actions (delete, trash), contact/people lookups, attachment
 * fetching, label patching.
 *
 * Slug names verified against Composio's live catalog
 * (https://backend.composio.dev/api/v3/tools?toolkit_slug=gmail) on
 * 2026-05-17. Catalog has 22 total gmail slugs; this curates 14.
 */

const INBOX = [
  "GMAIL_FETCH_EMAILS",
  "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
  "GMAIL_FETCH_MESSAGE_BY_THREAD_ID",
  "GMAIL_LIST_THREADS",
] as const;

const SEND = [
  "GMAIL_SEND_EMAIL",
  "GMAIL_REPLY_TO_THREAD",
] as const;

const DRAFTS = [
  "GMAIL_CREATE_EMAIL_DRAFT",
  "GMAIL_LIST_DRAFTS",
  "GMAIL_SEND_DRAFT",
] as const;

const LABELS = [
  "GMAIL_LIST_LABELS",
  "GMAIL_CREATE_LABEL",
  "GMAIL_ADD_LABEL_TO_EMAIL",
  "GMAIL_REMOVE_LABEL",
  "GMAIL_MODIFY_THREAD_LABELS",
] as const;

export const DEFAULT_SLUGS: readonly string[] = [
  ...INBOX,
  ...SEND,
  ...DRAFTS,
  ...LABELS,
];

export const CATEGORIES: readonly {
  label: string;
  slugs: readonly string[];
}[] = [
  { label: "Inbox", slugs: INBOX },
  { label: "Send", slugs: SEND },
  { label: "Drafts", slugs: DRAFTS },
  { label: "Labels", slugs: LABELS },
];
