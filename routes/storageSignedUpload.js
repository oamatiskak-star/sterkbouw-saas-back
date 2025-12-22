import express from "express"
import { createClient } from "@supabase/supabase-js"

const router = express.Router()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

router.post("/signed-upload", async (req, res) => {
  const { bucket, path, contentType } = req.body
  if (!bucket || !path) return res.status(400).json({ error: "MISSING_PARAMS" })

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(path, { contentType })

  if (error) return res.status(500).json({ error: error.message })

  res.json(data)
})

export default router
