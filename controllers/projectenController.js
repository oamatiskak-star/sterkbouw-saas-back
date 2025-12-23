import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

/*
========================
GET /projecten
========================
*/
export async function getProjecten(req, res) {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  res.json(data)
}

/*
========================
POST /projecten
MAAKT 1 PROJECT AAN
========================
*/
export async function createProject(req, res) {
  try {
    const {
      naam,
      adres,
      postcode,
      plaatsnaam,
      land,
      telefoon,
      project_type,
      opmerking
    } = req.body || {}

    const { data, error } = await supabase
      .from("projects")
      .insert({
        naam: naam || null,
        adres: adres || null,
        postcode: postcode || null,
        plaatsnaam: plaatsnaam || null,
        land: land || "Nederland",
        telefoon: telefoon || null,
        project_type: project_type || null,
        opmerking: opmerking || null,
        analysis_status: null,
        files_uploaded: false
      })
      .select("id")
      .single()

    if (error) {
      throw error
    }

    return res.json({
      project_id: data.id
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
