import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function loadStabuPrices(stabuCodes) {
  const { data, error } = await supabase
    .from("stabu_prices")
    .select("*")
    .in("stabu_code", stabuCodes)

  if (error) throw error
  return data
}
