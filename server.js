// Backend/server.js - Geüpdatete versie
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import morgan from "morgan";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { logEvent } from "./utils/log.js";

// ===============================
// IMPORT NIEUWE ROUTES
// ===============================

// Bestaande routes
import apiRouter from "./api/routes/index.js";
import pdfRoutes from "./api/routes/pdf.js";

// Nieuwe projectportaal routes
import quoteRoutes from "./routes/quoteRoutes.js";
import extraWorkRoutes from "./routes/extraWorkRoutes.js";
import projectRoutes from "./routes/projectRoutes.js";
import documentRoutes from "./routes/documentRoutes.js";
// import authRoutes from "./routes/authRoutes.js"; // Als je deze maakt

// Middleware imports
import { authenticateToken } from "./middleware/auth.js";
import { auditLog } from "./utils/auditLogger.js";
import { supabase } from "./config/database.js";

// ===============================
// INIT
// ===============================

dotenv.config();

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS configuratie
const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuten
  max: 100, // Limiet elk IP tot 100 requests per windowMs
  message: { error: 'Te veel aanvragen van dit IP, probeer het later opnieuw.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply to all API routes
app.use('/api/', apiLimiter);

// ===============================
// HEALTH CHECK & PING
// ===============================

app.get("/ping", (req, res) => {
  logEvent("Ping ontvangen");
  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    service: "SterkBouw Portal API",
    version: process.env.npm_package_version || "1.0.0"
  });
});

app.get("/health", async (req, res) => {
  try {
    // Database health check
    const { data, error } = await supabase
      .from('projects')
      .select('count', { count: 'exact', head: true })
      .limit(1);

    const dbStatus = error ? 'unhealthy' : 'healthy';
    
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      services: {
        database: dbStatus,
        api: "healthy",
        environment: process.env.NODE_ENV || "development"
      },
      uptime: process.uptime()
    });

    await auditLog('HEALTH_CHECK', {
      endpoint: '/health',
      dbStatus,
      ip: req.ip
    }, { storeInDatabase: false });

  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// ===============================
// STATIC FILES (uploads)
// ===============================

app.use('/uploads', express.static('uploads', {
  setHeaders: (res, path) => {
    // Security headers voor uploads
    res.set('X-Content-Type-Options', 'nosniff');
    
    // Cache control voor static files
    if (path.endsWith('.pdf')) {
      res.set('Cache-Control', 'public, max-age=86400'); // 24 uur voor PDFs
    } else {
      res.set('Cache-Control', 'public, max-age=3600'); // 1 uur voor andere bestanden
    }
  }
}));

// ===============================
// API ROUTES MET VERSIONING
// ===============================

// API v1 router (oud)
app.use("/api/v1", apiRouter);

// PDF ROUTES
app.use("/api/pdf", pdfRoutes);

// ===============================
// PROJECT PORTAAL API v2
// ===============================

const portalApiRouter = express.Router();

// Global middleware voor portal API
portalApiRouter.use((req, res, next) => {
  // Log alle portal API requests
  auditLog('PORTAL_API_REQUEST', {
    method: req.method,
    endpoint: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  }, { 
    severity: 'low',
    storeInDatabase: false 
  });
  next();
});

// Publieke routes (geen authenticatie nodig)
portalApiRouter.get('/status', (req, res) => {
  res.json({
    status: 'operational',
    service: 'Project Portaal API',
    version: '2.0.0',
    timestamp: new Date().toISOString()
  });
});

// Beveiligde routes (authenticatie vereist)
portalApiRouter.use('/projects', authenticateToken, projectRoutes);
portalApiRouter.use('/quotes', authenticateToken, quoteRoutes);
portalApiRouter.use('/extra-work', authenticateToken, extraWorkRoutes);
portalApiRouter.use('/documents', authenticateToken, documentRoutes);

// Mount portal API op /api/v2
app.use("/api/v2", portalApiRouter);

// ===============================
// CLIENT PORTAL ACCESS ROUTES
// ===============================

// Speciale route voor client portal tokens
app.get('/portal/token/:projectId', authenticateToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const userId = req.user.id;

    // Controleer of gebruiker client is van dit project
    const { data: clientAccess } = await supabase
      .from('project_clients')
      .select('id')
      .eq('project_id', projectId)
      .eq('client_id', userId)
      .single();

    if (!clientAccess) {
      return res.status(403).json({
        error: 'Geen toegang tot dit projectportaal',
        code: 'NO_PORTAL_ACCESS'
      });
    }

    // Genereer portal token (vereenvoudigd - in productie JWT gebruiken)
    const portalToken = Buffer.from(`${projectId}:${userId}:${Date.now()}`).toString('base64');
    
    // Token opslaan in database
    await supabase
      .from('portal_tokens')
      .insert([{
        project_id: projectId,
        user_id: userId,
        token: portalToken,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 uur
        created_at: new Date().toISOString()
      }]);

    await auditLog('PORTAL_TOKEN_GENERATED', {
      projectId,
      userId,
      tokenId: portalToken.substring(0, 10) + '...'
    });

    res.json({
      success: true,
      token: portalToken,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      portal_url: `${process.env.FRONTEND_URL}/p/${projectId}?token=${portalToken}`
    });

  } catch (error) {
    console.error('Generate portal token error:', error);
    res.status(500).json({ 
      error: 'Kon portal token niet genereren',
      code: 'TOKEN_GENERATION_FAILED'
    });
  }
});

