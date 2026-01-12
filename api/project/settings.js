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
    const { project_id, settings } = body

    if (!project_id) {
      return res.status(400).json({ error: "PROJECT_ID_REQUIRED" })
    }

    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      return res.status(400).json({ error: "SETTINGS_REQUIRED" })
    }

    const updateData = { ...settings }
    delete updateData.project_id
    delete updateData.id

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "SETTINGS_REQUIRED" })
    }

    const { data, error } = await supabase
      .from("projects")
      .update(updateData)
      .eq("id", project_id)
      .select("id")
      .single()

    if (error) {
      return res.status(500).json({ error: error.message })
    }

    if (!data) {
      return res.status(404).json({ error: "PROJECT_NOT_FOUND" })
    }

    return res.json({ ok: true, project_id })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

export default router
