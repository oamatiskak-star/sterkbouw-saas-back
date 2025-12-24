import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function loadSystemRules() {
const { data, error } = await supabase
.from("system_calculation_rules")
.select("*")
.eq("active", true)

if (error) throw new Error("SYSTEM_RULES_LOAD_FAILED")

const rules = {}
for (const r of data) {
rules[r.rule_key] = r.value
}
return rules
}
