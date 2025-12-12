import express from "express"
import supabase from "../../../supabaseClient.js"

const router = express.Router()

// GET: Alle notificaties ophalen
router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("notificaties")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// POST: Nieuwe notificatie aanmaken
router.post("/", async (req, res) => {
  const { titel, bericht } = req.body

  const { data, error } = await supabase.from("notificaties").insert([
    {
      titel,
      bericht
    }
  ])

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// PUT: Notificatie bewerken
router.put("/:id", async (req, res) => {
  const { id } = req.params
  const { titel, bericht } = req.body

  const { data, error } = await supabase
    .from("notificaties")
    .update({ titel, bericht })
    .eq("id", id)

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// DELETE: Notificatie verwijderen
router.delete("/:id", async (req, res) => {
  const { id } = req.params
  const { error } = await supabase.from("notificaties").delete().eq("id", id)

  if (error) return res.status(500).json({ error: error.message })
  res.status(204).send()
})

export default router
