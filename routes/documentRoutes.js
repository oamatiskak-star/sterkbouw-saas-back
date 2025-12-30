// Backend/routes/documentRoutes.js
import express from 'express';
import { authenticateToken, requireRole, requireProjectAccess, authorizeClient } from '../middleware/auth.js';
import { validateFileUpload } from '../middleware/validation.js';
import { auditLog } from '../utils/auditLogger.js';
import notificationService from '../services/notificationService.js';
import { supabase } from '../config/database.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = express.Router();

// Configure multer for different document types
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let folder = 'documents';
    
    // Organize by document type
    if (req.body.type === 'drawing') folder = 'drawings';
    else if (req.body.type === 'contract') folder = 'contracts';
    else if (req.body.type === 'report') folder = 'reports';
    else if (req.body.type === 'photo') folder = 'photos';
    
    const uploadPath = path.join(__dirname, `../../uploads/${folder}`);
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(7);
    const originalName = path.parse(file.originalname).name;
    const extension = path.extname(file.originalname);
    
    // Create SEO-friendly filename
    const safeName = originalName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 100);
    
    cb(null, `${safeName}-${timestamp}-${randomString}${extension}`);
  }
});

const upload = multer({ 
  storage,
  limits: { 
    fileSize: 50 * 1024 * 1024, // 50MB max
    files: 10 // Max 10 files per upload
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'application/zip',
      'application/x-rar-compressed',
      'model/step', // 3D models
      'application/octet-stream' // Fallback for CAD files
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Bestandstype niet toegestaan: ${file.mimetype}`), false);
    }
  }
});

/**
 * @route   POST /api/documents/upload
 * @desc    Upload document naar specifiek project
 * @access  Private
 */
router.post('/upload', 
  authenticateToken, 
  requireProjectAccess,
  upload.array('files', 10),
  validateFileUpload({ maxSize: 50 * 1024 * 1024 }),
  async (req, res) => {
    try {
      const { projectId } = req.body;
      const userId = req.user.id;
      const userRole = req.user.role;
      
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          error: 'Geen bestanden geüpload',
          code: 'NO_FILES_UPLOADED'
        });
      }

      if (!projectId) {
        return res.status(400).json({
          error: 'Project ID is verplicht',
          code: 'PROJECT_ID_REQUIRED'
        });
      }

      const documents = [];
      const errors = [];

      // Process each uploaded file
      for (const file of req.files) {
        try {
          // Determine document type from extension if not provided
          let documentType = req.body.type || 'other';
          if (!documentType || documentType === 'auto') {
            documentType = determineDocumentType(file);
          }

          // Determine category
          let category = req.body.category || 'general';
          if (req.body.category === 'auto') {
            category = determineCategory(documentType, file.originalname);
          }

          // Generate thumbnail for images
          let thumbnailUrl = null;
          if (file.mimetype.startsWith('image/')) {
            thumbnailUrl = await generateThumbnail(file);
          }

          // Create document record
          const documentData = {
            project_id: projectId,
            title: req.body.title || path.parse(file.originalname).name,
            description: req.body.description || '',
            file_name: file.originalname,
            file_path: `/uploads/${getFolderFromType(documentType)}/${file.filename}`,
            file_url: `${process.env.API_URL || 'http://localhost:3001'}/uploads/${getFolderFromType(documentType)}/${file.filename}`,
            thumbnail_url: thumbnailUrl,
            file_type: file.mimetype,
            file_size: file.size,
            type: documentType,
            category: category,
            tags: req.body.tags ? JSON.parse(req.body.tags) : [],
            version: req.body.version || '1.0',
            revision: req.body.revision || 'A',
            uploaded_by: userId,
            shared_with_clients: req.body.shared_with_clients === 'true' || userRole === 'client',
            requires_approval: req.body.requires_approval === 'true',
            approval_status: req.body.requires_approval === 'true' ? 'pending' : 'not_required',
            metadata: {
              originalName: file.originalname,
              encoding: file.encoding,
              dimensions: req.body.dimensions,
              scale: req.body.scale,
              software: req.body.software,
              author: req.body.author
            },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };

          const { data: document, error: dbError } = await supabase
            .from('project_documents')
            .insert([documentData])
            .select()
            .single();

          if (dbError) {
            errors.push({
              fileName: file.originalname,
              error: dbError.message
            });
            continue;
          }

          documents.push(document);

          // If this is a drawing, link it to the project
          if (documentType === 'drawing') {
            await linkDrawingToProject(document.id, projectId, req.body);
          }

        } catch (fileError) {
          errors.push({
            fileName: file.originalname,
            error: fileError.message
          });
        }
      }

      // Send notifications for successful uploads
      if (documents.length > 0) {
        await sendUploadNotifications(projectId, documents, userId);
      }

      // Audit log
      await auditLog('DOCUMENTS_UPLOADED', {
        projectId,
        userId,
        userRole,
        successful: documents.length,
        failed: errors.length,
        documentTypes: documents.map(d => d.type),
        totalSize: documents.reduce((sum, doc) => sum + doc.file_size, 0)
      });

      res.json({
        success: true,
        message: `${documents.length} documenten succesvol geüpload`,
        documents,
        errors: errors.length > 0 ? errors : undefined,
        summary: {
          total: req.files.length,
          successful: documents.length,
          failed: errors.length
        }
      });

    } catch (error) {
      console.error('Upload documents error:', error);
      res.status(500).json({ 
        error: 'Kon documenten niet uploaden',
        code: 'UPLOAD_DOCUMENTS_FAILED',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

/**
 * @route   GET /api/documents/project/:projectId
 * @desc    Haal alle documenten op voor een project
 * @access  Private
 */
router.get('/project/:projectId', 
  authenticateToken, 
  requireProjectAccess,
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const userId = req.user.id;
      const userRole = req.user.role;
      
      const { 
        type, 
        category, 
        search, 
        limit = 100, 
        offset = 0,
        sortBy = 'created_at',
        sortOrder = 'desc',
        showOnlyShared = false
      } = req.query;

      // Build query
      let query = supabase
        .from('project_documents')
        .select(`
          *,
          uploaded_by_user:users (full_name, email, avatar_url),
          approved_by_user:users!project_documents_approved_by_fkey (full_name)
        `, { count: 'exact' })
        .eq('project_id', projectId);

      // Apply filters
      if (type) {
        const types = Array.isArray(type) ? type : [type];
        query = query.in('type', types);
      }

      if (category) {
        query = query.eq('category', category);
      }

      if (search) {
        query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%,file_name.ilike.%${search}%`);
      }

      // For clients: only show shared documents
      if (userRole === 'client' || showOnlyShared === 'true') {
        query = query.eq('shared_with_clients', true);
      }

      // Apply sorting
      const validSortFields = ['created_at', 'updated_at', 'title', 'file_size', 'version'];
      const sortField = validSortFields.includes(sortBy) ? sortBy : 'created_at';
      const sortDir = sortOrder === 'asc' ? 'asc' : 'desc';
      
      query = query.order(sortField, { ascending: sortDir === 'asc' });

      // Apply pagination
      query = query.range(offset, offset + parseInt(limit) - 1);

      const { data: documents, error, count } = await query;

      if (error) throw error;

      // Get document statistics
      const stats = await getDocumentStatistics(projectId, userRole, userId);

      await auditLog('DOCUMENTS_FETCHED', {
        projectId,
        userId,
        userRole,
        count: documents?.length || 0,
        filters: { type, category, search }
      });

      res.json({
        success: true,
        documents: documents || [],
        stats,
        pagination: {
          total: count || 0,
          limit: parseInt(limit),
          offset: parseInt(offset)
        }
      });

    } catch (error) {
      console.error('Get documents error:', error);
      res.status(500).json({ 
        error: 'Kon documenten niet ophalen',
        code: 'FETCH_DOCUMENTS_FAILED'
      });
    }
  }
);

