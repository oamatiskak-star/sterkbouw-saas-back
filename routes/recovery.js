const express = require('express');

module.exports = function recoveryRouter() {
const router = express.Router();

// POST trigger system recovery
router.post('/system', async (req, res) => {
try {
const recoveryService = req.app.get('recovery');
const { level = 'full', reason = 'manual_trigger' } = req.body;

text
  if (!recoveryService) {
    return res.status(503).json({
      error: 'Recovery service not available',
      timestamp: new Date().toISOString()
    });
  }
  
  let result;
  
  switch (level) {
    case 'quick':
      result = await recoveryService.performHealthCheck();
      break;
    case 'repair':
      result = await recoveryService.triggerAutomaticRepair(
        await recoveryService.performHealthCheck()
      );
      break;
    case 'full':
    default:
      result = await recoveryService.handleSystemCrash();
      break;
  }
  
  res.json({
    status: 'recovery_initiated',
    level,
    reason,
    result,
    timestamp: new Date().toISOString()
  });
} catch (error) {
  res.status(500).json({
    error: error.message,
    timestamp: new Date().toISOString()
  });
}
});

// GET recovery status
router.get('/status', async (req, res) => {
try {
const recoveryService = req.app.get('recovery');
const fs = require('fs').promises;
const path = require('path');

text
  const recoveryLogPath = path.join(__dirname, '../logs/recovery.log');
  let lastRecovery = 'none';
  let recoveryCount = 0;
  
  if (await fileExists(recoveryLogPath)) {
    const logContent = await fs.readFile(recoveryLogPath, 'utf8');
    const lines = logContent.trim().split('\n');
    
    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1];
      try {
        const match = lastLine.match(/\[(.*?)\]/);
        if (match) lastRecovery = match[1];
      } catch (error) {
        // Ignore parsing errors
      }
      
      recoveryCount = lines.filter(line => 
        line.includes('RECOVERY') || line.includes('recovery')
      ).length;
    }
  }
  
  const healthStatus = recoveryService 
    ? await recoveryService.performHealthCheck()
    : { status: 'service_unavailable' };
  
  res.json({
    timestamp: new Date().toISOString(),
    recovery: {
      serviceAvailable: !!recoveryService,
      lastRecovery,
      totalRecoveries: recoveryCount,
      currentHealth: healthStatus
    },
    system: {
      uptime: process.uptime(),
      memory: process.memoryUsage()
    }
  });
} catch (error) {
  res.status(500).json({
    error: error.message,
    timestamp: new Date().toISOString()
  });
}
});

// POST restore from backup
router.post('/restore', async (req, res) => {
try {
const commandRegistry = req.app.get('commandRegistry');
const { backupType = 'recovery-points', backupId = null, verify = true } = req.body;

text
  if (!commandRegistry) {
    return res.status(503).json({
      error: 'Command registry not available',
      timestamp: new Date().toISOString()
    });
  }
  
  const result = await commandRegistry.restoreFromBackup(backupType, backupId);
  
  if (verify) {
    const stats = await commandRegistry.getStats();
    result.verification = {
      commandsRestored: stats.total,
      layers: stats.byLayer
    };
  }
  
  res.json({
    status: 'restored',
    backup: { type: backupType, id: backupId },
    result,
    timestamp: new Date().toISOString()
  });
} catch (error) {
  res.status(500).json({
    error: error.message,
    timestamp: new Date().toISOString()
  });
}
});

// GET list backups
router.get('/backups', async (req, res) => {
try {
const fs = require('fs').promises;
const path = require('path');

text
  const backupTypes = ['commands', 'routes', 'state'];
  const backupList = {};
  
  for (const type of backupTypes) {
    const backupDir = path.join(__dirname, `../backups/${type}/`);
    
    try {
      const entries = await fs.readdir(backupDir, { withFileTypes: true });
      const subDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
      const files = entries.filter(e => e.isFile() && e.name.endsWith('.json')).map(e => e.name);
      
      backupList[type] = {
        directories: subDirs,
        fileCount: files.length,
        latest: files.sort().reverse()[0] || 'none'
      };
    } catch (error) {
      backupList[type] = {
        error: error.message,
        available: false
      };
    }
  }
  
  res.json({
    timestamp: new Date().toISOString(),
    backups: backupList,
    totalSize: await calculateBackupSize()
  });
} catch (error) {
  res.status(500).json({
    error: error.message,
    timestamp: new Date().toISOString()
  });
}
});

