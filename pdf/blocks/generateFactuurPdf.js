import PDFDocument from "pdfkit"
import fs from "fs"
import { drawHeader } from "./blocks/header.js"
import { drawRegel } from "./blocks/regels.js"
import { drawBtwBlock } from "./blocks/btw.js"
import { drawTotalen } from "./blocks/totalen.js"

export async function generateFactuurPdf(data, outputPath) {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 42, left: 57, right: 42, bottom: 42 }
  })

  doc.pipe(fs.createWriteStream(outputPath))
  doc.font("Helvetica").fontSize(8)

  drawHeader(doc, data.header)

  let y = 140

  data.regels.forEach(r => {
    drawRegel(doc, y, r)
    y += 12
    if (y > 760) {
      doc.addPage()
      y = 120
    }
  })

  y += 20
  y = drawBtwBlock(doc, data.btw, y)
  y += 10
  drawTotalen(doc, data.totalen, y)

  doc.end()
}