// ===============================
// ERROR HANDLING MIDDLEWARE
// ===============================

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({
    error: 'Endpoint niet gevonden',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });

  auditLog('ENDPOINT_NOT_FOUND', {
    path: req.originalUrl,
    method: req.method,
    ip: req.ip
  }, { severity: 'low' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);

  const statusCode = err.status || err.statusCode || 500;
  const errorMessage = process.env.NODE_ENV === 'production' 
    ? 'Er is een serverfout opgetreden' 
    : err.message;

  res.status(statusCode).json({
    error: errorMessage,
    code: err.code || 'INTERNAL_SERVER_ERROR',
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });

  auditLog('SERVER_ERROR', {
    error: err.message,
    stack: err.stack,
    path: req.originalUrl,
    method: req.method,
    statusCode
  }, { 
    severity: 'high',
    notifyAdmin: true 
  });
});

// ===============================
// START SERVER
// ===============================

const PORT = process.env.PORT || 4000;

// Database connectivity check bij startup
async function initializeServer() {
  try {
    // Test database connectie
    const { error: dbError } = await supabase
      .from('projects')
      .select('count', { count: 'exact', head: true })
      .limit(1);

    if (dbError) {
      console.error('Database connection failed:', dbError);
      logEvent(`Database connection ERROR: ${dbError.message}`);
    } else {
      logEvent('Database connection OK');
    }

    // Start server
    app.listen(PORT, () => {
      logEvent(`✅ Server draait op poort ${PORT}`);
      logEvent(`📁 API Endpoints:`);
      logEvent(`   📍 Health: http://localhost:${PORT}/health`);
      logEvent(`   📍 Ping: http://localhost:${PORT}/ping`);
      logEvent(`   📍 API v1: http://localhost:${PORT}/api/v1/*`);
      logEvent(`   📍 API v2 (Portaal): http://localhost:${PORT}/api/v2/*`);
      logEvent(`   📍 PDF API: http://localhost:${PORT}/api/pdf/*`);
      logEvent(`   📍 Uploads: http://localhost:${PORT}/uploads/*`);
      
      if (process.env.NODE_ENV === 'development') {
        console.log('\n📋 Beschikbare Routes:');
        console.log('├── /ping');
        console.log('├── /health');
        console.log('├── /api/v1/* (Legacy API)');
        console.log('├── /api/v2/* (Project Portaal API)');
        console.log('│   ├── /projects');
        console.log('│   ├── /quotes');
        console.log('│   ├── /extra-work');
        console.log('│   └── /documents');
        console.log('├── /api/pdf/*');
        console.log('└── /uploads/*\n');
      }
    });

  } catch (error) {
    console.error('Server initialization failed:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logEvent('SIGTERM ontvangen, server wordt afgesloten...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logEvent('SIGINT ontvangen, server wordt afgesloten...');
  process.exit(0);
});

// Unhandled promise rejection handler
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  auditLog('UNHANDLED_PROMISE_REJECTION', {
    reason: reason?.message || String(reason),
    stack: reason?.stack
  }, { 
    severity: 'critical',
    notifyAdmin: true 
  });
});

// Start de server
initializeServer();

export default app;