/**
 * @route   GET /api/documents/:documentId
 * @desc    Haal specifiek document op
 * @access  Private
 */
router.get('/:documentId', 
  authenticateToken, 
  async (req, res) => {
    try {
      const { documentId } = req.params;
      const userId = req.user.id;
      const userRole = req.user.role;

      // Get document with details
      const { data: document, error } = await supabase
        .from('project_documents')
        .select(`
          *,
          project:projects (
            id,
            name,
            project_leader_id
          ),
          uploaded_by_user:users (full_name, email, avatar_url),
          approved_by_user:users!project_documents_approved_by_fkey (full_name),
          version_history:document_versions (*),
          comments:document_comments (
            *,
            user:users (full_name, avatar_url)
          )
        `)
        .eq('id', documentId)
        .single();

      if (error || !document) {
        return res.status(404).json({
          error: 'Document niet gevonden',
          code: 'DOCUMENT_NOT_FOUND'
        });
      }

      // Check access
      const hasAccess = await checkDocumentAccess(userId, userRole, document);
      if (!hasAccess) {
        return res.status(403).json({
          error: 'Geen toegang tot dit document',
          code: 'NO_DOCUMENT_ACCESS'
        });
      }

      // Track view
      await trackDocumentView(documentId, userId);

      // Increment download count (for statistics)
      await supabase
        .from('project_documents')
        .update({ view_count: (document.view_count || 0) + 1 })
        .eq('id', documentId);

      await auditLog('DOCUMENT_VIEWED', {
        documentId,
        projectId: document.project_id,
        userId,
        userRole,
        documentType: document.type
      });

      res.json({
        success: true,
        document
      });

    } catch (error) {
      console.error('Get document error:', error);
      res.status(500).json({ 
        error: 'Kon document niet ophalen',
        code: 'FETCH_DOCUMENT_FAILED'
      });
    }
  }
);

/**
 * @route   GET /api/documents/:documentId/download
 * @desc    Download document
 * @access  Private
 */
