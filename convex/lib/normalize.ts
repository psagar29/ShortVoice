// ============================================================================
// ⚠️  TEMPORARY STUB -- PERSON A OWNS THIS FILE (CONTRACT.md §7)
// ----------------------------------------------------------------------------
// Person B's branch carries a faithful copy of A's surface so the resolver can
// be run, seeded and evaluated standalone. ON INTEGRATION: delete this file and
// take Person A's version. See PERSON_B_NOTES.md → "Stub files".
//
// This implementation is verbatim from CONTRACT.md §5 -- do not "improve" it,
// the phrases.by_user_trigger index depends on it being byte-identical to A's.
// ============================================================================

export function normalizeTrigger(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}
