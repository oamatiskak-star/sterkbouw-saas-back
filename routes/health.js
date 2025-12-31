const express = require('express');

module.exports = function healthRouter() {
const router = express.Router();

router.get('/', (req, res) => {
const commandRegistry = req.app.get('commandRegistry');
const routerService = req.app.get('router');
const recoveryService = req.app.get('recovery');

text
const healthData = {
  status: 'healthy',
  timestamp: new Date().toISOString(),
  uptime: process.uptime(),
  memory: process.memoryUsage(),
  services: {
    commandRegistry: !!commandRegistry,
    router: !!routerService,
    recovery: !!recoveryService
  }
};

// Add detailed service status if available
if (commandRegistry) {
  commandRegistry.getStats()
    .then(stats => {
      healthData.commands = stats;
      return routerService ? routerService.getRouteStatus() : null;
    })
    .then(routeStatus => {
      if (routeStatus) healthData.routes = routeStatus;
      res.json(healthData);
    })
    .catch(error => {
      healthData.status = 'degraded';
      healthData.error = error.message;
      res.json(healthData);
    });
} else {
  res.json(healthData);
}
});

router.get('/detailed', async (req, res) => {
try {
const commandRegistry = req.app.get('commandRegistry');
const routerService = req.app.get('router');

text
  const detailedHealth = {
    timestamp: new Date().toISOString(),
    system: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpuUsage: process.cpuUsage()
    },
    services: {}
  };
  
  if (commandRegistry) {
    detailedHealth.services.commandRegistry = await commandRegistry.getStats();
    const allCommands = await commandRegistry.listAllCommands();
    detailedHealth.services.commandRegistry.totalCount = allCommands.length;
  }
  
  if (routerService) {
    detailedHealth.services.router = await routerService.getRouteStatus();
  }
  
  // Check critical files
  const fs = require('fs').promises;
  const path = require('path');
  
  const criticalFiles = [
    '../core/commands/immutable-core.json',
    '../core/routes/route-manifest.json'
  ];
  
  detailedHealth.files = {};
  
  for (const file of criticalFiles) {
    try {
      const filePath = path.join(__dirname, file);
      const stats = await fs.stat(filePath);
      detailedHealth.files[file] = {
        exists: true,
        size: stats.size,
        modified: stats.mtime
      };
    } catch (error) {
      detailedHealth.files[file] = {
        exists: false,
        error: error.message
      };
    }
  }
  
  // Check backup status
  const backupDir = path.join(__dirname, '../backups/commands/hourly');
  try {
    const backupFiles = await fs.readdir(backupDir);
    detailedHealth.backups = {
      hourly: backupFiles.length,
      latest: backupFiles.sort().reverse()[0]
    };
  } catch (error) {
    detailedHealth.backups = {
      error: error.message
    };
  }
  
  res.json(detailedHealth);
  
} catch (error) {
  res.status(500).json({
    status: 'error',
    timestamp: new Date().toISOString(),
    error: error.message
  });
}
});

router.post('/diagnostic', async (req, res) => {
try {
const { tests = [] } = req.body;
const results = {};

text
  if (tests.includes('command_registry') || tests.length === 0) {
    try {
      const commandRegistry = req.app.get('commandRegistry');
      const stats = await commandRegistry.getStats();
      results.commandRegistry = {
        passed: true,
        stats
      };
    } catch (error) {
      results.commandRegistry = {
        passed: false,
        error: error.message
      };
    }
  }
  
  if (tests.includes('routes') || tests.length === 0) {
    try {
      const routerService = req.app.get('router');
      const routeStatus = await routerService.getRouteStatus();
      results.routes = {
        passed: routeStatus.healthy === routeStatus.total,
        status: routeStatus
      };
    } catch (error) {
      results.routes = {
        passed: false,
        error: error.message
      };
    }
  }
  
  if (tests.includes('filesystem') || tests.length === 0) {
    const fs = require('fs').promises;
    const criticalPaths = [
      '../core/commands/',
      '../core/routes/',
      '../backups/'
    ];
    
    results.filesystem = {};
    
    for (const path of criticalPaths) {
      try {
        await fs.access(path.join(__dirname, path));
        results.filesystem[path] = { passed: true };
      } catch (error) {
        results.filesystem[path] = {
          passed: false,
          error: error.message
        };
      }
    }
  }
  
  res.json({
    timestamp: new Date().toISOString(),
    tests: results,
    overall: Object.values(results).every(r => r.passed !== false)
  });
  
} catch (error) {
  res.status(500).json({
    error: error.message,
    timestamp: new Date().toISOString()
  });
}
});

return router;
};