router.get('/:documentId/download', 
  authenticateToken, 
  async (req, res) => {
    try {
      const { documentId } = req.params;
      const userId = req.user.id;
      const userRole = req.user.role;

      // Get document info
      const { data: document, error } = await supabase
        .from('project_documents')
        .select('*')
        .eq('id', documentId)
        .single();

      if (error || !document) {
        return res.status(404).json({
          error: 'Document niet gevonden',
          code: 'DOCUMENT_NOT_FOUND'
        });
      }

      // Check access
      const hasAccess = await checkDocumentAccess(userId, userRole, document);
      if (!hasAccess) {
        return res.status(403).json({
          error: 'Geen toegang tot dit document',
          code: 'NO_DOCUMENT_ACCESS'
        });
      }

      // Check if file exists
      const filePath = path.join(__dirname, '../..', document.file_path);
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          error: 'Document bestand niet gevonden op server',
          code: 'FILE_NOT_FOUND'
        });
      }

      // Track download
      await trackDocumentDownload(documentId, userId, req);

      // Update download count
      await supabase
        .from('project_documents')
        .update({ 
          download_count: (document.download_count || 0) + 1,
          last_downloaded_at: new Date().toISOString()
        })
        .eq('id', documentId);

      await auditLog('DOCUMENT_DOWNLOADED', {
        documentId,
        projectId: document.project_id,
        userId,
        userRole,
        fileName: document.file_name,
        fileSize: document.file_size
      });

      // Send file
      res.download(filePath, document.file_name, (err) => {
        if (err) {
          console.error('Download error:', err);
        }
      });

    } catch (error) {
      console.error('Download document error:', error);
      res.status(500).json({ 
        error: 'Kon document niet downloaden',
        code: 'DOWNLOAD_DOCUMENT_FAILED'
      });
    }
  }
);

/**
 * @route   PUT /api/documents/:documentId
 * @desc    Update document metadata
 * @access  Private
 */
router.put('/:documentId', 
  authenticateToken, 
  async (req, res) => {
    try {
      const { documentId } = req.params;
      const userId = req.user.id;
      const userRole = req.user.role;
      const updates = req.body;

      // Get current document
      const { data: currentDocument, error: fetchError } = await supabase
        .from('project_documents')
        .select('*')
        .eq('id', documentId)
        .single();

      if (fetchError || !currentDocument) {
        return res.status(404).json({
          error: 'Document niet gevonden',
          code: 'DOCUMENT_NOT_FOUND'
        });
      }

      // Check permission to edit
      const canEdit = await checkDocumentEditPermission(userId, userRole, currentDocument);
      if (!canEdit) {
        return res.status(403).json({
          error: 'Geen toestemming om dit document te bewerken',
          code: 'NO_EDIT_PERMISSION'
        });
      }

      // Prepare update data
      const updateData = {
        ...updates,
        updated_at: new Date().toISOString(),
        updated_by: userId
      };

      // If version is being updated, create version history
      if (updates.version && updates.version !== currentDocument.version) {
        await createDocumentVersion(currentDocument);
      }

      // Update document
      const { data: updatedDocument, error: updateError } = await supabase
        .from('project_documents')
        .update(updateData)
        .eq('id', documentId)
        .select()
        .single();

      if (updateError) throw updateError;

      await auditLog('DOCUMENT_UPDATED', {
        documentId,
        projectId: currentDocument.project_id,
        userId,
        userRole,
        changes: Object.keys(updates),
        oldVersion: currentDocument.version,
        newVersion: updatedDocument.version
      });

      res.json({
        success: true,
        message: 'Document succesvol bijgewerkt',
        document: updatedDocument
      });

    } catch (error) {
      console.error('Update document error:', error);
      res.status(500).json({ 
        error: 'Kon document niet bijwerken',
        code: 'UPDATE_DOCUMENT_FAILED'
      });
    }
  }
);

/**
 * @route   DELETE /api/documents/:documentId
 * @desc    Verwijder document
 * @access  Private (Admin, Manager, Project Leader)
 */
