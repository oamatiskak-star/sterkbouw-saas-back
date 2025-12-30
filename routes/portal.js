import express from 'express';
import { 
  getPortalData, 
  requestExtraWork, 
  approveQuote, 
  askQuestion, 
  confirmContract,
  exportDossier,
  generateMagicLink 
} from '../controllers/portalController.js';
import { validateMagicLink, validateClientAccess } from '../middleware/portalAuth.js';
import { validateExtraWorkRequest, validateQuoteApproval } from '../middleware/validation.js';

const router = express.Router();

// Public route - magic link generation (voor dashboard)
router.post('/generate-link', generateMagicLink);

// Alle portaal routes vereisen magic link validatie
router.use(validateMagicLink);

// Portaal data
router.get('/:projectId', validateClientAccess, getPortalData);
router.get('/:projectId/section/:section', validateClientAccess, getPortalData);

// Contracten
router.post('/:projectId/contracts/:contractId/confirm', validateClientAccess, confirmContract);

// Meerwerk
router.post('/:projectId/extra-work/request', validateClientAccess, validateExtraWorkRequest, requestExtraWork);
router.post('/:projectId/extra-work/:quoteId/approve', validateClientAccess, validateQuoteApproval, approveQuote);
router.post('/:projectId/extra-work/:quoteId/request-revision', validateClientAccess, requestQuoteRevision);

// Vragen & communicatie
router.post('/:projectId/questions', validateClientAccess, askQuestion);
router.post('/:projectId/messages', validateClientAccess, sendMessage);
router.get('/:projectId/communication', validateClientAccess, getCommunication);

// Documenten
router.get('/:projectId/documents', validateClientAccess, getDocuments);
router.get('/:projectId/drawings', validateClientAccess, getDrawings);
router.get('/:projectId/drawings/:drawingId/view-3d', validateClientAccess, view3DDrawing);

// Oplevering
router.get('/:projectId/delivery', validateClientAccess, getDeliveryStatus);
router.post('/:projectId/delivery/:pointId/confirm', validateClientAccess, confirmDeliveryPoint);

// Export
router.post('/:projectId/export/dossier', validateClientAccess, exportDossier);
router.get('/:projectId/export/:exportId/download', validateClientAccess, downloadExport);

// Real-time updates
router.get('/:projectId/updates', validateClientAccess, setupWebSocket);

export default router;
