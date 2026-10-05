import { db } from "@/db";
import { businessRules } from "@/db/schema";
import { DEFAULT_RULES, type RuleSet } from "@/lib/types";

export async function loadRules(): Promise<RuleSet> {
  const rows = await db.select().from(businessRules);
  const out: Record<string, unknown> = { ...DEFAULT_RULES };
  for (const r of rows) if (r.key in DEFAULT_RULES) out[r.key] = r.value;
  return out as RuleSet;
}

export async function saveRules(patch: Partial<RuleSet>): Promise<RuleSet> {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_RULES)) continue;
    if (key === "allowedSuppliers") {
      if (!Array.isArray(value)) continue;
    } else if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
    await db
      .insert(businessRules)
      .values({ key, value })
      .onConflictDoUpdate({ target: businessRules.key, set: { value, updatedAt: new Date() } });
  }
  return loadRules();
}