router.delete('/:documentId', 
  authenticateToken, 
  requireRole('admin', 'manager', 'project_leader'),
  async (req, res) => {
    try {
      const { documentId } = req.params;
      const userId = req.user.id;

      // Get document info for logging
      const { data: document, error: fetchError } = await supabase
        .from('project_documents')
        .select('*')
        .eq('id', documentId)
        .single();

      if (fetchError || !document) {
        return res.status(404).json({
          error: 'Document niet gevonden',
          code: 'DOCUMENT_NOT_FOUND'
        });
      }

      // Delete from database
      const { error: deleteError } = await supabase
        .from('project_documents')
        .delete()
        .eq('id', documentId);

      if (deleteError) throw deleteError;

      // Optionally delete physical file (commented for safety)
      // const filePath = path.join(__dirname, '../..', document.file_path);
      // if (fs.existsSync(filePath)) {
      //   fs.unlinkSync(filePath);
      // }

      await auditLog('DOCUMENT_DELETED', {
        documentId,
        projectId: document.project_id,
        deletedBy: userId,
        fileName: document.file_name,
        fileSize: document.file_size,
        documentType: document.type
      });

      res.json({
        success: true,
        message: 'Document succesvol verwijderd',
        deletedDocument: {
          id: documentId,
          fileName: document.file_name,
          deletedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('Delete document error:', error);
      res.status(500).json({ 
        error: 'Kon document niet verwijderen',
        code: 'DELETE_DOCUMENT_FAILED'
      });
    }
  }
);

/**
 * @route   POST /api/documents/:documentId/approve
 * @desc    Keur document goed (voor projectleider)
 * @access  Private (Projectleider, Manager, Admin)
 */
router.post('/:documentId/approve', 
  authenticateToken, 
  requireRole('project_leader', 'manager', 'admin'),
  async (req, res) => {
    try {
      const { documentId } = req.params;
      const userId = req.user.id;
      const { comments, version } = req.body;

      const { data: document, error: fetchError } = await supabase
        .from('project_documents')
        .select('*')
        .eq('id', documentId)
        .single();

      if (fetchError || !document) {
        return res.status(404).json({
          error: 'Document niet gevonden',
          code: 'DOCUMENT_NOT_FOUND'
        });
      }

      // Update approval status
      const { data: updatedDocument, error: updateError } = await supabase
        .from('project_documents')
        .update({
          approval_status: 'approved',
          approved_by: userId,
          approved_at: new Date().toISOString(),
          approval_comments: comments,
          version: version || document.version,
          updated_at: new Date().toISOString()
        })
        .eq('id', documentId)
        .select()
        .single();

      if (updateError) throw updateError;

      // Notify relevant users
      await sendDocumentApprovalNotification(document, userId, comments);

      await auditLog('DOCUMENT_APPROVED', {
        documentId,
        projectId: document.project_id,
        approvedBy: userId,
        version: version || document.version,
        comments
      });

      res.json({
        success: true,
        message: 'Document goedgekeurd',
        document: updatedDocument
      });

    } catch (error) {
      console.error('Approve document error:', error);
      res.status(500).json({ 
        error: 'Kon document niet goedkeuren',
        code: 'APPROVE_DOCUMENT_FAILED'
      });
    }
  }
);

/**
 * @route   POST /api/documents/:documentId/reject
 * @desc    Wijzig document af
 * @access  Private (Projectleider, Manager, Admin)
 */
router.post('/:documentId/reject', 
  authenticateToken, 
  requireRole('project_leader', 'manager', 'admin'),
  async (req, res) => {
    try {
      const { documentId } = req.params;
      const userId = req.user.id;
      const { reason, feedback } = req.body;

      if (!reason) {
        return res.status(400).json({
          error: 'Reden voor afwijzing is verplicht',
          code: 'REJECTION_REASON_REQUIRED'
        });
      }

      const { data: document, error: fetchError } = await supabase
        .from('project_documents')
        .select('*')
        .eq('id', documentId)
        .single();

      if (fetchError || !document) {
        return res.status(404).json({
          error: 'Document niet gevonden',
          code: 'DOCUMENT_NOT_FOUND'
        });
      }

      const { data: updatedDocument, error: updateError } = await supabase
        .from('project_documents')
        .update({
          approval_status: 'rejected',
          rejected_by: userId,
          rejected_at: new Date().toISOString(),
          rejection_reason: reason,
          rejection_feedback: feedback,
          updated_at: new Date().toISOString()
        })
        .eq('id', documentId)
        .select()
        .single();

      if (updateError) throw updateError;

      // Notify uploader
      await sendDocumentRejectionNotification(document, userId, reason, feedback);

      await auditLog('DOCUMENT_REJECTED', {
        documentId,
        projectId: document.project_id,
        rejectedBy: userId,
        reason,
        hasFeedback: !!feedback
      });

      res.json({
        success: true,
        message: 'Document afgewezen',
        document: updatedDocument
      });

    } catch (error) {
      console.error('Reject document error:', error);
      res.status(500).json({ 
        error: 'Kon document niet afwijzen',
        code: 'REJECT_DOCUMENT_FAILED'
      });
    }
  }
);

/**
 * @route   POST /api/documents/:documentId/share
 * @desc    Deel document met clients
 * @access  Private (Projectleider, Manager, Admin)
 */
router.post('/:documentId/share', 
  authenticateToken, 
  requireRole('project_leader', 'manager', 'admin'),
  async (req, res) => {
    try {
      const { documentId } = req.params;
      const { shareWithClients, specificClientIds, notify = true } = req.body;

      const { data: document, error: fetchError } = await supabase
        .from('project_documents')
        .select('*, project:projects(name)')
        .eq('id', documentId)
        .single();

      if (fetchError || !document) {
        return res.status(404).json({
          error: 'Document niet gevonden',
          code: 'DOCUMENT_NOT_FOUND'
        });
      }

      const updateData = {
        shared_with_clients: shareWithClients === true,
        updated_at: new Date().toISOString()
      };

      // If sharing with specific clients only
      if (specificClientIds && Array.isArray(specificClientIds)) {
        // Store in a separate table for granular permissions
        await updateDocumentClientPermissions(documentId, specificClientIds);
        updateData.shared_with_clients = true;
      }

      const { data: updatedDocument, error: updateError } = await supabase
        .from('project_documents')
        .update(updateData)
        .eq('id', documentId)
        .select()
        .single();

      if (updateError) throw updateError;

      // Send notifications if requested
      if (notify && shareWithClients === true) {
        await sendDocumentShareNotification(document, specificClientIds);
      }

      await auditLog('DOCUMENT_SHARED', {
        documentId,
        projectId: document.project_id,
        sharedWithClients: shareWithClients,
        specificClientIds: specificClientIds || 'all',
        notified: notify
      });

      res.json({
        success: true,
        message: shareWithClients 
          ? 'Document gedeeld met opdrachtgevers' 
          : 'Document niet langer gedeeld met opdrachtgevers',
        document: updatedDocument
      });

    } catch (error) {
      console.error('Share document error:', error);
      res.status(500).json({ 
        error: 'Kon document delen niet bijwerken',
        code: 'SHARE_DOCUMENT_FAILED'
      });
    }
  }
);

/**
 * @route   POST /api/documents/:documentId/comment
 * @desc    Voeg commentaar toe aan document
 * @access  Private
 */
router.post('/:documentId/comment', 
  authenticateToken, 
  async (req, res) => {
    try {
      const { documentId } = req.params;
      const userId = req.user.id;
      const { comment, parentCommentId, mentions } = req.body;

      if (!comment?.trim()) {
        return res.status(400).json({
          error: 'Commentaar is verplicht',
          code: 'COMMENT_REQUIRED'
        });
      }

      // Check document access
      const { data: document } = await supabase
        .from('project_documents')
        .select('project_id, shared_with_clients')
        .eq('id', documentId)
        .single();

      if (!document) {
        return res.status(404).json({
          error: 'Document niet gevonden',
          code: 'DOCUMENT_NOT_FOUND'
        });
      }

      const hasAccess = await checkDocumentAccess(userId, req.user.role, document);
      if (!hasAccess) {
        return res.status(403).json({
          error: 'Geen toegang tot dit document',
          code: 'NO_DOCUMENT_ACCESS'
        });
      }

      // Add comment
      const { data: newComment, error: commentError } = await supabase
        .from('document_comments')
        .insert([{
          document_id: documentId,
          user_id: userId,
          comment: comment.trim(),
          parent_comment_id: parentCommentId,
          mentions: mentions || [],
          created_at: new Date().toISOString()
        }])
        .select(`
          *,
          user:users (full_name, avatar_url)
        `)
        .single();

      if (commentError) throw commentError;

      // Notify mentioned users
      if (mentions && mentions.length > 0) {
        await sendCommentMentionNotifications(documentId, newComment.id, mentions, userId);
      }

      // Notify document owner if not the commenter
      if (document.uploaded_by !== userId) {
        await sendCommentNotification(documentId, newComment.id, document.uploaded_by, userId);
      }

      await auditLog('DOCUMENT_COMMENT_ADDED', {
        documentId,
        projectId: document.project_id,
        commentId: newComment.id,
        commenterId: userId,
        hasMentions: !!(mentions && mentions.length > 0)
      });

      res.status(201).json({
        success: true,
        message: 'Commentaar toegevoegd',
        comment: newComment
      });

    } catch (error) {
      console.error('Add comment error:', error);
      res.status(500).json({ 
        error: 'Kon commentaar niet toevoegen',
        code: 'ADD_COMMENT_FAILED'
      });
    }
  }
);

/**
 * @route   GET /api/documents/search
 * @desc    Zoek in documenten
 * @access  Private
 */
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const { q, projectId, type, limit = 50 } = req.query;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (!q) {
      return res.status(400).json({
        error: 'Zoekterm is verplicht',
        code: 'SEARCH_QUERY_REQUIRED'
      });
    }

    let query = supabase
      .from('project_documents')
      .select(`
        *,
        project:projects (id, name),
        uploaded_by_user:users (full_name)
      `)
      .or(`title.ilike.%${q}%,description.ilike.%${q}%,file_name.ilike.%${q}%,tags.cs.{${q}}`)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    // Filter by project if specified
    if (projectId) {
      const hasAccess = await checkProjectAccessForSearch(userId, userRole, projectId);
      if (!hasAccess) {
        return res.status(403).json({
          error: 'Geen toegang tot dit project',
          code: 'NO_PROJECT_ACCESS'
        });
      }
      query = query.eq('project_id', projectId);
    }

    // For clients: only search in accessible projects
    if (userRole === 'client' && !projectId) {
      const accessibleProjects = await getClientAccessibleProjects(userId);
      if (accessibleProjects.length === 0) {
        return res.json({
          success: true,
          results: [],
          total: 0
        });
      }
      query = query.in('project_id', accessibleProjects);
      query = query.eq('shared_with_clients', true);
    }

    if (type) {
      query = query.eq('type', type);
    }

    const { data: results, error } = await query;

    if (error) throw error;

    await auditLog('DOCUMENTS_SEARCHED', {
      userId,
      userRole,
      query: q,
      projectId: projectId || 'all',
      resultCount: results?.length || 0
    });

    res.json({
      success: true,
      results: results || [],
      total: results?.length || 0,
      query: q
    });

  } catch (error) {
    console.error('Search documents error:', error);
    res.status(500).json({ 
      error: 'Kon niet zoeken in documenten',
      code: 'SEARCH_DOCUMENTS_FAILED'
    });
  }
});

