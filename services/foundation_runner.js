import { fetchBroFoundationData } from "../analysis/foundation/bro_client.js"
import { matchArchiveData } from "../analysis/foundation/archive_matcher.js"
import { calculateFoundationRisk } from "../analysis/foundation/risk_engine.js"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function runFoundationAnalysis({
  project_id,
  postcode,
  plaats,
  bouwjaar,
  regio
}) {
  const broData = await fetchBroFoundationData({ postcode, plaats })
  const archiveData = matchArchiveData({ bouwjaar, regio })
  const risk = calculateFoundationRisk({ broData, archiveData })

  await supabase.from("foundation_results").insert({
    project_id,
    bro_data: broData,
    archive_data: archiveData,
    risk
  })

  return risk
}
