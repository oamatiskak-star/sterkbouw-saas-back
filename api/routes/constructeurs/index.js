import express from "express"
import supabase from "../../../supabaseClient.js"

const router = express.Router()

// GET: Alle constructie-items ophalen
router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("constructeurs")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// POST: Nieuw constructie-item toevoegen
router.post("/", async (req, res) => {
  const { project_id, constructeur_id, omschrijving, bestand_url } = req.body

  const { data, error } = await supabase.from("constructeurs").insert([
    {
      project_id,
      constructeur_id,
      omschrijving,
      bestand_url
    }
  ])

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// PUT: Item updaten
router.put("/:id", async (req, res) => {
  const { id } = req.params
  const { omschrijving, bestand_url } = req.body

  const { data, error } = await supabase
    .from("constructeurs")
    .update({ omschrijving, bestand_url })
    .eq("id", id)

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// DELETE: Item verwijderen
router.delete("/:id", async (req, res) => {
  const { id } = req.params
  const { error } = await supabase.from("constructeurs").delete().eq("id", id)

  if (error) return res.status(500).json({ error: error.message })
  res.status(204).send()
})

export default router
