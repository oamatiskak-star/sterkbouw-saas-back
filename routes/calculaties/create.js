import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  const { project_id, naam } = req.body

  const { data: master } = await supabase
    .from("calc_master")
    .insert({ project_id, naam })
    .select()
    .single()

  const { data: version } = await supabase
    .from("calc_versions")
    .insert({
      calc_master_id: master.id,
      version_type: "master",
      revision: 1
    })
    .select()
    .single()

  res.json({
    ok: true,
    calc_id: master.id,
    version_id: version.id
  })
}
