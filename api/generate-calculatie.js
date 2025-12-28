// /api/generate-calculatie.js
import express from 'express'
import { supabase } from '@/lib/supabase'
import { generateCalculatiePDF } from '@/lib/pdf-generator'

const router = express.Router()

router.post('/', async (req, res) => {
  try {
    const calculatieData = req.body
    
    // 1. Genereer PDF
    const pdfResult = await generateCalculatiePDF(calculatieData)
    
    if (!pdfResult.success) {
      throw new Error('PDF generatie mislukt')
    }

    // 2. Update project met PDF URL
    const { error: updateError } = await supabase
      .from('projects')
      .update({
        pdf_url: pdfResult.pdf_url,
        status: 'voltooid',
        updated_at: new Date().toISOString()
      })
      .eq('id', calculatieData.projectInfo.projectId || calculatieData.projectId)

    if (updateError) throw updateError

    res.json({
      success: true,
      pdf_url: pdfResult.pdf_url,
      message: 'Calculatie succesvol gegenereerd'
    })

  } catch (error) {
    console.error('Error generating calculatie:', error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

export default router
