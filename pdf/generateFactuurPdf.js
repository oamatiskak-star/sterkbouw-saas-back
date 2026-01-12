import PDFDocument from "pdfkit"
import fs from "fs"

export async function generateFactuurPdf(data, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 40 })
      const stream = fs.createWriteStream(outputPath)
      doc.pipe(stream)

      const header = data?.header || {}
      const regels = Array.isArray(data?.regels) ? data.regels : []
      const btw = Array.isArray(data?.btw) ? data.btw : []
      const totalen = data?.totalen || {}

      doc.font("Helvetica-Bold").fontSize(14).text(header.bedrijfsnaam || "Factuur")
      doc.font("Helvetica").fontSize(10)
      doc.text(header.adres || "")
      doc.text([header.postcode, header.plaats].filter(Boolean).join(" "))
      doc.moveDown()

      doc.text(`Factuurnummer: ${header.factuurnummer || ""}`)
      doc.text(`Factuurdatum: ${header.datum || ""}`)
      doc.text(`Projectnummer: ${header.projectnummer || ""}`)
      if (header.kvk) doc.text(`KVK: ${header.kvk}`)
      if (header.btw) doc.text(`BTW: ${header.btw}`)
      doc.moveDown()

      doc.font("Helvetica-Bold").text("Regels")
      doc.font("Helvetica").fontSize(9)
      let y = doc.y + 6

      doc.text("Code", 40, y)
      doc.text("Omschrijving", 90, y)
      doc.text("Aantal", 320, y, { width: 40, align: "right" })
      doc.text("Eenheid", 365, y, { width: 40, align: "right" })
      doc.text("Totaal", 460, y, { width: 80, align: "right" })
      y += 12

      regels.forEach(r => {
        doc.text(r.code || "", 40, y)
        doc.text(r.omschrijving || "", 90, y, { width: 210 })
        doc.text(String(r.aantal ?? ""), 320, y, { width: 40, align: "right" })
        doc.text(r.eenheid || "", 365, y, { width: 40, align: "right" })
        doc.text(String(r.totaal ?? ""), 460, y, { width: 80, align: "right" })
        y += 12
        if (y > 740) {
          doc.addPage()
          y = 60
        }
      })

      doc.moveDown(2)
      doc.font("Helvetica-Bold").fontSize(10).text("BTW")
      doc.font("Helvetica").fontSize(9)
      btw.forEach(row => {
        const label = row?.percentage ? `BTW ${row.percentage}%` : "BTW"
        const bedrag = row?.bedrag ?? row?.amount ?? ""
        doc.text(`${label}: ${bedrag}`)
      })

      doc.moveDown()
      doc.font("Helvetica-Bold").text("Totalen")
      doc.font("Helvetica").fontSize(10)
      doc.text(`Excl. BTW: ${totalen.excl ?? ""}`)
      doc.text(`BTW: ${totalen.btw ?? ""}`)
      doc.text(`Incl. BTW: ${totalen.incl ?? ""}`)

      doc.end()

      stream.on("finish", resolve)
      stream.on("error", reject)
    } catch (err) {
      reject(err)
    }
  })
}
