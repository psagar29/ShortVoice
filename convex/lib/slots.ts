// ============================================================================
// ShortVoice -- deterministic slot filling  (Person B)
// ============================================================================
// "neel tomorrow" must hit the same taught phrase as "neel later", with a
// different filler. The brief allows one LLM call to do that. This file does it
// without one, for the overwhelmingly common shapes (a time, a known contact),
// and leaves the LLM for what is genuinely underdetermined.
//
// Why bother: the strong path is Beat 1 of the demo, it is the path that must
// never be slow and never be wrong, and a model round trip is both a latency
// risk and a correctness risk when the answer is sitting in the tokens.
// ============================================================================

import { extractSlots } from "./render";
import { isTimeToken, leftoverTokens, timeTokensOf, tokenMatches, tokens } from "./text";

export type ContactLite = {
  alias: string;
  fullName: string;
  phone?: string;
  slackId?: string;
  email?: string;
};

export type SlotKind = "time" | "person" | "place" | "other";

const TIME_NAMES = /^(when|time|day|date|deadline|eta|at)$/i;
const PERSON_NAMES = /^(who|contact|person|recipient|name|to)$/i;
const PLACE_NAMES = /^(where|place|location|from|origin|destination)$/i;

export function inferSlotKind(name: string): SlotKind {
  if (TIME_NAMES.test(name)) return "time";
  if (PERSON_NAMES.test(name)) return "person";
  if (PLACE_NAMES.test(name)) return "place";
  return "other";
}

export type SlotFill = {
  slots: Record<string, string>;
  /** Slot names we could not fill deterministically -- candidates for the LLM. */
  unresolved: string[];
  /** Utterance tokens the trigger did not account for. */
  leftover: string[];
  /** Leftover tokens no slot consumed -- fed to the LLM as raw material. */
  spare: string[];
};

/** Every slot the phrase can take: declared ones plus any {curly} in the template. */
export function slotNamesFor(phrase: { slots: string[]; intentTemplate: string }): string[] {
  return [...new Set([...phrase.slots, ...extractSlots(phrase.intentTemplate)])];
}

/**
 * Fill what the words themselves determine.
 *
 *   "neel tomorrow"  vs trigger "neel later"  -> { when: "tomorrow" }
 *   "neel later"     vs trigger "neel later"  -> { when: "later"    }
 *
 * That second case is the subtle one: the trigger's *own* time word is the
 * template's default filler, so an exact-trigger utterance still renders a
 * complete sentence instead of "get back to him".
 */
export function deterministicSlots(
  phrase: { trigger: string; slots: string[]; intentTemplate: string },
  utterance: string,
  contacts: ContactLite[],
): SlotFill {
  const names = slotNamesFor(phrase);
  const leftover = leftoverTokens(utterance, phrase.trigger);
  const pool = [...leftover];
  const slots: Record<string, string> = {};
  const unresolved: string[] = [];

  const take = (predicate: (t: string) => boolean): string[] => {
    const taken: string[] = [];
    for (let i = pool.length - 1; i >= 0; i--) {
      if (predicate(pool[i])) taken.unshift(...pool.splice(i, 1));
    }
    return taken;
  };

  for (const name of names) {
    switch (inferSlotKind(name)) {
      case "time": {
        const spoken = take(isTimeToken);
        if (spoken.length > 0) {
          slots[name] = spoken.join(" ");
        } else {
          // Fall back to the time word baked into the trigger itself.
          const fromTrigger = timeTokensOf(phrase.trigger);
          if (fromTrigger.length > 0) slots[name] = fromTrigger.join(" ");
          else unresolved.push(name);
        }
        break;
      }
      case "person": {
        const match = take((t) => contacts.some((c) => aliasMatches(c, t)));
        if (match.length > 0) {
          const contact = contacts.find((c) => aliasMatches(c, match[0]));
          slots[name] = contact?.fullName ?? match[0];
        } else {
          const inTrigger = tokens(phrase.trigger).find((t) =>
            contacts.some((c) => aliasMatches(c, t)),
          );
          if (inTrigger) {
            slots[name] = contacts.find((c) => aliasMatches(c, inTrigger))!.fullName;
          } else unresolved.push(name);
        }
        break;
      }
      default:
        unresolved.push(name);
    }
  }

  // A single remaining free-form slot with leftover words is unambiguous:
  // those words ARE the value. More than one and we ask the model.
  if (unresolved.length === 1 && pool.length > 0) {
    slots[unresolved[0]] = pool.join(" ");
    pool.length = 0;
    unresolved.length = 0;
  }

  return { slots, unresolved, leftover, spare: pool };
}

export function aliasMatches(contact: ContactLite, token: string): boolean {
  if (tokenMatches(contact.alias, token)) return true;
  const first = contact.fullName.split(/\s+/)[0]?.toLowerCase();
  return Boolean(first && tokenMatches(first, token));
}

export function findContact(contacts: ContactLite[], needle: string): ContactLite | undefined {
  const n = needle.toLowerCase().trim();
  if (!n) return undefined;
  return (
    contacts.find((c) => c.alias === n || c.fullName.toLowerCase() === n) ??
    contacts.find((c) => tokens(n).some((t) => aliasMatches(c, t)))
  );
}

/**
 * Turn a human-shaped param ("contact": "mom") into something an executor can
 * actually deliver to: a phone number, a Slack id, a real name.
 *
 * Never destructive -- the original alias stays in place so the dashboard and
 * the spoken line keep saying "Mom", not "+15551230001".
 */
export function attachContact(
  actionType: string,
  params: Record<string, unknown>,
  contacts: ContactLite[],
): Record<string, unknown> {
  const out = { ...params };

  const aliasField = typeof out.contact === "string" ? (out.contact as string) : undefined;
  if (aliasField) {
    const c = findContact(contacts, aliasField);
    if (c) {
      out.contactName = c.fullName;
      if (c.phone) out.phone = c.phone;
      if (c.slackId) out.slackId = c.slackId;
      if (c.email) out.email = c.email;
    }
  }

  if (actionType === "send_slack") {
    const channel = typeof out.channel === "string" ? (out.channel as string) : "";
    if (channel && !channel.startsWith("#") && !channel.startsWith("U") && !channel.startsWith("C")) {
      const c = findContact(contacts, channel);
      if (c?.slackId) out.channel = c.slackId;
    }
    if (!out.channel && typeof out.slackId === "string") out.channel = out.slackId;
  }

  return out;
}
