import { Router } from "express"
import { createClient } from "@supabase/supabase-js"

const router = Router()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

router.post("/", async (req, res) => {
  try {
    const body = req.body || {}
    const name = body.naam ?? body.name

    if (!name) {
      return res.status(400).json({ error: "CUSTOMER_NAME_REQUIRED" })
    }

    const customerData = {
      naam: name,
      adres: body.adres ?? body.address ?? null,
      postcode: body.postcode ?? null,
      plaatsnaam: body.plaatsnaam ?? body.city ?? null,
      land: body.land ?? body.country ?? "Nederland",
      telefoon: body.telefoon ?? body.phone ?? null,
      email: body.email ?? null
    }

    const { data, error } = await supabase
      .from("customers")
      .insert(customerData)
      .select("id")
      .single()

    if (error) {
      return res.status(500).json({ error: error.message })
    }

    return res.json({ customer_id: data.id })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

export default router
