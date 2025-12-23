import express from "express"
import { createClient } from "@supabase/supabase-js"

const router = express.Router()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

/*
========================
GET /projecten
========================
*/
router.get("/", async (_req, res) => {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  res.json(data)
})

/*
========================
POST /projecten
ENIGE GELDIGE MANIER OM PROJECT AAN TE MAKEN
========================
*/
router.post("/", async (req, res) => {
  try {
    const {
      naam,
      naam_opdrachtgever,
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
        naam_opdrachtgever: naam_opdrachtgever || null,
        adres: adres || null,
        postcode: postcode || null,
        plaatsnaam: plaatsnaam || null,
        land: land || "Nederland",
        telefoon: telefoon || null,
        project_type: project_type || null,
        opmerking: opmerking || null,
        files_uploaded: false,
        analysis_status: null,
        created_at: new Date().toISOString()
      })
      .select("id")
      .single()

    if (error) {
      throw error
    }

    res.json({
      project_id: data.id
    })
  } catch (e) {
    res.status(500).json({
      error: e.message
    })
  }
})

export default router
