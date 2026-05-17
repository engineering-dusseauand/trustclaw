/**
 * Supabase default allowlist — pinned-project preset.
 *
 * Scope: read project metadata, schema, functions, branches, and
 * service health for the single project pinned via
 * `pinnedSupabaseProjectRef`. Excluded from defaults (user opts in):
 * SQL execution, project/branch/function mutations, top-level project
 * or organization creation, cross-project enumeration.
 *
 * Slug names verified against Composio's live catalog
 * (https://backend.composio.dev/api/v3/tools?toolkit_slug=supabase) on
 * 2026-05-17. Catalog has 79 total supabase slugs; this curates 11.
 *
 * Resource scoping (project_ref injection) is handled by the existing
 * `pinSupabaseProjectRef` wrapper.
 */

const PROJECT_INFO = [
  "SUPABASE_GET_PROJECT_API_KEYS",
  "SUPABASE_GETS_PROJECT_S_SERVICE_HEALTH_STATUS",
  "SUPABASE_RETURNS_PROJECT_S_READONLY_MODE_STATUS",
] as const;

const SCHEMA = [
  "SUPABASE_GET_TABLE_SCHEMAS",
  "SUPABASE_GENERATE_TYPE_SCRIPT_TYPES",
] as const;

const FUNCTIONS_AND_BRANCHES = [
  "SUPABASE_LIST_ALL_FUNCTIONS",
  "SUPABASE_RETRIEVE_A_FUNCTION",
  "SUPABASE_RETRIEVE_A_FUNCTION_BODY",
  "SUPABASE_LIST_ALL_DATABASE_BRANCHES",
  "SUPABASE_GET_DATABASE_BRANCH_CONFIG",
] as const;

const STORAGE_AND_BACKUPS = [
  "SUPABASE_LISTS_ALL_BUCKETS",
] as const;

export const DEFAULT_SLUGS: readonly string[] = [
  ...PROJECT_INFO,
  ...SCHEMA,
  ...FUNCTIONS_AND_BRANCHES,
  ...STORAGE_AND_BACKUPS,
];

export const CATEGORIES: readonly {
  label: string;
  slugs: readonly string[];
}[] = [
  { label: "Project info", slugs: PROJECT_INFO },
  { label: "Schema", slugs: SCHEMA },
  { label: "Functions & branches", slugs: FUNCTIONS_AND_BRANCHES },
  { label: "Storage", slugs: STORAGE_AND_BACKUPS },
];
