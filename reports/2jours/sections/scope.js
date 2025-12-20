export default function scope(doc, data) {
  doc.addPage()
  doc.fontSize(16).text("Scope en uitgangspunten")
  doc.moveDown()

  data.scope.forEach(item => {
    doc.fontSize(11).text(`• ${item}`)
  })
}
