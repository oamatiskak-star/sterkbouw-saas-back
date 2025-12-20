export function drawTotalen(doc, totalen, y) {
  doc.font("Helvetica").fontSize(8)
  doc.text("Subtotaal excl. BTW", 300, y)
  doc.text(totalen.excl, 455, y, { align: "right" })

  y += 12

  doc.text("Totaal BTW", 300, y)
  doc.text(totalen.btw, 455, y, { align: "right" })

  y += 14

  doc.font("Helvetica-Bold").fontSize(9)
  doc.text("Totaal te betalen", 300, y)
  doc.text(totalen.incl, 455, y, { align: "right" })

  doc.font("Helvetica").fontSize(8)
}
