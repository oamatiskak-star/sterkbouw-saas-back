import express from "express"
import { createClient } from "@supabase/supabase-js"

const router = express.Router()
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

router.post("/initialize-project", async (req, res) => {
  const { project_id, options } = req.body

  await supabase
    .from("projects")
    .update({ status: "initializing" })
    .eq("id", project_id)

  await supabase.from("project_initialization_options").insert({
    project_id,
    options_json: options
  })

  await fetch(process.env.EXECUTOR_URL + "/run-initialization", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_id, options })
  })

  res.json({ status: "started" })
})

export default router
