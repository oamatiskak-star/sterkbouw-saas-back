import { classifyDefects } from "../analysis/nen2767/defect_classifier.js"
import { calculateNenScore } from "../analysis/nen2767/score_engine.js"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function runNen2767({ project_id, input_defects }) {
  const defects = classifyDefects(input_defects)
  const result = calculateNenScore(defects)

  await supabase.from("nen2767_results").insert({
    project_id,
    score: result.score_gemiddeld,
    details: result.details
  })

  return result
}
