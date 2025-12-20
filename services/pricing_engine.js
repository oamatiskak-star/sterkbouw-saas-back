import { loadStabuPrices } from "../pricing/stabu/price_loader.js"
import { mapStabuPrices } from "../pricing/stabu/price_mapper.js"
import { calculateFixedPrice } from "../pricing/fixed_price/calculator.js"

export async function runPricingEngine({ calculatie }) {
  const stabuCodes = calculatie.flatMap(h =>
    h.posten.map(p => p.stabu_code).filter(Boolean)
  )

  const stabuPrices = await loadStabuPrices(stabuCodes)
  const pricedCalculatie = mapStabuPrices(calculatie, stabuPrices)
  const fixedPrice = calculateFixedPrice(pricedCalculatie)

  return {
    calculatie: pricedCalculatie,
    fixed_price: fixedPrice
  }
}
