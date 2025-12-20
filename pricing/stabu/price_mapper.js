export function mapStabuPrices(calculatie, stabuPrices) {
  return calculatie.map(h => ({
    ...h,
    posten: h.posten.map(p => {
      const match = stabuPrices.find(s => s.stabu_code === p.stabu_code)
      return {
        ...p,
        prijs: match ? match.prijs : 0,
        bron: match ? "STABU" : "HANDMATIG"
      }
    })
  }))
}
