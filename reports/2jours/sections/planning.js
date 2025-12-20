export default function planning(doc, data) {
  doc.addPage()
  doc.fontSize(16).text("Planning (indicatief)")
  doc.moveDown()

  data.planning.forEach(p => {
    doc.fontSize(11).text(`${p.fase}: ${p.start} – ${p.eind}`)
  })
}