// Helper functions

function determineDocumentType(file) {
  const extension = path.extname(file.originalname).toLowerCase();
  const mimeType = file.mimetype;

  // Drawing/CAD files
  if (['.dwg', '.dxf', '.pdf', '.step', '.stp', '.iges', '.igs'].includes(extension) ||
      mimeType.includes('pdf') || mimeType.includes('model')) {
    return 'drawing';
  }

  // Contracts
  if (['.doc', '.docx', '.pdf'].includes(extension) &&
      (file.originalname.toLowerCase().includes('contract') || 
       file.originalname.toLowerCase().includes('overeenkomst'))) {
    return 'contract';
  }

  // Reports
  if (['.xls', '.xlsx', '.pdf', '.ppt', '.pptx'].includes(extension) &&
      (file.originalname.toLowerCase().includes('report') ||
       file.originalname.toLowerCase().includes('rapport'))) {
    return 'report';
  }

  // Photos
  if (mimeType.startsWith('image/')) {
    return 'photo';
  }

  // Default
  return 'other';
}

function determineCategory(type, fileName) {
  const name = fileName.toLowerCase();

  switch (type) {
    case 'drawing':
      if (name.includes('bouwtekening') || name.includes('construction')) return 'construction';
      if (name.includes('elektra') || name.includes('electrical')) return 'electrical';
      if (name.includes('sanitair') || name.includes('plumbing')) return 'plumbing';
      if (name.includes('constructie') || name.includes('structural')) return 'structural';
      return 'technical';

    case 'contract':
      if (name.includes('aanneem') || name.includes('main')) return 'main-contract';
      if (name.includes('onderhanden')) return 'progress-contract';
      if (name.includes('meerwerk')) return 'extra-work';
      return 'contract';

    case 'report':
      if (name.includes('voortgang')) return 'progress';
      if (name.includes('inspectie')) return 'inspection';
      if (name.includes('keuring')) return 'certification';
      return 'report';

    default:
      return 'general';
  }
}

