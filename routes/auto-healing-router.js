const fs = require('fs').promises;
const path = require('path');
const express = require('express');

class SelfHealingRouter {
constructor() {
this.manifestPath = path.join(__dirname, 'route-manifest.json');
this.routesPath = path.join(__dirname, '../../routes/');
this.backupPath = path.join(__dirname, '../../backups/routes/');

text
this.router = express.Router();
this.routeRegistry = new Map();

this.healthCheckInterval = 30000; // 30 seconds
}

async initialize() {
await this.ensureDirectories();
await this.loadOrCreateManifest();
await this.registerAllRoutes();
this.startHealthMonitoring();
}

async ensureDirectories() {
const dirs = [
this.routesPath,
this.backupPath,
path.join(this.backupPath, 'hourly'),
path.join(this.backupPath, 'daily'),
path.join(this.backupPath, 'recovery')
];

text
for (const dir of dirs) {
  await fs.mkdir(dir, { recursive: true });
}
}

async loadOrCreateManifest() {
try {
if (await this.fileExists(this.manifestPath)) {
const data = await fs.readFile(this.manifestPath, 'utf8');
this.manifest = JSON.parse(data);
await this.validateManifest();
} else {
await this.createDefaultManifest();
}
} catch (error) {
console.error('Error loading manifest:', error);
await this.createDefaultManifest();
}
}

async validateManifest() {
const requiredFields = ['version', 'routes', 'checksum'];

text
for (const field of requiredFields) {
  if (!this.manifest[field]) {
    throw new Error(`Missing required field in manifest: ${field}`);
  }
}

// Verify checksum
const routesString = JSON.stringify(this.manifest.routes);
const calculatedChecksum = this.calculateChecksum(routesString);

if (this.manifest.checksum !== calculatedChecksum) {
  console.warn('Manifest checksum mismatch, attempting repair...');
  await this.repairManifest();
}
}

async createDefaultManifest() {
this.manifest = {
version: '1.0.0',
created: new Date().toISOString(),
routes: {
health: {
path: '/api/health',
method: 'GET',
file: './routes/health.js',
immutable: false
},
commands: {
path: '/api/commands',
method: 'GET',
file: './routes/commands.js',
immutable: false
},
recovery: {
path: '/api/recovery',
method: 'POST',
file: './routes/recovery.js',
immutable: true
}
},
checksum: ''
};

text
// Generate initial checksum
this.updateManifestChecksum();
await this.saveManifest();

// Create default route files
await this.createDefaultRouteFiles();
}

async createDefaultRouteFiles() {
const defaultRoutes = {
'health.js': `
module.exports = function healthRouter() {
const router = require('express').Router();

text
      router.get('/', (req, res) => {
        res.json({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          routes: Object.keys(require('../route-manifest.json').routes).length
        });
      });
      
      return router;
    };
  `,
  'commands.js': `
    const CommandRegistry = require('../core/commands/command-registry');
    
    module.exports = function commandsRouter() {
      const router = require('express').Router();
      const registry = new CommandRegistry();
      
      router.get('/', async (req, res) => {
        try {
          const commands = await registry.listAllCommands();
          res.json({ commands });
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
      });
      
      router.post('/execute', async (req, res) => {
        try {
          const { command, parameters } = req.body;
          const result = await registry.executeCommand(command, parameters);
          res.json({ result });
        } catch (error) {
          res.status(400).json({ error: error.message });
        }
      });
      
      return router;
    };
  `,
  'recovery.js': `
    const EmergencyRecovery = require('../core/commands/emergency-recovery');
    
    module.exports = function recoveryRouter() {
      const router = require('express').Router();
      const recovery = new EmergencyRecovery();
      
      router.post('/system', async (req, res) => {
        try {
          const result = await recovery.catastrophicRecovery();
          res.json({ 
            status: 'recovery_initiated',
            result 
          });
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
      });
      
      router.post('/routes', async (req, res) => {
        try {
          const { action } = req.body;
          let result;
          
          if (action === 'rebuild') {
            result = await recovery.rebuildRoutes();
          } else if (action === 'verify') {
            result = await recovery.verifySystemIntegrity();
          }
          
          res.json({ result });
        } catch (error) {
          res.status(400).json({ error: error.message });
        }
      });
      
      return router;
    };
  `
};

for (const [fileName, content] of Object.entries(defaultRoutes)) {
  const filePath = path.join(this.routesPath, fileName);
  await fs.writeFile(filePath, content.trim());
}
}

async registerAllRoutes() {
for (const [routeName, routeConfig] of Object.entries(this.manifest.routes)) {
await this.registerRoute(routeName, routeConfig);
}

text
// Register route monitoring endpoint
this.registerMonitoringRoute();

await this.backupRouteRegistry();
}

async registerRoute(routeName, routeConfig) {
try {
const routeFile = path.resolve(__dirname, routeConfig.file);

text
  if (!await this.fileExists(routeFile)) {
    console.warn(`Route file not found: ${routeFile}, attempting to regenerate...`);
    await this.regenerateRouteFile(routeName, routeConfig);
  }
  
  const routeModule = require(routeFile);
  const routeHandler = routeModule();
  
  // Register based on method
  const method = routeConfig.method.toLowerCase();
  
  switch (method) {
    case 'get':
      this.router.get(routeConfig.path, routeHandler);
      break;
    case 'post':
      this.router.post(routeConfig.path, routeHandler);
      break;
    case 'put':
      this.router.put(routeConfig.path, routeHandler);
      break;
    case 'delete':
      this.router.delete(routeConfig.path, routeHandler);
      break;
    default:
      console.warn(`Unknown method ${method} for route ${routeName}`);
      return;
  }
  
  this.routeRegistry.set(routeName, {
    ...routeConfig,
    registered: new Date().toISOString(),
    healthy: true
  });
  
  console.log(`✅ Route registered: ${routeConfig.method} ${routeConfig.path}`);
  
} catch (error) {
  console.error(`❌ Failed to register route ${routeName}:`, error);
  
  // Mark as unhealthy and attempt repair
  this.routeRegistry.set(routeName, {
    ...routeConfig,
    registered: null,
    healthy: false,
    error: error.message
  });
  
  // Attempt automatic repair for non-immutable routes
  if (!routeConfig.immutable) {
    await this.attemptRouteRepair(routeName, routeConfig);
  }
}
}

async regenerateRouteFile(routeName, routeConfig) {
const routeTemplate = this.generateRouteTemplate(routeName, routeConfig);
const routeFile = path.resolve(__dirname, routeConfig.file);

text
// Ensure directory exists
await fs.mkdir(path.dirname(routeFile), { recursive: true });

await fs.writeFile(routeFile, routeTemplate);
console.log(`🔄 Regenerated route file: ${routeFile}`);
}

generateRouteTemplate(routeName, routeConfig) {
const routeNameCamel = routeName.replace(/[^a-zA-Z0-9]/g, '');
const method = routeConfig.method.toLowerCase();

text
return `
  const express = require('express');
  
  module.exports = function ${routeNameCamel}Router() {
    const router = express.Router();
    
    router.${method}('/', (req, res) => {
      res.json({
        route: '${routeName}',
        path: '${routeConfig.path}',
        method: '${routeConfig.method}',
        status: 'regenerated',
        timestamp: new Date().toISOString(),
        note: 'This route was automatically regenerated'
      });
    });
    
    return router;
  };
`.trim();
}

async attemptRouteRepair(routeName, routeConfig) {
console.log(🛠️ Attempting to repair route: ${routeName});

text
try {
  // Try to regenerate the route file
  await this.regenerateRouteFile(routeName, routeConfig);
  
  // Wait a moment for file system
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Try to register again
  await this.registerRoute(routeName, routeConfig);
  
  // Update manifest if successful
  if (this.routeRegistry.get(routeName)?.healthy) {
    await this.updateManifestRoute(routeName, {
      ...routeConfig,
      lastRepaired: new Date().toISOString()
    });
    
    console.log(`✅ Route repaired: ${routeName}`);
  }
} catch (repairError) {
  console.error(`❌ Failed to repair route ${routeName}:`, repairError);
  
  // If it's an immutable route, trigger emergency recovery
  if (routeConfig.immutable) {
    console.log('🚨 Immutable route failure, triggering recovery...');
    await this.triggerEmergencyRecovery(routeName);
  }
}
}

async triggerEmergencyRecovery(failedRoute) {
const EmergencyRecovery = require('../commands/emergency-recovery');
const recovery = new EmergencyRecovery();

text
await recovery.catastrophicRecovery();
}

registerMonitoringRoute() {
this.router.get('/api/routes/status', (req, res) => {
const status = {
timestamp: new Date().toISOString(),
totalRoutes: this.routeRegistry.size,
healthyRoutes: Array.from(this.routeRegistry.values()).filter(r => r.healthy).length,
routes: Array.from(this.routeRegistry.entries()).map(([name, config]) => ({
name,
path: config.path,
method: config.method,
healthy: config.healthy,
lastChecked: config.lastChecked
}))
};

text
  res.json(status);
});

this.router.post('/api/routes/repair', async (req, res) => {
  try {
    const { routeName } = req.body;
    
    if (!routeName) {
      return res.status(400).json({ error: 'routeName is required' });
    }
    
    const routeConfig = this.manifest.routes[routeName];
    
    if (!routeConfig) {
      return res.status(404).json({ error: 'Route not found' });
    }
    
    await this.attemptRouteRepair(routeName, routeConfig);
    
    const currentStatus = this.routeRegistry.get(routeName);
    
    res.json({
      routeName,
      repaired: currentStatus?.healthy || false,
      status: currentStatus
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
}

startHealthMonitoring() {
setInterval(async () => {
await this.checkAllRoutesHealth();
}, this.healthCheckInterval);
}

async checkAllRoutesHealth() {
const checkPromises = [];

text
for (const [routeName, routeInfo] of this.routeRegistry) {
  checkPromises.push(this.checkRouteHealth(routeName, routeInfo));
}

await Promise.allSettled(checkPromises);

// Backup registry after health check
await this.backupRouteRegistry();

// Update manifest if any changes
await this.saveManifest();
}

async checkRouteHealth(routeName, routeInfo) {
try {
// Skip if recently checked and healthy
if (routeInfo.healthy && routeInfo.lastChecked) {
const lastChecked = new Date(routeInfo.lastChecked);
const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

text
    if (lastChecked > fiveMinutesAgo) {
      return;
    }
  }
  
  // Check if route file exists
  const routeFile = path.resolve(__dirname, routeInfo.file);
  const fileExists = await this.fileExists(routeFile);
  
  if (!fileExists) {
    throw new Error('Route file missing');
  }
  
  // For critical routes, we could make an actual HTTP request
  // For now, just check file existence and content
  const stats = await fs.stat(routeFile);
  if (stats.size === 0) {
    throw new Error('Route file is empty');
  }
  
  // Update registry with health status
  this.routeRegistry.set(routeName, {
    ...routeInfo,
    healthy: true,
    lastChecked: new Date().toISOString(),
    fileSize: stats.size,
    lastModified: stats.mtime
  });
  
} catch (error) {
  console.warn(`⚠️  Route health check failed for ${routeName}:`, error.message);
  
  this.routeRegistry.set(routeName, {
    ...routeInfo,
    healthy: false,
    lastChecked: new Date().toISOString(),
    error: error.message
  });
  
  // Auto-repair non-immutable routes
  if (!routeInfo.immutable) {
    setTimeout(async () => {
      await this.attemptRouteRepair(routeName, routeInfo);
    }, 5000);
  }
}
}

async addRoute(routeName, routeConfig) {
// Validate route config
this.validateRouteConfig(routeConfig);

text
// Check for conflicts
await this.checkRouteConflicts(routeConfig);

// Add to manifest
this.manifest.routes[routeName] = {
  ...routeConfig,
  added: new Date().toISOString()
};

// Update checksum
this.updateManifestChecksum();

// Save manifest
await this.saveManifest();

// Create route file
await this.createRouteFile(routeName, routeConfig);

// Register route
await this.registerRoute(routeName, routeConfig);

// Create backup
await this.backupRouteAddition(routeName, routeConfig);

return {
  success: true,
  routeName,
  path: routeConfig.path,
  method: routeConfig.method
};
}

validateRouteConfig(config) {
const required = ['path', 'method', 'file'];

text
for (const field of required) {
  if (!config[field]) {
    throw new Error(`Missing required field: ${field}`);
  }
}

// Validate method
const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
if (!validMethods.includes(config.method.toUpperCase())) {
  throw new Error(`Invalid method: ${config.method}`);
}

// Validate path starts with /
if (!config.path.startsWith('/')) {
  throw new Error('Route path must start with /');
}
}

async checkRouteConflicts(config) {
for (const [existingName, existingConfig] of Object.entries(this.manifest.routes)) {
if (existingConfig.path === config.path && existingConfig.method === config.method) {
throw new Error(Route conflict: ${config.method} ${config.path} already exists as ${existingName});
}
}
}

async createRouteFile(routeName, routeConfig) {
const routeFile = path.resolve(__dirname, routeConfig.file);

text
// Ensure directory exists
await fs.mkdir(path.dirname(routeFile), { recursive: true });

let routeContent;

if (routeConfig.template) {
  // Use provided template
  routeContent = routeConfig.template;
} else if (routeConfig.handler) {
  // Generate from handler function string
  routeContent = this.generateRouteFromHandler(routeName, routeConfig);
} else {
  // Generate default template
  routeContent = this.generateRouteTemplate(routeName, routeConfig);
}

await fs.writeFile(routeFile, routeContent.trim());

// Verify the file was created
if (!await this.fileExists(routeFile)) {
  throw new Error(`Failed to create route file: ${routeFile}`);
}
}

generateRouteFromHandler(routeName, routeConfig) {
const routeNameCamel = routeName.replace(/[^a-zA-Z0-9]/g, '');

text
return `
  module.exports = function ${routeNameCamel}Router() {
    const express = require('express');
    const router = express.Router();
    
    ${routeConfig.handler}
    
    return router;
  };
`;
}

async backupRouteAddition(routeName, routeConfig) {
const backupDir = path.join(this.backupPath, 'hourly');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupFile = path.join(backupDir, route_add_${timestamp}.json);

text
const backupData = {
  action: 'add_route',
  timestamp,
  routeName,
  routeConfig,
  manifestSnapshot: this.manifest
};

await fs.writeFile(backupFile, JSON.stringify(backupData, null, 2));
}

async removeRoute(routeName, archive = true) {
const routeConfig = this.manifest.routes[routeName];

text
if (!routeConfig) {
  throw new Error(`Route not found: ${routeName}`);
}

// Don't allow removal of immutable routes
if (routeConfig.immutable) {
  throw new Error(`Cannot remove immutable route: ${routeName}`);
}

if (archive) {
  // Archive instead of delete
  await this.archiveRoute(routeName, routeConfig);
}

// Remove from manifest
delete this.manifest.routes[routeName];

// Update checksum
this.updateManifestChecksum();

// Save manifest
await this.saveManifest();

// Remove from registry
this.routeRegistry.delete(routeName);

// Don't delete the file, just mark as archived
// This allows for recovery if needed

return {
  success: true,
  routeName,
  archived: archive,
  timestamp: new Date().toISOString()
};
}

async archiveRoute(routeName, routeConfig) {
const archiveDir = path.join(this.backupPath, 'archived', routeName);
await fs.mkdir(archiveDir, { recursive: true });

text
const archiveData = {
  routeName,
  routeConfig,
  archived: new Date().toISOString(),
  manifestAtTime: this.manifest
};

// Archive the route file if it exists
const routeFile = path.resolve(__dirname, routeConfig.file);
if (await this.fileExists(routeFile)) {
  const fileContent = await fs.readFile(routeFile, 'utf8');
  archiveData.fileContent = fileContent;
  
  await fs.writeFile(
    path.join(archiveDir, 'route.js'),
    fileContent
  );
}

await fs.writeFile(
  path.join(archiveDir, 'archive.json'),
  JSON.stringify(archiveData, null, 2)
);
}

async updateManifestRoute(routeName, updates) {
if (!this.manifest.routes[routeName]) {
throw new Error(Route not found in manifest: ${routeName});
}

text
// Don't allow updates to immutable routes
if (this.manifest.routes[routeName].immutable && updates.immutable === false) {
  throw new Error(`Cannot change immutable status of route: ${routeName}`);
}

this.manifest.routes[routeName] = {
  ...this.manifest.routes[routeName],
  ...updates,
  lastUpdated: new Date().toISOString()
};

this.updateManifestChecksum();
await this.saveManifest();

// Update registry
if (this.routeRegistry.has(routeName)) {
  const current = this.routeRegistry.get(routeName);
  this.routeRegistry.set(routeName, {
    ...current,
    ...updates
  });
}
}

updateManifestChecksum() {
const routesString = JSON.stringify(this.manifest.routes);
this.manifest.checksum = this.calculateChecksum(routesString);
this.manifest.lastUpdated = new Date().toISOString();
}

calculateChecksum(data) {
const crypto = require('crypto');
return crypto.createHash('sha256').update(data).digest('hex');
}

async saveManifest() {
// Create backup before saving
await this.backupManifest();

text
// Save current manifest
await fs.writeFile(
  this.manifestPath,
  JSON.stringify(this.manifest, null, 2)
);

// Verify save was successful
const savedData = await fs.readFile(this.manifestPath, 'utf8');
const savedManifest = JSON.parse(savedData);

if (savedManifest.checksum !== this.manifest.checksum) {
  throw new Error('Manifest checksum mismatch after save');
}
}

async backupManifest() {
const backupDir = path.join(this.backupPath, 'hourly');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupFile = path.join(backupDir, manifest_${timestamp}.json);

text
await fs.writeFile(backupFile, JSON.stringify(this.manifest, null, 2));

// Also keep a daily backup
const today = new Date().toISOString().split('T')[0];
const dailyBackup = path.join(this.backupPath, 'daily', `manifest_${today}.json`);
await fs.writeFile(dailyBackup, JSON.stringify(this.manifest, null, 2));
}

async backupRouteRegistry() {
const backupDir = path.join(this.backupPath, 'hourly');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupFile = path.join(backupDir, registry_${timestamp}.json);

text
const registryData = {
  timestamp,
  totalRoutes: this.routeRegistry.size,
  routes: Array.from(this.routeRegistry.entries()).reduce((acc, [name, config]) => {
    acc[name] = config;
    return acc;
  }, {})
};

await fs.writeFile(backupFile, JSON.stringify(registryData, null, 2));
}

async repairManifest() {
console.log('🛠️ Repairing manifest...');

text
// Create backup of corrupted manifest
const corruptedBackup = path.join(this.backupPath, 'recovery', `manifest_corrupted_${Date.now()}.json`);
if (await this.fileExists(this.manifestPath)) {
  const corruptedData = await fs.readFile(this.manifestPath, 'utf8');
  await fs.writeFile(corruptedBackup, corruptedData);
}

// Recreate manifest from existing route files
const newManifest = {
  version: this.manifest?.version || '1.0.0',
  created: new Date().toISOString(),
  routes: {},
  checksum: ''
};

// Scan routes directory
await this.scanAndRebuildRoutes(newManifest);

// Update checksum
const routesString = JSON.stringify(newManifest.routes);
newManifest.checksum = this.calculateChecksum(routesString);

// Save repaired manifest
this.manifest = newManifest;
await this.saveManifest();

console.log('✅ Manifest repaired');

// Re-register all routes
await this.registerAllRoutes();
}

async scanAndRebuildRoutes(manifest) {
const routeFiles = await this.findRouteFiles();

text
for (const file of routeFiles) {
  const routeName = this.extractRouteNameFromFile(file);
  const routeConfig = await this.inferRouteConfig(file);
  
  if (routeName && routeConfig) {
    manifest.routes[routeName] = routeConfig;
  }
}

// Add immutable routes if missing
const immutableRoutes = {
  recovery: {
    path: '/api/recovery',
    method: 'POST',
    file: './routes/recovery.js',
    immutable: true
  }
};

for (const [name, config] of Object.entries(immutableRoutes)) {
  if (!manifest.routes[name]) {
    manifest.routes[name] = config;
  }
}
}

async findRouteFiles() {
const files = [];

text
async function scanDir(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      await scanDir(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
}

await scanDir(this.routesPath);
return files;
}

extractRouteNameFromFile(filePath) {
const relativePath = path.relative(this.routesPath, filePath);
return path.basename(relativePath, '.js');
}

async inferRouteConfig(filePath) {
try {
const content = await fs.readFile(filePath, 'utf8');

text
  // Simple regex to find router methods (crude but works for recovery)
  const methodMatch = content.match(/router\.(get|post|put|delete)\(['"]([^'"]+)['"]/i);
  
  if (methodMatch) {
    return {
      path: methodMatch[2] || '/',
      method: methodMatch[1].toUpperCase(),
      file: `./routes/${path.relative(this.routesPath, filePath)}`,
      immutable: content.includes('immutable') || false,
      inferred: true
    };
  }
} catch (error) {
  console.error(`Error inferring config for ${filePath}:`, error);
}

return null;
}

async reconstructRoutes(targetManifest) {
console.log('🔨 Reconstructing routes from manifest...');

text
// Clear current registry
this.routeRegistry.clear();

// Recreate all route files
for (const [routeName, routeConfig] of Object.entries(targetManifest.routes || this.manifest.routes)) {
  try {
    await this.createRouteFile(routeName, routeConfig);
    await this.registerRoute(routeName, routeConfig);
  } catch (error) {
    console.error(`Failed to reconstruct route ${routeName}:`, error);
  }
}

console.log(`✅ Reconstructed ${this.routeRegistry.size} routes`);
}

async fileExists(filePath) {
try {
await fs.access(filePath);
return true;
} catch {
return false;
}
}

getRouter() {
return this.router;
}

async getRouteStatus() {
const routes = Array.from(this.routeRegistry.entries()).map(([name, config]) => ({
name,
path: config.path,
method: config.method,
healthy: config.healthy,
lastChecked: config.lastChecked,
immutable: config.immutable
}));

text
return {
  timestamp: new Date().toISOString(),
  total: routes.length,
  healthy: routes.filter(r => r.healthy).length,
  routes
};
}

async getManifest() {
return {
...this.manifest,
routeCount: Object.keys(this.manifest.routes).length
};
}
}

module.exports = SelfHealingRouter;
