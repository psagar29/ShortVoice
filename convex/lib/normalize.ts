export function normalizeTrigger(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/)
    .filter(Boolean).sort().join(" ");
}

export function leftoverTokens(utterance: string, trigger: string): string[] {
  const utteranceTokens = normalizeTrigger(utterance).split(" ").filter(Boolean);
  const triggerTokens = new Set(normalizeTrigger(trigger).split(" ").filter(Boolean));
  return utteranceTokens.filter((t) => !triggerTokens.has(t));
}
