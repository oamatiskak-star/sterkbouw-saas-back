import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  const { project_id, naam, confirmed } = req.body

  // 🔒 HARD GUARD
  // Dit endpoint mag NOOIT automatisch draaien
  if (!confirmed) {
    return res.status(400).json({
      error: "Calculatie aanmaken geblokkeerd. Bevestiging via opt-form vereist."
    })
  }

  if (!project_id || !naam) {
    return res.status(400).json({
      error: "project_id en naam zijn verplicht"
    })
  }

  try {
    // 1️⃣ Master calculatie
    const { data: master, error: masterError } = await supabase
      .from("calc_master")
      .insert({
        project_id,
        naam
      })
      .select()
      .single()

    if (masterError) {
      throw masterError
    }

    // 2️⃣ Eerste versie (master)
    const { data: version, error: versionError } = await supabase
      .from("calc_versions")
      .insert({
        calc_master_id: master.id,
        version_type: "master",
        revision: 1
      })
      .select()
      .single()

    if (versionError) {
      throw versionError
    }

    // ✅ SUCCES
    return res.status(201).json({
      ok: true,
      calc_id: master.id,
      version_id: version.id
    })
  } catch (err) {
    console.error("Fout bij aanmaken calculatie:", err)

    return res.status(500).json({
      error: "Interne fout bij aanmaken calculatie"
    })
  }
}
