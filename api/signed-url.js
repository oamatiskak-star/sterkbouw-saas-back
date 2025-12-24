import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // altijd service role gebruiken in backend
)

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  const { project_id, file_name } = req.body

  if (!project_id || !file_name) {
    return res.status(400).json({ error: "project_id and file_name are required" })
  }

  try {
    const { signedURL, error } = await supabase.storage
      .from("sterkcalc")
      .createSignedUrl(`${project_id}/${file_name}`, 3600)

    if (error) throw error

    res.status(200).json({ signedURL })
  } catch (err) {
    console.error("signed_url_error", err.message)
    res.status(500).json({ error: err.message })
  }
}