// POST emergency procedures
router.post('/emergency/:procedure', async (req, res) => {
try {
const recoveryService = req.app.get('recovery');
const { procedure } = req.params;
const params = req.body;

text
  if (!recoveryService) {
    return res.status(503).json({
      error: 'Recovery service not available',
      timestamp: new Date().toISOString()
    });
  }
  
  let result;
  
  switch (procedure) {
    case 'railway-offline':
      result = await recoveryService.emergencyProtocols.railwayOffline(params);
      break;
      
    case 'github-fallback':
      result = await recoveryService.emergencyProtocols.githubFallback(params);
      break;
      
    case 'bootstrap':
      result = await recoveryService.handleCompleteFailure();
      break;
      
    default:
      return res.status(404).json({
        error: `Unknown emergency procedure: ${procedure}`,
        available: ['railway-offline', 'github-fallback', 'bootstrap']
      });
  }
  
  res.json({
    procedure,
    status: 'executed',
    result,
    timestamp: new Date().toISOString()
  });
} catch (error) {
  res.status(500).json({
    error: error.message,
    procedure: req.params.procedure,
    timestamp: new Date().toISOString()
  });
}
});

// POST repair specific component
router.post('/repair', async (req, res) => {
try {
const { component, options = {} } = req.body;

text
  if (!component) {
    return res.status(400).json({
      error: 'Component to repair is required',
      available: ['commands', 'routes', 'files', 'all']
    });
  }
  
  const repairResults = {};
  const recoveryService = req.app.get('recovery');
  
  if (component === 'commands' || component === 'all') {
    try {
      const commandRegistry = req.app.get('commandRegistry');
      if (commandRegistry) {
        await commandRegistry.restoreFromBackup();
        repairResults.commands = { status: 'restored' };
      }
    } catch (error) {
      repairResults.commands = { status: 'failed', error: error.message };
    }
  }
  
  if (component === 'routes' || component === 'all') {
    try {
      const routerService = req.app.get('router');
      if (routerService && recoveryService) {
        await recoveryService.repairRoutes();
        repairResults.routes = { status: 'repaired' };
      }
    } catch (error) {
      repairResults.routes = { status: 'failed', error: error.message };
    }
  }
  
  if (component === 'files' || component === 'all') {
    try {
      if (recoveryService) {
        await recoveryService.repairCriticalFile('../core/commands/immutable-core.json');
        await recoveryService.repairCriticalFile('../core/routes/route-manifest.json');
        repairResults.files = { status: 'repaired' };
      }
    } catch (error) {
      repairResults.files = { status: 'failed', error: error.message };
    }
  }
  
  res.json({
    component,
    repairs: repairResults,
    timestamp: new Date().toISOString(),
    note: 'Repairs may require system restart'
  });
} catch (error) {
  res.status(500).json({
    error: error.message,
    timestamp: new Date().toISOString()
  });
}
});

// GET recovery logs
router.get('/logs', async (req, res) => {
try {
const fs = require('fs').promises;
const path = require('path');
const { lines = 100, type = 'recovery' } = req.query;

text
  const logFiles = {
    recovery: '../logs/recovery.log',
    executions: '../logs/executions.log',
    errors: '../logs/errors.log'
  };
  
  const logFile = logFiles[type] || logFiles.recovery;
  const logPath = path.join(__dirname, logFile);
  
  if (!await fileExists(logPath)) {
    return res.json({
      type,
      lines: 0,
      logs: [],
      timestamp: new Date().toISOString()
    });
  }
  
  const logContent = await fs.readFile(logPath, 'utf8');
  const allLines = logContent.trim().split('\n');
  const recentLines = allLines.slice(-Math.min(lines, allLines.length));
  
  res.json({
    type,
    totalLines: allLines.length,
    lines: recentLines.length,
    logs: recentLines,
    timestamp: new Date().toISOString()
  });
} catch (error) {
  res.status(500).json({
    error: error.message,
    timestamp: new Date().toISOString()
  });
}
});

async function fileExists(filePath) {
try {
await fs.access(filePath);
return true;
} catch {
return false;
}
}

async function calculateBackupSize() {
const fs = require('fs').promises;
const path = require('path');

text
let totalSize = 0;
const backupDir = path.join(__dirname, '../backups/');

async function getDirSize(dir) {
  let size = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      size += await getDirSize(fullPath);
    } else if (entry.isFile()) {
      const stats = await fs.stat(fullPath);
      size += stats.size;
    }
  }
  
  return size;
}

try {
  totalSize = await getDirSize(backupDir);
} catch (error) {
  // Ignore errors
}

return {
  bytes: totalSize,
  human: `${(totalSize / 1024 / 1024).toFixed(2)} MB`
};
}

return router;
};

