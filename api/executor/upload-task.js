// /api/executor/upload-task.js
import express from 'express'
import multer from 'multer'
import { supabase } from '@/lib/supabase'
import fs from 'fs'
import path from 'path'

const router = express.Router()

// Configure multer voor file upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'public', 'uploads')
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }
    cb(null, uploadDir)
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}_${file.originalname}`
    cb(null, uniqueName)
  }
})

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max
})

router.post('/', upload.array('files'), async (req, res) => {
  try {
    const { project_id } = req.body
    const files = req.files

    if (!project_id) {
      return res.status(400).json({
        success: false,
        error: 'Project ID is vereist'
      })
    }

    // Opslaan van bestandsinformatie in database
    const fileRecords = files.map(file => ({
      project_id: project_id,
      filename: file.originalname,
      filepath: `/uploads/${file.filename}`,
      mime_type: file.mimetype,
      size: file.size
    }))

    const { error: uploadError } = await supabase
      .from('project_files')
      .insert(fileRecords)

    if (uploadError) throw uploadError

    // Update project status
    await supabase
      .from('projects')
      .update({
        status: 'bestanden_geupload',
        updated_at: new Date().toISOString()
      })
      .eq('id', project_id)

    res.json({
      success: true,
      files: fileRecords,
      message: `${files.length} bestand(en) succesvol geüpload`
    })

  } catch (error) {
    console.error('Error uploading files:', error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

export default router
