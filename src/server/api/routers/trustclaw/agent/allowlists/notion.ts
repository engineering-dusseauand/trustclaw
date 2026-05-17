/**
 * Notion default allowlist — PM preset.
 *
 * Scope: read/search pages, query databases, fetch rows and blocks,
 * create/update pages and blocks, comment, insert/update database
 * rows. Excluded from defaults (user opts in): destructive actions
 * (archive, delete block), database schema changes, page
 * duplication.
 *
 * Slug names verified against Composio's live catalog
 * (https://backend.composio.dev/api/v3/tools?toolkit_slug=notion) on
 * 2026-05-17. Catalog has 28 total notion slugs; this curates 16.
 */

const PAGES = [
  "NOTION_FETCH_DATA",
  "NOTION_SEARCH_NOTION_PAGE",
  "NOTION_CREATE_NOTION_PAGE",
  "NOTION_UPDATE_PAGE",
  "NOTION_GET_PAGE_PROPERTY_ACTION",
] as const;

const DATABASES = [
  "NOTION_FETCH_DATABASE",
  "NOTION_QUERY_DATABASE",
  "NOTION_FETCH_ROW",
  "NOTION_INSERT_ROW_DATABASE",
  "NOTION_UPDATE_ROW_DATABASE",
  "NOTION_RETRIEVE_DATABASE_PROPERTY",
] as const;

const BLOCKS = [
  "NOTION_FETCH_BLOCK_CONTENTS",
  "NOTION_FETCH_BLOCK_METADATA",
  "NOTION_APPEND_BLOCK_CHILDREN",
  "NOTION_ADD_PAGE_CONTENT",
  "NOTION_UPDATE_BLOCK",
] as const;

const COMMENTS_AND_USERS = [
  "NOTION_CREATE_COMMENT",
  "NOTION_FETCH_COMMENTS",
  "NOTION_LIST_USERS",
] as const;

export const DEFAULT_SLUGS: readonly string[] = [
  ...PAGES,
  ...DATABASES,
  ...BLOCKS,
  ...COMMENTS_AND_USERS,
];

export const CATEGORIES: readonly {
  label: string;
  slugs: readonly string[];
}[] = [
  { label: "Pages", slugs: PAGES },
  { label: "Databases", slugs: DATABASES },
  { label: "Blocks", slugs: BLOCKS },
  { label: "Comments & users", slugs: COMMENTS_AND_USERS },
];
