import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  const { versionId } = req.params

  const { data } = await supabase
    .from("calc_rows")
    .select("*")
    .eq("calc_version_id", versionId)
    .order("discipline")

  res.json(data || [])
}
