import express from 'express'
import { createClient } from '@supabase/supabase-js'
import axios from 'axios'

const router = express.Router()
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const EXECUTOR_URL = process.env.EXECUTOR_URL || 'http://localhost:3000'

/**
 * POST /api/bim/generate-render
 * Start een 3D render job op basis van calculatie materialen
 */
router.post('/', async (req, res) => {
  try {
    const { project_id, calculatie_id, render_type, quality, view_type } = req.body

    if (!project_id) {
      return res.status(400).json({
        success: false,
        error: 'Project ID is vereist'
      })
    }

    // 1. Haal calculatie materialen op
    const materials = await fetchCalculatieMaterials(calculatie_id || project_id)
    
    if (!materials || materials.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Geen materialen gevonden in calculatie'
      })
    }

    // 2. Haal project dimensies op
    const dimensions = await fetchProjectDimensions(project_id)

    // 3. Maak render job in database
    const { data: job, error: jobError } = await supabase
      .from('bim_render_jobs')
      .insert({
        project_id: project_id,
        calculatie_id: calculatie_id,
        render_type: render_type || 'interior',
        quality: quality || 'medium',
        view_type: view_type || 'perspective',
        status: 'pending',
        created_at: new Date().toISOString(),
        materials_count: materials.length,
        estimated_render_time: calculateEstimatedTime(render_type, quality)
      })
      .select()
      .single()

    if (jobError) throw jobError

    // 4. Stuur naar Executor voor verwerking
    const executorResponse = await axios.post(`${EXECUTOR_URL}/api/executor/render-process`, {
      job_id: job.id,
      project_id: project_id,
      materials_data: {
        materials: materials,
        dimensions: dimensions,
        project_info: await fetchProjectInfo(project_id)
      },
      render_type: render_type || 'interior',
      quality: quality || 'medium'
    }, {
      timeout: 10000 // 10 seconden timeout
    })

    // 5. Update job status
    await supabase
      .from('bim_render_jobs')
      .update({
        status: 'processing',
        executor_job_id: executorResponse.data.job_id
      })
      .eq('id', job.id)

    res.json({
      success: true,
      message: 'Render job gestart',
      job_id: job.id,
      estimated_completion: new Date(Date.now() + calculateEstimatedTime(render_type, quality) * 1000).toISOString(),
      poll_endpoint: `/api/bim/generate-render/status/${job.id}`
    })

  } catch (error) {
    console.error('Render generation error:', error)
    
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data || null
    })
  }
})

/**
 * GET /api/bim/generate-render/status/:job_id
 * Check render job status
 */
