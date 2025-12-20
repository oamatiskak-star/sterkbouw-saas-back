export function classifyDefects(inputs) {
  return inputs.map(i => ({
    element: i.element,
    gebrek: i.gebrek,
    ernst: i.ernst || "middel",
    omvang: i.omvang || "lokaal",
    intensiteit: i.intensiteit || "normaal"
  }))
}
