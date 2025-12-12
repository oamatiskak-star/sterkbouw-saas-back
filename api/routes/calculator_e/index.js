import express from "express"
import supabase from "../../../supabaseClient.js"

const router = express.Router()

// GET: Alle E-installaties ophalen
router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("calculator_e")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// POST: Nieuwe E-installatie toevoegen
router.post("/", async (req, res) => {
  const { project_id, omschrijving, eenheden, prijs_per_eenheid } = req.body

  const { data, error } = await supabase.from("calculator_e").insert([
    {
      project_id,
      omschrijving,
      eenheden,
      prijs_per_eenheid
    }
  ])

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// PUT: E-installatie bijwerken
router.put("/:id", async (req, res) => {
  const { id } = req.params
  const { omschrijving, eenheden, prijs_per_eenheid } = req.body

  const { data, error } = await supabase
    .from("calculator_e")
    .update({ omschrijving, eenheden, prijs_per_eenheid })
    .eq("id", id)

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// DELETE: Verwijderen
router.delete("/:id", async (req, res) => {
  const { id } = req.params
  const { error } = await supabase.from("calculator_e").delete().eq("id", id)

  if (error) return res.status(500).json({ error: error.message })
  res.status(204).send()
})

export default router
