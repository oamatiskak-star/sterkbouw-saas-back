import { FIXED_PRICE_RULES } from "./rules.js"

export function calculateFixedPrice(calculatie) {
  let subtotaal = 0

  calculatie.forEach(h => {
    h.posten.forEach(p => {
      const totaal = p.hoeveelheid * (p.prijs || 0)
      p.totaal = totaal
      subtotaal += totaal
    })
  })

  const ak = subtotaal * FIXED_PRICE_RULES.opslagen.ak
  const abk = subtotaal * FIXED_PRICE_RULES.opslagen.abk
  const wr = subtotaal * FIXED_PRICE_RULES.opslagen.wr
  const risico = subtotaal * FIXED_PRICE_RULES.risico_reserve

  const eindprijs = Math.ceil(subtotaal + ak + abk + wr + risico)

  return {
    subtotaal,
    opslagen: { ak, abk, wr, risico },
    eindprijs
  }
}
