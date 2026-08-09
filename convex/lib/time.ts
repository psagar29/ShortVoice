// ============================================================================
// ShortVoice -- temporal grounding  (Person B)
// ============================================================================
// Convex runs in UTC; the person on stage does not. Every prompt we send and
// every slot we fill is grounded in the *demo machine's* wall clock, because
// "friday" is meaningless without knowing today is Saturday.
//
// SHORTVOICE_TZ (Convex env) overrides the default. Set it before the demo:
//   npx convex env set SHORTVOICE_TZ America/Los_Angeles
// ============================================================================

const DEFAULT_TZ = "America/Los_Angeles";

export function timeZone(): string {
  return process.env.SHORTVOICE_TZ || DEFAULT_TZ;
}

const WEEKDAYS = [
  "sunday", "monday", "tuesday", "wednesday",
  "thursday", "friday", "saturday",
];

const WEEKDAY_ALIASES: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6,
};

export type TemporalContext = {
  /** "Saturday, August 9, 2026" */
  dateLabel: string;
  /** "2:47 PM" */
  clockLabel: string;
  /** "saturday" */
  weekday: string;
  /** "morning" | "afternoon" | "evening" | "night" */
  partOfDay: string;
  /** ISO-8601 instant, always unambiguous for the model. */
  iso: string;
  timeZone: string;
  isWeekend: boolean;
};

/** Wall-clock fields for `now` rendered in the demo timezone. */
function parts(now: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) out[p.type] = p.value;
  return out;
}

export function temporalContext(now: Date = new Date()): TemporalContext {
  const tz = timeZone();
  const p = parts(now, tz);
  const hour24 = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false })
      .format(now)
      .replace(/\D/g, ""),
  );
  const weekday = (p.weekday || "").toLowerCase();
  return {
    dateLabel: `${p.weekday}, ${p.month} ${p.day}, ${p.year}`,
    clockLabel: `${p.hour}:${p.minute} ${p.dayPeriod ?? ""}`.trim(),
    weekday,
    partOfDay: partOfDay(hour24),
    iso: now.toISOString(),
    timeZone: tz,
    isWeekend: weekday === "saturday" || weekday === "sunday",
  };
}

export function partOfDay(hour24: number): string {
  if (hour24 < 5) return "night";
  if (hour24 < 12) return "morning";
  if (hour24 < 17) return "afternoon";
  if (hour24 < 21) return "evening";
  return "night";
}

/** One compact line handed to every LLM call so relative words resolve. */
export function temporalPreamble(now: Date = new Date()): string {
  const t = temporalContext(now);
  return `Right now it is ${t.clockLabel} on ${t.dateLabel} (${t.timeZone}). It is ${t.partOfDay}${t.isWeekend ? ", a weekend" : ""}.`;
}

/**
 * Best-effort grounding of a spoken time fragment to a concrete instant.
 *
 * Purely advisory: the spoken confirmation still says "tomorrow", because
 * that is what the person said. The timestamp rides along in params so an
 * executor (Calendar, a reminder) has something machine-usable.
 * Returns null when the fragment carries no temporal meaning at all.
 */
export function groundWhen(
  fragment: string,
  now: Date = new Date(),
): { label: string; iso: string } | null {
  const f = fragment.toLowerCase().trim();
  if (!f) return null;
  const tz = timeZone();
  const base = new Date(now);

  // Local midnight of `now`, expressed as a UTC instant.
  const localMidnight = (offsetDays: number): Date => {
    const p = parts(base, tz);
    const d = new Date(
      `${p.year}-${String(monthNumber(p.month!)).padStart(2, "0")}-${String(p.day).padStart(2, "0")}T00:00:00`,
    );
    d.setDate(d.getDate() + offsetDays);
    return d;
  };
  const at = (d: Date, hour: number) => {
    const out = new Date(d);
    out.setHours(hour, 0, 0, 0);
    return out;
  };

  const explicitHour = f.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  const dayOffsetFor = (): number | null => {
    if (/\btomorrow|tmrw\b/.test(f)) return 1;
    if (/\btoday|tonight|tonite|this evening|this afternoon\b/.test(f)) return 0;
    if (/\byesterday\b/.test(f)) return -1;
    for (const [word, idx] of Object.entries(WEEKDAY_ALIASES)) {
      if (new RegExp(`\\b${word}\\b`).test(f)) {
        const todayIdx = WEEKDAYS.indexOf(temporalContext(now).weekday);
        let delta = (idx - todayIdx + 7) % 7;
        if (delta === 0) delta = 7; // "friday" said on Friday means next Friday
        return delta;
      }
    }
    return null;
  };

  const offset = dayOffsetFor();
  let target: Date | null = null;

  if (offset !== null) {
    const day = localMidnight(offset);
    if (explicitHour) {
      let h = Number(explicitHour[1]) % 12;
      if (explicitHour[3] === "pm") h += 12;
      target = at(day, h);
    } else if (/\bmorning\b/.test(f)) target = at(day, 9);
    else if (/\bafternoon\b/.test(f)) target = at(day, 14);
    else if (/\bevening|tonight|tonite\b/.test(f)) target = at(day, 19);
    else if (/\bnight\b/.test(f)) target = at(day, 21);
    else target = at(day, 9);
  } else if (explicitHour) {
    let h = Number(explicitHour[1]) % 12;
    if (explicitHour[3] === "pm") h += 12;
    target = at(localMidnight(0), h);
    if (target.getTime() < now.getTime()) target = at(localMidnight(1), h);
  } else if (/\blater\b/.test(f)) {
    target = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  } else if (/\bnow|asap|right away\b/.test(f)) {
    target = new Date(now.getTime() + 60 * 1000);
  } else if (/\bsoon\b/.test(f)) {
    target = new Date(now.getTime() + 30 * 60 * 1000);
  } else if (/\bweekend\b/.test(f)) {
    const todayIdx = WEEKDAYS.indexOf(temporalContext(now).weekday);
    target = at(localMidnight((6 - todayIdx + 7) % 7 || 7), 10);
  }

  if (!target || Number.isNaN(target.getTime())) return null;
  return { label: fragment.trim(), iso: target.toISOString() };
}

function monthNumber(monthName: string): number {
  const months = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];
  const i = months.indexOf(monthName.toLowerCase());
  return i >= 0 ? i + 1 : 1;
}