function getFolderFromType(type) {
  const typeFolders = {
    'drawing': 'drawings',
    'contract': 'contracts',
    'report': 'reports',
    'photo': 'photos',
    'other': 'documents'
  };
  return typeFolders[type] || 'documents';
}

async function generateThumbnail(file) {
  // This is a placeholder - in production use sharp or gm
  // For now, just return null or a placeholder
  return null;
}

async function linkDrawingToProject(documentId, projectId, metadata) {
  const { error } = await supabase
    .from('project_drawings')
    .insert([{
      project_id: projectId,
      document_id: documentId,
      drawing_number: metadata.drawingNumber,
      revision: metadata.revision || 'A',
      discipline: metadata.discipline,
      status: 'active',
      created_at: new Date().toISOString()
    }]);

  if (error) {
    console.error('Link drawing error:', error);
  }
}

async function sendUploadNotifications(projectId, documents, uploadedById) {
  try {
    const documentTypes = [...new Set(documents.map(d => d.type))];
    const documentCount = documents.length;

    await notificationService.notifyProjectTeam(projectId, {
      type: 'DOCUMENTS_UPLOADED',
      subject: `${documentCount} nieuwe documenten geüpload`,
      message: `Document types: ${documentTypes.join(', ')}`,
      data: {
        projectId,
        documentCount,
        documentTypes,
        uploadedBy: uploadedById,
        documentIds: documents.map(d => d.id)
      }
    });
  } catch (error) {
    console.error('Send upload notifications error:', error);
  }
}

async function getDocumentStatistics(projectId, userRole, userId) {
  let query = supabase
    .from('project_documents')
    .select('type, file_size, shared_with_clients, created_at')
    .eq('project_id', projectId);

  if (userRole === 'client') {
    query = query.eq('shared_with_clients', true);
  }

  const { data, error } = await query;
  if (error) throw error;

  const stats = {
    total: data.length,
    totalSize: data.reduce((sum, doc) => sum + (doc.file_size || 0), 0),
    byType: data.reduce((acc, doc) => {
      acc[doc.type] = (acc[doc.type] || 0) + 1;
      return acc;
    }, {}),
    sharedWithClients: data.filter(doc => doc.shared_with_clients).length,
    recentUploads: data
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5)
      .map(doc => ({
        type: doc.type,
        size: doc.file_size,
        date: doc.created_at
      }))
  };

  return stats;
}

