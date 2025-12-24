import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // altijd service role gebruiken in backend
)

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  const { project_id } = req.query

  if (!project_id) {
    return res.status(400).json({ error: "project_id is required" })
  }

  try {
    const { data, error } = await supabase
      .from("projects")
      .select(`
        id,
        naam,
        project_type,
        files_uploaded,
        analysis_status,
        created_at,
        updated_at,
        analysis_log
      `)
      .eq("id", project_id)
      .single()

    if (error) throw error

    res.status(200).json({ project: data })
  } catch (err) {
    console.error("projects_api_error", err.message)
    res.status(500).json({ error: err.message })
  }
}
