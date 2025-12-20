export default function risks(doc, data) {
  doc.addPage()
  doc.fontSize(16).text("Risicoanalyse")
  doc.moveDown()

  data.risks.forEach(r => {
    doc.fontSize(11).text(`• ${r.omschrijving} (${r.niveau})`)
  })
}