async function checkDocumentAccess(userId, userRole, document) {
  // SUPER_ADMIN has full access
  const { data: superAdminCheck } = await supabase
    .from('users')
    .select('email')
    .eq('id', userId)
    .eq('email', 'o.amatiskak@sterkbouw.nl')
    .single();

  if (superAdminCheck) return true;

  // Staff roles have access to all documents in their projects
  if (['admin', 'manager', 'project_leader'].includes(userRole)) {
    return true;
  }

  // Clients: only if document is shared with clients
  if (userRole === 'client') {
    if (!document.shared_with_clients) return false;
    
    // Check if client has access to this project
    const { data: clientAccess } = await supabase
      .from('project_clients')
      .select('id')
      .eq('project_id', document.project_id)
      .eq('client_id', userId)
      .single();

    return !!clientAccess;
  }

  return false;
}

async function checkDocumentEditPermission(userId, userRole, document) {
  // SUPER_ADMIN can edit everything
  const { data: superAdminCheck } = await supabase
    .from('users')
    .select('email')
    .eq('id', userId)
    .eq('email', 'o.amatiskak@sterkbouw.nl')
    .single();

  if (superAdminCheck) return true;

  // Document uploader can edit their own documents
  if (document.uploaded_by === userId) return true;

  // Project leader can edit documents in their project
  if (userRole === 'project_leader') {
    const { data: project } = await supabase
      .from('projects')
      .select('project_leader_id')
      .eq('id', document.project_id)
      .single();

    return project?.project_leader_id === userId;
  }

  // Admin and manager can edit all
  return ['admin', 'manager'].includes(userRole);
}

async function trackDocumentView(documentId, userId) {
  const { error } = await supabase
    .from('document_views')
    .insert([{
      document_id: documentId,
      user_id: userId,
      viewed_at: new Date().toISOString()
    }]);

  if (error) {
    console.error('Track view error:', error);
  }
}

async function trackDocumentDownload(documentId, userId, req) {
  const { error } = await supabase
    .from('document_downloads')
    .insert([{
      document_id: documentId,
      user_id: userId,
      downloaded_at: new Date().toISOString(),
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    }]);

  if (error) {
    console.error('Track download error:', error);
  }
}

async function createDocumentVersion(document) {
  const { error } = await supabase
    .from('document_versions')
    .insert([{
      document_id: document.id,
      version: document.version,
      file_url: document.file_url,
      file_size: document.file_size,
      created_at: document.created_at,
      created_by: document.uploaded_by
    }]);

  if (error) {
    console.error('Create version error:', error);
  }
}

async function sendDocumentApprovalNotification(document, approvedById, comments) {
  try {
    // Notify uploader
    if (document.uploaded_by !== approvedById) {
      const { data: uploader } = await supabase
        .from('users')
        .select('email, full_name')
        .eq('id', document.uploaded_by)
        .single();

      if (uploader) {
        await notificationService.sendNotification({
          type: 'DOCUMENT_APPROVED',
          recipient: { email: uploader.email, name: uploader.full_name },
          subject: `Document goedgekeurd: ${document.title}`,
          message: `Uw document "${document.title}" is goedgekeurd.${comments ? ` Opmerking: ${comments}` : ''}`,
          data: {
            documentId: document.id,
            documentTitle: document.title,
            approvedBy: approvedById,
            comments,
            portalLink: `/p/${document.project_id}/documents/${document.id}`
          }
        });
      }
    }

    // Notify clients if document is shared
    if (document.shared_with_clients) {
      await notificationService.notifyProjectTeam(document.project_id, {
        type: 'NEW_DOCUMENT_AVAILABLE',
        subject: `Nieuw document beschikbaar: ${document.title}`,
        message: 'Een nieuw document is goedgekeurd en beschikbaar in het portaal.',
        data: {
          documentId: document.id,
          documentTitle: document.title,
          documentType: document.type,
          portalLink: `/p/${document.project_id}/documents`
        },
        includeClient: true
      });
    }
  } catch (error) {
    console.error('Send approval notification error:', error);
  }
}

async function sendDocumentRejectionNotification(document, rejectedById, reason, feedback) {
  try {
    // Notify uploader
    if (document.uploaded_by !== rejectedById) {
      const { data: uploader } = await supabase
        .from('users')
        .select('email, full_name')
        .eq('id', document.uploaded_by)
        .single();

      if (uploader) {
        await notificationService.sendNotification({
          type: 'DOCUMENT_REJECTED',
          recipient: { email: uploader.email, name: uploader.full_name },
          subject: `Document afgewezen: ${document.title}`,
          message: `Uw document "${document.title}" is afgewezen. Reden: ${reason}.${feedback ? ` Feedback: ${feedback}` : ''}`,
          data: {
            documentId: document.id,
            documentTitle: document.title,
            rejectedBy: rejectedById,
            reason,
            feedback,
            portalLink: `/p/${document.project_id}/documents/${document.id}`
          }
        });
      }
    }
  } catch (error) {
    console.error('Send rejection notification error:', error);
  }
}

