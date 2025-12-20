import PDFDocument from "pdfkit"
import fs from "fs"

export async function generateCalculatiePdf(data, outputPath) {
  const doc = new PDFDocument({ size: "A4", margin: 40 })
  doc.pipe(fs.createWriteStream(outputPath))
  doc.font("Helvetica").fontSize(8)

  let y = 80
  data.forEach(r => {
    doc.text(r.code, 40, y)
    doc.text(r.omschrijving, 80, y)
    doc.text(r.hoeveelheid, 260, y, { align: "right" })
    doc.text(r.normuren, 300, y, { align: "right" })
    doc.text(r.loonkosten, 360, y, { align: "right" })
    doc.text(r.materiaalprijs, 420, y, { align: "right" })
    doc.text(r.regel_totaal, 480, y, { align: "right" })
    y += 12
    if (y > 760) { doc.addPage(); y = 80 }
  })

  doc.end()
}
