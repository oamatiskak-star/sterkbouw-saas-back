export function drawBtwBlock(doc, btwRows, startY) {
  let y = startY

  doc.font("Helvetica").fontSize(8)

  btwRows.forEach(row => {
    doc.text(`BTW ${row.btw_pct * 100}% over ${row.grondslag}`, 300, y)
    doc.text(row.btw, 455, y, { align: "right" })
    y += 12
  })

  return y
}
