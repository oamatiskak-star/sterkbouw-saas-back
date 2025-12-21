import { createClient } from "@supabase/supabase-js"
import PDFDocument from "pdfkit"

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  const {
    query: { id }
  } = req

  if (!id) {
    res.status(400).send("Geen calculatie ID")
    return
  }

  const { data: calculatie, error } = await supabase
    .from("calculaties")
    .select(`
      naam_opdrachtgever,
      omschrijving,
      adres,
      postcode,
      plaatsnaam,
      land,
      telefoon,
      project_type,
      opmerking
    `)
    .eq("id", id)
    .single()

  if (error || !calculatie) {
    res.status(404).send("Calculatie niet gevonden")
    return
  }

  const doc = new PDFDocument({ margin: 50 })

  res.setHeader("Content-Type", "application/pdf")
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=calculatie_${id}.pdf`
  )

  doc.pipe(res)

  doc.fontSize(18).text("Calculatie", { underline: true })
  doc.moveDown()

  doc.fontSize(12).text("Projectgegevens")
  doc.moveDown(0.5)

  doc.text(`Opdrachtgever: ${calculatie.naam_opdrachtgever || ""}`)
  doc.text(`Adres: ${calculatie.adres || ""}`)
  doc.text(`Postcode: ${calculatie.postcode || ""}`)
  doc.text(`Plaats: ${calculatie.plaatsnaam || ""}`)
  doc.text(`Land: ${calculatie.land || ""}`)
  doc.text(`Telefoon: ${calculatie.telefoon || ""}`)
  doc.moveDown()

  doc.text(`Projecttype: ${calculatie.project_type || ""}`)
  doc.moveDown()

  doc.text("Omschrijving:")
  doc.text(calculatie.omschrijving || "-")
  doc.moveDown()

  if (calculatie.opmerking) {
    doc.text("Opmerking:")
    doc.text(calculatie.opmerking)
  }

  doc.end()
}
