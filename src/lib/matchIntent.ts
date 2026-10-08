export interface MatchIntent { id: string; day: string }

export const matchIntentArgs = (intent: MatchIntent) => ({ p_intent: intent.id, p_day: intent.day });
