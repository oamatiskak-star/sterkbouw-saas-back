export default function assumptions(doc, data) {
  doc.addPage()
  doc.fontSize(16).text("Aannames")
  doc.moveDown()

  data.assumptions.forEach(a => {
    doc.fontSize(11).text(
      `${a.onderwerp}: ${a.aanname} (bron: ${a.bron}, risico: ${a.risiconiveau})`
    )
    doc.moveDown(0.5)
  })
}
