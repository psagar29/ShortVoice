// ============================================================================
// ShortVoice -- template rendering  (Person B)
// ============================================================================
// A taught phrase is a TEMPLATE, not a string. "Text Neel that I'll get back
// to him {when}" is one phrase that serves "neel later", "neel tomorrow" and
// "neel friday" -- which is the whole argument against "this is just macros".
// This file is where the {curly} placeholders become words.
// ============================================================================

const PLACEHOLDER = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

/** Never appears in speech; marks a placeholder we could not fill. */
const SENTINEL = "\u0000";

/** Slot names referenced by a template, in order of appearance, de-duplicated. */
export function extractSlots(template: string): string[] {
  const found = new Set<string>();
  for (const m of template.matchAll(PLACEHOLDER)) found.add(m[1]);
  return [...found];
}

/**
 * Substitute slot values into a template.
 *
 * An unfilled placeholder is *deleted* rather than left as literal "{when}" --
 * along with the preposition that introduced it, so "get back to him {when}"
 * degrades to "get back to him" and never to the deeply unserious
 * "get back to him at {when}".
 */
export function renderTemplate(
  template: string,
  slots: Record<string, string | undefined>,
): string {
  let out = template.replace(PLACEHOLDER, (_whole, name: string) => {
    const value = slots[name];
    return value && value.trim() ? value.trim() : SENTINEL;
  });

  // Drop the sentinel plus any preposition stranded in front of it.
  out = out.replace(
    new RegExp(`\\s*\\b(at|on|by|in|to|for|about|around|before|after)\\b\\s*${SENTINEL}`, "gi"),
    "",
  );
  out = out.replace(new RegExp(`\\s*${SENTINEL}`, "g"), "");
  return tidy(out);
}

/** Same substitution, applied through an arbitrary executor params object. */
export function fillParams<T>(params: T, slots: Record<string, string | undefined>): T {
  if (typeof params === "string") return renderTemplate(params, slots) as unknown as T;
  if (Array.isArray(params)) {
    return params.map((p) => fillParams(p, slots)) as unknown as T;
  }
  if (params && typeof params === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(params as Record<string, unknown>)) {
      out[k] = fillParams(val, slots);
    }
    return out as T;
  }
  return params;
}

/** Collapse the whitespace and punctuation damage that substitution leaves behind. */
export function tidy(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/,\s*\./g, ".")
    .trim();
}

/** True when a template still carries a placeholder we could not fill. */
export function hasUnfilledSlots(
  template: string,
  slots: Record<string, string | undefined>,
): boolean {
  return extractSlots(template).some((name) => !slots[name]?.trim());
}
