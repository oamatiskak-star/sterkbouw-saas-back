export function mapConditionScore(defect) {
  const matrix = {
    gering: 1,
    middel: 3,
    ernstig: 5
  }

  const omvang = {
    lokaal: 1,
    plaatselijk: 2,
    algemeen: 3
  }

  const intensiteit = {
    licht: 1,
    normaal: 2,
    zwaar: 3
  }

  const score =
    matrix[defect.ernst] +
    omvang[defect.omvang] +
    intensiteit[defect.intensiteit]

  return Math.min(Math.max(score, 1), 6)
}
