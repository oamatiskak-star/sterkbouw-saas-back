export default function calculationStructure(doc, data) {
  doc.addPage()
  doc.fontSize(16).text("Calculatiestructuur")
  doc.moveDown()

  data.calculatie.forEach(h => {
    doc.fontSize(13).text(h.hoofdstuk)
    doc.moveDown(0.3)

    h.posten.forEach(p => {
      doc.fontSize(11).text(
        `- ${p.naam}: ${p.hoeveelheid} ${p.eenheid}`
      )
    })

    doc.moveDown()
  })
}
