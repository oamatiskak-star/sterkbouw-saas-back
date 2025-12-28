import express from 'express'
import { createClient } from '@supabase/supabase-js'

const router = express.Router()
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

/**
 * POST /api/bim/extract-materials
 * Extraheert en analyseert materialen uit een calculatie
 */
router.post('/', async (req, res) => {
  try {
    const { calculatie_id, project_id, include_pricing = true } = req.body

    if (!calculatie_id && !project_id) {
      return res.status(400).json({
        success: false,
        error: 'Calculatie ID of Project ID is vereist'
      })
    }

    // 1. Zoek de juiste calculatie
    const calculatie = await findCalculatie(calculatie_id, project_id)
    if (!calculatie) {
      return res.status(404).json({
        success: false,
        error: 'Calculatie niet gevonden'
      })
    }

    // 2. Haal calculatie items op
    const items = await fetchCalculatieItems(calculatie.id)
    
    if (!items || items.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Geen items gevonden in calculatie'
      })
    }

    // 3. Analyseer en groepeer materialen
    const analysis = analyzeMaterials(items, include_pricing)

    // 4. Sla analyse op voor toekomstig gebruik
    await saveMaterialAnalysis(calculatie.id, analysis)

    res.json({
      success: true,
      calculatie_id: calculatie.id,
      project_id: calculatie.project_id,
      analysis: analysis,
      summary: {
        total_materials: analysis.categories.length,
        unique_materials: analysis.materials.length,
        total_cost: analysis.total_cost,
        average_cost_per_m2: analysis.average_cost_per_m2
      }
    })

  } catch (error) {
    console.error('Material extraction error:', error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * GET /api/bim/extract-materials/:calculatie_id
 * Haal eerder geëxtraheerde materialen op
 */
router.get('/:calculatie_id', async (req, res) => {
  try {
    const { calculatie_id } = req.params

    const { data: analysis, error } = await supabase
      .from('bim_material_analysis')
      .select('*')
      .eq('calculatie_id', calculatie_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (error || !analysis) {
      return res.status(404).json({
        success: false,
        error: 'Geen materialanalyse gevonden'
      })
    }

    res.json({
      success: true,
      analysis: analysis.analysis_data,
      created_at: analysis.created_at
    })

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// Helper functions
async function findCalculatie(calculatieId, projectId) {
  if (calculatieId) {
    const { data, error } = await supabase
      .from('calculaties')
      .select('*')
      .eq('id', calculatieId)
      .single()

    if (!error) return data
  }

  if (projectId) {
    const { data, error } = await supabase
      .from('calculaties')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (!error) return data
  }

  return null
}

async function fetchCalculatieItems(calculatieId) {
  const { data, error } = await supabase
    .from('calculatie_items')
    .select(`
      id,
      position,
      description,
      quantity,
      unit,
      unit_price,
      total_price,
      material_type,
      material_name,
      material_properties,
      category,
      subcategory
    `)
    .eq('calculatie_id', calculatieId)
    .order('position', { ascending: true })

  if (error) throw error
  return data || []
}

function analyzeMaterials(items, includePricing) {
  // Groepeer items per materiaal type
  const materialGroups = {}
  let totalCost = 0
  let totalArea = 0

  items.forEach(item => {
    const materialType = item.material_type || 'overig'
    const materialName = item.material_name || item.description || 'onbekend'
    
    if (!materialGroups[materialType]) {
      materialGroups[materialType] = {
        name: materialType,
        items: [],
        total_quantity: 0,
        total_cost: 0,
        variants: new Set()
      }
    }

    const group = materialGroups[materialType]
    group.items.push({
      id: item.id,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unit_price: includePricing ? item.unit_price : null,
      total_price: includePricing ? item.total_price : null,
      properties: item.material_properties || {}
    })

    group.total_quantity += item.quantity || 0
    group.total_cost += item.total_price || 0
    group.variants.add(materialName)

    totalCost += item.total_price || 0
    
    // Bereken oppervlakte voor vloer/wand materialen
    if (item.unit === 'm2') {
      totalArea += item.quantity || 0
    }
  })

  // Converteer naar array en sorteer op kosten
  const categories = Object.values(materialGroups)
    .map(group => ({
      ...group,
      variants: Array.from(group.variants),
      average_unit_price: group.total_quantity > 0 ? group.total_cost / group.total_quantity : 0
    }))
    .sort((a, b) => b.total_cost - a.total_cost)

  // Extract unieke materialen voor BIM
  const uniqueMaterials = extractUniqueMaterials(categories)

  return {
    categories: categories,
    materials: uniqueMaterials,
    total_cost: totalCost,
    total_area: totalArea,
    average_cost_per_m2: totalArea > 0 ? totalCost / totalArea : 0,
    material_distribution: calculateDistribution(categories, totalCost),
    timestamp: new Date().toISOString()
  }
}

function extractUniqueMaterials(categories) {
  const materials = []

  categories.forEach(category => {
    category.variants.forEach(variantName => {
      const sampleItem = category.items.find(item => 
        (item.description || '').includes(variantName) ||
        (category.name.includes(variantName))
      )

      if (sampleItem) {
        materials.push({
          name: variantName,
          category: mapToBIMCategory(category.name),
          type: category.name,
          unit: sampleItem.unit,
          average_price: sampleItem.unit_price,
          properties: sampleItem.properties,
          color: determineMaterialColor(variantName),
          texture: determineMaterialTexture(variantName),
          roughness: determineRoughness(variantName),
          metallic: determineMetallic(variantName)
        })
      }
    })
  })

  return materials
}

function mapToBIMCategory(materialType) {
  const mapping = {
    'vloer': 'floor',
    'wand': 'wall', 
    'plafond': 'ceiling',
    'dak': 'roof',
    'kozijn': 'window',
    'deur': 'door',
    'raam': 'window',
    'beton': 'structure',
    'metselwerk': 'wall',
    'isolatie': 'insulation',
    'afwerking': 'finish',
    'elektra': 'electrical',
    'sanitair': 'plumbing',
    'verwarming': 'hvac'
  }

  const lowerType = materialType.toLowerCase()
  for (const [key, value] of Object.entries(mapping)) {
    if (lowerType.includes(key)) {
      return value
    }
  }

  return 'other'
}

function determineMaterialColor(materialName) {
  const colorMap = {
    'eik': [0.65, 0.50, 0.35],
    'grenen': [0.70, 0.55, 0.40],
    'beton': [0.85, 0.85, 0.85],
    'baksteen': [0.75, 0.35, 0.25],
    'pleister': [0.95, 0.95, 0.95],
    'tegel': [0.90, 0.90, 0.90],
    'glas': [0.90, 0.95, 0.98, 0.3],
    'staal': [0.75, 0.75, 0.78],
    'aluminium': [0.85, 0.85, 0.88],
    'zink': [0.80, 0.80, 0.82]
  }

  const lowerName = materialName.toLowerCase()
  for (const [key, color] of Object.entries(colorMap)) {
    if (lowerName.includes(key)) {
      return color
    }
  }

  return [0.8, 0.8, 0.8] // Default grijs
}

function determineMaterialTexture(materialName) {
  const textureMap = {
    'eik': 'wood_oak',
    'grenen': 'wood_pine',
    'beton': 'concrete',
    'baksteen': 'brick',
    'pleister': 'plaster',
    'tegel': 'tile',
    'glas': 'glass',
    'staal': 'metal'
  }

  const lowerName = materialName.toLowerCase()
  for (const [key, texture] of Object.entries(textureMap)) {
    if (lowerName.includes(key)) {
      return texture
    }
  }

  return 'generic'
}

function determineRoughness(materialName) {
  const roughnessMap = {
    'glas': 0.0,
    'staal': 0.1,
    'aluminium': 0.2,
    'tegel': 0.3,
    'pleister': 0.4,
    'eik': 0.6,
    'beton': 0.7,
    'baksteen': 0.8
  }

  const lowerName = materialName.toLowerCase()
  for (const [key, roughness] of Object.entries(roughnessMap)) {
    if (lowerName.includes(key)) {
      return roughness
    }
  }

  return 0.5 // Default
}

function determineMetallic(materialName) {
  const metallicMap = {
    'staal': 1.0,
    'aluminium': 0.8,
    'zink': 0.7,
    'koper': 0.9,
    'glas': 0.0,
    'hout': 0.0,
    'beton': 0.0,
    'steen': 0.0
  }

  const lowerName = materialName.toLowerCase()
  for (const [key, metallic] of Object.entries(metallicMap)) {
    if (lowerName.includes(key)) {
      return metallic
    }
  }

  return 0.0 // Default
}

function calculateDistribution(categories, totalCost) {
  return categories.map(category => ({
    category: category.name,
    percentage: totalCost > 0 ? (category.total_cost / totalCost) * 100 : 0,
    cost: category.total_cost,
    quantity: category.total_quantity
  }))
}

async function saveMaterialAnalysis(calculatieId, analysis) {
  try {
    await supabase
      .from('bim_material_analysis')
      .insert({
        calculatie_id: calculatieId,
        analysis_data: analysis,
        created_at: new Date().toISOString()
      })
  } catch (error) {
    console.error('Error saving material analysis:', error)
  }
}

export default router
