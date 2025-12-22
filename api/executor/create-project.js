import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  const { naam } = req.body

  if (!naam) {
    return res.status(400).json({
      error: "Naam is verplicht"
    })
  }

  try {
    // 1️⃣ Maak het project aan in Supabase
    const { data, error } = await supabase
      .from("projects")
      .insert([{ name: naam, status: "new" }])
      .select("id")
      .single()

    if (error) {
      throw error
    }

    // 2️⃣ Retourneer het project_id naar de frontend
    return res.status(201).json({
      ok: true,
      project_id: data.id
    })
  } catch (err) {
    console.error("Fout bij het aanmaken van project:", err)

    return res.status(500).json({
      error: "Interne fout bij aanmaken project"
    })
  }
}
