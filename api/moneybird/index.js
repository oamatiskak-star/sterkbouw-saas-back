import express from 'express';
import { MoneybirdService } from '../../services/MoneybirdService';
import { authenticate, requireAdmin } from '../auth/middleware';

const router = express.Router();
const moneybirdService = new MoneybirdService();

// Get Moneybird connection status
router.get('/status', authenticate, async (req, res) => {
  try {
    const { companyId } = req.query;
    const status = await moneybirdService.getConnectionStatus(companyId);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sync invoices from Moneybird
router.post('/sync/invoices', authenticate, requireAdmin, async (req, res) => {
  try {
    const { companyId, forceFullSync } = req.body;
    const result = await moneybirdService.syncInvoices(companyId, {
      forceFullSync,
      syncProjects: true
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get unsynced invoices
router.get('/invoices/unsynced', authenticate, async (req, res) => {
  try {
    const { companyId } = req.query;
    const invoices = await moneybirdService.getUnsyncedInvoices(companyId);
    res.json(invoices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Configure webhook for Moneybird events
router.post('/webhooks/configure', authenticate, requireAdmin, async (req, res) => {
  try {
    const { companyId, events } = req.body;
    const config = await moneybirdService.configureWebhook(companyId, events);
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Webhook endpoint for Moneybird
router.post('/webhooks/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const event = req.body;
    
    // Verify webhook signature
    const isValid = await moneybirdService.verifyWebhookSignature(
      companyId,
      req.headers['signature'],
      req.body
    );
    
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    // Process webhook asynchronously
    moneybirdService.processWebhookEvent(companyId, event);
    
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