async function updateDocumentClientPermissions(documentId, clientIds) {
  // Delete existing permissions
  await supabase
    .from('document_client_permissions')
    .delete()
    .eq('document_id', documentId);

  // Insert new permissions
  const permissions = clientIds.map(clientId => ({
    document_id: documentId,
    client_id: clientId,
    can_view: true,
    can_download: true,
    created_at: new Date().toISOString()
  }));

  const { error } = await supabase
    .from('document_client_permissions')
    .insert(permissions);

  if (error) {
    console.error('Update client permissions error:', error);
  }
}

async function sendDocumentShareNotification(document, specificClientIds) {
  try {
    let recipients = [];

    if (specificClientIds && specificClientIds.length > 0) {
      // Get specific clients
      const { data: clients } = await supabase
        .from('users')
        .select('email, full_name')
        .in('id', specificClientIds)
        .eq('is_active', true);

      recipients = clients || [];
    } else {
      // Get all clients for this project
      const { data: projectClients } = await supabase
        .from('project_clients')
        .select('client:users(email, full_name)')
        .eq('project_id', document.project_id);

      recipients = projectClients?.map(pc => pc.client).filter(Boolean) || [];
    }

    // Send notifications
    const notificationPromises = recipients.map(client =>
      notificationService.sendNotification({
        type: 'DOCUMENT_SHARED',
        recipient: { email: client.email, name: client.full_name },
        subject: `Nieuw document gedeeld: ${document.title}`,
        message: `Een nieuw document is met u gedeeld voor project ${document.project?.name || document.project_id}.`,
        data: {
          documentId: document.id,
          documentTitle: document.title,
          documentType: document.type,
          projectName: document.project?.name,
          portalLink: `/p/${document.project_id}/documents/${document.id}`
        }
      })
    );

    await Promise.allSettled(notificationPromises);
  } catch (error) {
    console.error('Send share notification error:', error);
  }
}

async function sendCommentMentionNotifications(documentId, commentId, mentionedUserIds, commenterId) {
  try {
    const { data: mentionedUsers } = await supabase
      .from('users')
      .select('id, email, full_name')
      .in('id', mentionedUserIds)
      .neq('id', commenterId) // Don't notify the commenter
      .eq('is_active', true);

    if (!mentionedUsers) return;

    const { data: document } = await supabase
      .from('project_documents')
      .select('title, project_id')
      .eq('id', documentId)
      .single();

    const notificationPromises = mentionedUsers.map(user =>
      notificationService.sendNotification({
        type: 'DOCUMENT_COMMENT_MENTION',
        recipient: { email: user.email, name: user.full_name, userId: user.id },
        subject: `U werd genoemd in een document discussie`,
        message: `U werd genoemd in een commentaar bij document "${document?.title}".`,
        data: {
          documentId,
          commentId,
          documentTitle: document?.title,
          commenterId,
          portalLink: `/p/${document?.project_id}/documents/${documentId}#comment-${commentId}`
        }
      })
    );

    await Promise.allSettled(notificationPromises);
  } catch (error) {
    console.error('Send mention notifications error:', error);
  }
}

async function sendCommentNotification(documentId, commentId, documentOwnerId, commenterId) {
  try {
    if (documentOwnerId === commenterId) return; // Don't notify self

    const { data: documentOwner } = await supabase
      .from('users')
      .select('email, full_name')
      .eq('id', documentOwnerId)
      .single();

    if (!documentOwner) return;

    const { data: document } = await supabase
      .from('project_documents')
      .select('title, project_id')
      .eq('id', documentId)
      .single();

    await notificationService.sendNotification({
      type: 'DOCUMENT_COMMENT',
      recipient: { email: documentOwner.email, name: documentOwner.full_name },
      subject: `Nieuwe reactie op uw document: ${document?.title}`,
      message: `Er is een nieuwe reactie geplaatst op uw document.`,
      data: {
        documentId,
        commentId,
        documentTitle: document?.title,
        commenterId,
        portalLink: `/p/${document?.project_id}/documents/${documentId}#comment-${commentId}`
      }
    });
  } catch (error) {
    console.error('Send comment notification error:', error);
  }
}

async function checkProjectAccessForSearch(userId, userRole, projectId) {
  if (['admin', 'manager'].includes(userRole)) return true;

  if (userRole === 'project_leader') {
    const { data: project } = await supabase
      .from('projects')
      .select('project_leader_id')
      .eq('id', projectId)
      .single();

    return project?.project_leader_id === userId;
  }

  if (userRole === 'client') {
    const { data: clientAccess } = await supabase
      .from('project_clients')
      .select('id')
      .eq('project_id', projectId)
      .eq('client_id', userId)
      .single();

    return !!clientAccess;
  }

  return false;
}

async function getClientAccessibleProjects(userId) {
  const { data: clientProjects } = await supabase
    .from('project_clients')
    .select('project_id')
    .eq('client_id', userId);

  return clientProjects?.map(cp => cp.project_id) || [];
}

export default router;
