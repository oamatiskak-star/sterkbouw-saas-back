import express from 'express'
import multer from 'multer'
import { supabase } from '@/lib/supabase'
import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const router = express.Router()

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
  limits: { fileSize: 50 * 1024 * 1024 }
})

router.post('/', upload.array('files'), async (req, res) => {
  try {
    const { project_id } = req.body
    const files = req.files

    if (!project_id) {
      return res.status(400).json({
        success: false,
        error: 'Project ID is vereist
