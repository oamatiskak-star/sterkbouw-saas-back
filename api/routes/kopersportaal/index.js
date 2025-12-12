import express from "express"
import supabase from "../../../supabaseClient.js"

const router = express.Router()

// GET: Alle kopersvragen ophalen
router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("kopersportaal")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// POST: Nieuwe vraag of bericht van koper
router.post("/", async (req, res) => {
  const { koper_id, project_id, categorie, bericht, status } = req.body

  const { data, error } = await supabase.from("kopersportaal").insert([
    {
      koper_id,
      project_id,
      categorie,
      bericht,
      status
    }
  ])

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// PUT: Status of bericht bijwerken
router.put("/:id", async (req, res) => {
  const { id } = req.params
  const { bericht, status } = req.body

  const { data, error } = await supabase
    .from("kopersportaal")
    .update({ bericht, status })
    .eq("id", id)

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// DELETE: Bericht verwijderen
router.delete("/:id", async (req, res) => {
  const { id } = req.params
  const { error } = await supabase.from("kopersportaal").delete().eq("id", id)

  if (error) return res.status(500).json({ error: error.message })
  res.status(204).send()
})

export default router
