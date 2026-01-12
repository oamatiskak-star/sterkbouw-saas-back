import { Router } from "express"
import { createClient } from "@supabase/supabase-js"

const router = Router()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

router.post("/", async (req, res) => {
  try {
    const body = req.body || {}
    const customer_id = body.customer_id ?? body.client_id

    if (!customer_id) {
      return res.status(400).json({ error: "CUSTOMER_ID_REQUIRED" })
    }

    const projectData = {
      client_id: customer_id,
      status: "input",
      naam: body.naam ?? body.name ?? null,
      naam_opdrachtgever: body.naam_opdrachtgever ?? body.customer_name ?? null,
      adres: body.adres ?? body.address ?? null,
      postcode: body.postcode ?? null,
      plaatsnaam: body.plaatsnaam ?? body.city ?? null,
      land: body.land ?? body.country ?? "Nederland",
      telefoon: body.telefoon ?? body.phone ?? null,
      project_type: body.project_type ?? null,
      opmerking: body.opmerking ?? body.note ?? null
    }

    const { data, error } = await supabase
      .from("projects")
      .insert(projectData)
      .select("id")
      .single()

    if (error) {
      return res.status(500).json({ error: error.message })
    }

    return res.json({ project_id: data.id })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

export default router
