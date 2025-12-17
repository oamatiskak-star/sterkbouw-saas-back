import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  const { calcId } = req.params

  const { data } = await supabase
    .from("calc_versions")
    .select("*")
    .eq("calc_master_id", calcId)
    .order("revision")

  res.json(data || [])
}