router.get('/status/:job_id', async (req, res) => {
  try {
    const { job_id } = req.params

    const { data: job, error } = await supabase
      .from('bim_render_jobs')
      .select(`
        *,
        projects (title, client_name)
      `)
      .eq('id', job_id)
      .single()

    if (error) throw error

    // Als job compleet is, haal ook de render URL op
    let render_details = null
    if (job.status === 'completed' && job.render_url) {
      render_details = {
        url: job.render_url,
        metadata: job.render_metadata,
        download_url: await generateDownloadUrl(job.render_url),
        thumbnail_url: await generateThumbnailUrl(job.render_url)
      }
    }

    res.json({
      success: true,
      job: {
        id: job.id,
        project_id: job.project_id,
        project_title: job.projects?.title,
        status: job.status,
        created_at: job.created_at,
        started_at: job.started_at,
        finished_at: job.finished_at,
        render_type: job.render_type,
        quality: job.quality,
        error: job.error,
        render_details: render_details
      }
    })

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * GET /api/bim/generate-render/project/:project_id
 * Haal alle renders voor een project op
 */
router.get('/project/:project_id', async (req, res) => {
  try {
    const { project_id } = req.params
    const { limit = 20, offset = 0 } = req.query

    const { data: renders, error } = await supabase
      .from('bim_render_jobs')
      .select(`
        *,
        calculaties (title)
      `)
      .eq('project_id', project_id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error

    // Voeg download URLs toe
    const rendersWithUrls = renders.map(render => ({
      ...render,
      download_url: render.render_url ? generateDownloadUrl(render.render_url) : null,
      thumbnail_url: render.render_url ? generateThumbnailUrl(render.render_url) : null
    }))

    res.json({
      success: true,
      count: renders.length,
      renders: rendersWithUrls
    })

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * DELETE /api/bim/generate-render/:job_id
 * Verwijder een render job
 */
router.delete('/:job_id', async (req, res) => {
  try {
    const { job_id } = req.params

    // Haal render URL op voor cleanup
    const { data: job } = await supabase
      .from('bim_render_jobs')
      .select('render_url')
      .eq('id', job_id)
      .single()

    // Verwijder uit storage als die bestaat
    if (job?.render_url) {
      await deleteRenderFromStorage(job.render_url)
    }

    // Verwijder uit database
    const { error } = await supabase
      .from('bim_render_jobs')
      .delete()
      .eq('id', job_id)

    if (error) throw error

    res.json({
      success: true,
      message: 'Render job verwijderd'
    })

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// Helper functions
async function fetchCalculatieMaterials(calculatieId) {
  try {
    // Haal materialen uit calculatie
    const { data, error } = await supabase
      .from('calculatie_items')
      .select(`
        material_name,
        material_type,
        quantity,
        unit,
        unit_price,
        material_properties
      `)
      .eq('calculatie_id', calculatieId)
      .not('material_name', 'is', null)

    if (error) throw error

    // Map naar BIM materiaal format
    return data.map(item => ({
      name: item.material_name,
      type: item.material_type || 'unknown',
      quantity: item.quantity,
      unit: item.unit,
      unit_price: item.unit_price,
      properties: item.material_properties || {},
      category: mapMaterialToCategory(item.material_type),
      color: extractMaterialColor(item.material_name, item.material_type),
      roughness: 0.5, // Default
      metallic: 0.0, // Default
      applies_to: mapMaterialToObject(item.material_type)
    }))

  } catch (error) {
    console.error('Error fetching materials:', error)
    return []
  }
}

async function fetchProjectDimensions(projectId) {
  try {
    const { data, error } = await supabase
      .from('project_details')
      .select('width, length, height, floor_count')
      .eq('project_id', projectId)
      .single()

    if (error) {
      // Default dimensies als niet gevonden
      return {
        width: 10,
        length: 8,
        height: 3,
        floor_count: 1
      }
    }

    return data

  } catch (error) {
    return {
      width: 10,
      length: 8,
      height: 3,
      floor_count: 1
    }
  }
}

async function fetchProjectInfo(projectId) {
  const { data, error } = await supabase
    .from('projects')
    .select('title, description, client_name, location')
    .eq('id', projectId)
    .single()

  if (error) return {}

  return data
}

function calculateEstimatedTime(renderType, quality) {
  // Geschatte render tijden in seconden
  const baseTimes = {
    interior: { low: 30, medium: 120, high: 300 },
    exterior: { low: 45, medium: 180, high: 450 },
    topdown: { low: 20, medium: 90, high: 240 }
  }

  const type = renderType || 'interior'
  const qual = quality || 'medium'
  
  return baseTimes[type]?.[qual] || 120
}

function mapMaterialToCategory(materialType) {
  const mapping = {
    'vloer': 'floor',
    'wand': 'wall',
    'plafond': 'ceiling',
    'dak': 'roof',
    'kozijn': 'window',
    'deur': 'door',
    'raam': 'window',
    'beton': 'structure',
    'staal': 'structure',
    'hout': 'structure'
  }
  return mapping[materialType?.toLowerCase()] || 'unknown'
}

function extractMaterialColor(materialName, materialType) {
  // Eenvoudige mapping van materialen naar kleuren
  const colorMap = {
    'hout': [0.65, 0.50, 0.35],
    'beton': [0.85, 0.85, 0.85],
    'steen': [0.55, 0.55, 0.55],
    'baksteen': [0.75, 0.35, 0.25],
    'glas': [0.90, 0.95, 0.98, 0.3],
    'staal': [0.75, 0.75, 0.78],
    'tegels': [0.95, 0.95, 0.95]
  }

  const key = materialType?.toLowerCase() || materialName?.toLowerCase() || ''
  for (const [pattern, color] of Object.entries(colorMap)) {
    if (key.includes(pattern)) {
      return color
    }
  }

  return [0.8, 0.8, 0.8] // Default grijs
}

function mapMaterialToObject(materialType) {
  const mapping = {
    'vloer': 'obj_floor',
    'wand': 'obj_wall',
    'plafond': 'obj_ceiling',
    'dak': 'obj_roof',
    'raam': 'obj_window',
    'deur': 'obj_door'
  }
  return mapping[materialType?.toLowerCase()] || ''
}

async function generateDownloadUrl(renderUrl) {
  // Genereer een direct download URL voor de render
  const url = new URL(renderUrl)
  url.searchParams.set('download', '1')
  return url.toString()
}

async function generateThumbnailUrl(renderUrl) {
  // Genereer een thumbnail URL (in productie zou je een thumbnail service hebben)
  return renderUrl.replace(/\.(png|jpg)$/, '_thumb.$1')
}

async function deleteRenderFromStorage(renderUrl) {
  try {
    const url = new URL(renderUrl)
    const path = url.pathname.split('/').pop()
    
    await supabase.storage
      .from('bim-assets')
      .remove([`renders/${path}`])
  } catch (error) {
    console.error('Error deleting render from storage:', error)
  }
}

export default router
