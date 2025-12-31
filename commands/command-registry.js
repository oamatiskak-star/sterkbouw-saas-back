const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class ImmutableCommandRegistry {
constructor() {
this.corePath = path.join(__dirname, 'immutable-core.json');
this.dynamicPath = path.join(__dirname, '../../backups/commands/dynamic-commands.json');
this.moduleCommandsPath = path.join(__dirname, '../../modules/commands/');
this.backupPath = path.join(__dirname, '../../backups/commands/');

text
this.commandLayers = {
  CORE: 'core',
  DYNAMIC: 'dynamic',
  MODULE: 'module',
  EMERGENCY: 'emergency'
};
}

async initialize() {
await this.ensureDirectoryStructure();
await this.loadAllCommands();
await this.createInitialBackup();
this.startAutoBackup();
}

async ensureDirectoryStructure() {
const dirs = [
this.backupPath,
path.join(this.backupPath, 'hourly'),
path.join(this.backupPath, 'daily'),
path.join(this.backupPath, 'recovery-points'),
this.moduleCommandsPath
];

text
for (const dir of dirs) {
  await fs.mkdir(dir, { recursive: true });
}
}

async loadAllCommands() {
this.commands = {
[this.commandLayers.CORE]: await this.loadCoreCommands(),
[this.commandLayers.DYNAMIC]: await this.loadDynamicCommands(),
[this.commandLayers.MODULE]: await this.loadModuleCommands(),
[this.commandLayers.EMERGENCY]: await this.loadEmergencyCommands()
};

text
await this.validateCommandIntegrity();
}

async loadCoreCommands() {
try {
const data = await fs.readFile(this.corePath, 'utf8');
return JSON.parse(data);
} catch (error) {
console.error('Failed to load core commands:', error);
return await this.regenerateCoreCommands();
}
}

async loadDynamicCommands() {
try {
if (await this.fileExists(this.dynamicPath)) {
const data = await fs.readFile(this.dynamicPath, 'utf8');
return JSON.parse(data);
}
return { commands: {} };
} catch (error) {
return { commands: {} };
}
}

async loadModuleCommands() {
const moduleCommands = {};

text
try {
  const moduleDirs = await fs.readdir(this.moduleCommandsPath, { withFileTypes: true });
  
  for (const dir of moduleDirs) {
    if (dir.isDirectory()) {
      const moduleFile = path.join(this.moduleCommandsPath, dir.name, 'commands.json');
      if (await this.fileExists(moduleFile)) {
        const data = await fs.readFile(moduleFile, 'utf8');
        moduleCommands[dir.name] = JSON.parse(data);
      }
    }
  }
} catch (error) {
  console.error('Error loading module commands:', error);
}

return moduleCommands;
}

async loadEmergencyCommands() {
return {
system_recovery: {
action: 'emergency_recovery',
handler: './emergency-recovery.js',
immutable: true
},
command_restore: {
action: 'restore_from_backup',
handler: './backup-restore.js',
immutable: true
}
};
}

async regenerateCoreCommands() {
const defaultCommands = {
version: "1.0.0-regenerated",
regenerated: new Date().toISOString(),
commands: {
system_health: {
id: "SYS_HLT_001",
action: "check_system_health",
description: "Check systeem gezondheid"
}
}
};

text
await fs.writeFile(this.corePath, JSON.stringify(defaultCommands, null, 2));
return defaultCommands;
}

async validateCommandIntegrity() {
const requiredCoreCommands = ['system_recovery', 'command_restore', 'route_rebuild'];

text
for (const cmd of requiredCoreCommands) {
  if (!this.commands[this.commandLayers.CORE]?.commands?.[cmd]) {
    throw new Error(`Missing required core command: ${cmd}`);
  }
}
}

async getCommand(commandId) {
// Check in reverse order: MODULE -> DYNAMIC -> CORE -> EMERGENCY
const searchOrder = [
this.commandLayers.MODULE,
this.commandLayers.DYNAMIC,
this.commandLayers.CORE,
this.commandLayers.EMERGENCY
];

text
for (const layer of searchOrder) {
  const layerCommands = this.commands[layer];
  
  if (layer === this.commandLayers.MODULE) {
    for (const moduleName in layerCommands) {
      if (layerCommands[moduleName]?.commands?.[commandId]) {
        return {
          ...layerCommands[moduleName].commands[commandId],
          source: 'module',
          module: moduleName
        };
      }
    }
  } else if (layerCommands?.commands?.[commandId]) {
    return {
      ...layerCommands.commands[commandId],
      source: layer
    };
  }
}

return null;
}

async executeCommand(commandId, parameters = {}) {
const command = await this.getCommand(commandId);

text
if (!command) {
  throw new Error(`Command not found: ${commandId}`);
}

try {
  await this.logExecution(commandId, parameters);
  
  if (command.handler) {
    const handler = require(path.resolve(__dirname, command.handler));
    return await handler.execute(parameters);
  }
  
  return await this.handleBuiltInCommand(command, parameters);
} catch (error) {
  await this.logError(commandId, error);
  
  // Fallback to emergency recovery if execution fails
  if (commandId !== 'system_recovery') {
    return await this.executeCommand('system_recovery', { failedCommand: commandId });
  }
  
  throw error;
}
}

async handleBuiltInCommand(command, parameters) {
switch (command.action) {
case 'create_isolated_module':
return await this.createIsolatedModule(parameters);
case 'auto_update_menu':
return await this.autoUpdateMenu(parameters);
case 'autonomous_bulk_import':
return await this.bulkImport(parameters);
default:
throw new Error(Unknown built-in command: ${command.action});
}
}

async createIsolatedModule(moduleInfo) {
const moduleId = ${Date.now()}_${moduleInfo.name.replace(/\s+/g, '_')};
const modulePath = path.join(__dirname, '../../modules/', moduleId);

text
await fs.mkdir(modulePath, { recursive: true });

// Create module structure without touching core
const moduleStructure = {
  'package.json': JSON.stringify({
    name: moduleInfo.name,
    version: "1.0.0",
    private: true
  }, null, 2),
  'index.js': `
    module.exports = {
      name: "${moduleInfo.name}",
      initialize: async function() {
        console.log("Module ${moduleInfo.name} initialized");
        return { status: "active" };
      }
    };
  `,
  'commands.json': JSON.stringify({
    commands: moduleInfo.commands || {}
  }, null, 2)
};

for (const [fileName, content] of Object.entries(moduleStructure)) {
  await fs.writeFile(path.join(modulePath, fileName), content);
}

// Auto-update menu without modifying original
await this.autoUpdateMenu({
  action: 'add_module',
  moduleId,
  moduleName: moduleInfo.name
});

return {
  moduleId,
  path: modulePath,
  status: 'created_isolated'
};
}

async autoUpdateMenu(updateInfo) {
const menuPath = path.join(__dirname, '../../backups/menu/menu-latest.json');
await fs.mkdir(path.dirname(menuPath), { recursive: true });

text
let currentMenu = { items: [] };

if (await this.fileExists(menuPath)) {
  const data = await fs.readFile(menuPath, 'utf8');
  currentMenu = JSON.parse(data);
}

// Append-only modification
currentMenu.items.push({
  ...updateInfo,
  added: new Date().toISOString()
});

await fs.writeFile(menuPath, JSON.stringify(currentMenu, null, 2));

// Create backup of menu change
await this.backupFile(menuPath, 'menu');

return { status: 'menu_updated', changeId: Date.now() };
}

async bulkImport(importData) {
const importId = import_${Date.now()};
const importPath = path.join(__dirname, '../../backups/imports/', importId);

text
await fs.mkdir(importPath, { recursive: true });

// Save import manifest
const manifest = {
  id: importId,
  timestamp: new Date().toISOString(),
  source: importData.source,
  items: importData.items?.length || 0
};

await fs.writeFile(
  path.join(importPath, 'manifest.json'),
  JSON.stringify(manifest, null, 2)
);

// Process each item independently
const results = [];

for (const item of importData.items || []) {
  try {
    const result = await this.processImportItem(item, importPath);
    results.push(result);
  } catch (error) {
    results.push({
      item: item.id || 'unknown',
      status: 'failed',
      error: error.message
    });
  }
}

// Auto-create routes if needed
if (importData.createRoutes) {
  await this.autoCreateRoutes(importPath, results);
}

return {
  importId,
  processed: results.length,
  successful: results.filter(r => r.status === 'success').length,
  results
};
}

async processImportItem(item, importPath) {
const itemId = item.id || item_${Date.now()};
const itemPath = path.join(importPath, 'items', itemId);

text
await fs.mkdir(itemPath, { recursive: true });

// Save item data
await fs.writeFile(
  path.join(itemPath, 'data.json'),
  JSON.stringify(item, null, 2)
);

// Generate unique files if needed
if (item.type === 'component') {
  await this.generateComponentFiles(item, itemPath);
} else if (item.type === 'route') {
  await this.generateRouteFiles(item, itemPath);
}

return {
  itemId,
  status: 'success',
  path: itemPath
};
}

async generateComponentFiles(component, targetPath) {
const componentFiles = {
'Component.jsx': `
import React from 'react';

text
    export default function ${component.name}() {
      return (
        <div className="${component.name.toLowerCase()}">
          ${component.name} Component
        </div>
      );
    }
  `,
  'component.module.css': `
    .${component.name.toLowerCase()} {
      padding: 1rem;
    }
  `
};

for (const [fileName, content] of Object.entries(componentFiles)) {
  await fs.writeFile(path.join(targetPath, fileName), content);
}
}

async generateRouteFiles(route, targetPath) {
const routeFiles = {
'route.js': `
const express = require('express');
const router = express.Router();

text
    router.get('${route.path}', (req, res) => {
      res.json({ route: '${route.name}', status: 'active' });
    });
    
    module.exports = router;
  `,
  'route-info.json': JSON.stringify(route, null, 2)
};

for (const [fileName, content] of Object.entries(routeFiles)) {
  await fs.writeFile(path.join(targetPath, fileName), content);
}
}

async autoCreateRoutes(importPath, items) {
const routes = items
.filter(item => item.path)
.map(item => ({
path: /${item.itemId},
handler: item.path,
method: 'GET'
}));

text
if (routes.length > 0) {
  const routeManifest = {
    generated: new Date().toISOString(),
    importId: path.basename(importPath),
    routes
  };
  
  await fs.writeFile(
    path.join(importPath, 'routes-generated.json'),
    JSON.stringify(routeManifest, null, 2)
  );
}
}

async addDynamicCommand(command) {
const dynamicCommands = await this.loadDynamicCommands();

text
// Generate unique ID
const commandId = `DYN_${Date.now()}_${command.name.replace(/\s+/g, '_')}`;

dynamicCommands.commands[commandId] = {
  ...command,
  id: commandId,
  added: new Date().toISOString()
};

await fs.writeFile(this.dynamicPath, JSON.stringify(dynamicCommands, null, 2));

// Immediate backup
await this.backupFile(this.dynamicPath, 'commands');

return commandId;
}

async removeDynamicCommand(commandId) {
const dynamicCommands = await this.loadDynamicCommands();

text
if (dynamicCommands.commands[commandId]) {
  // Archive instead of delete
  const archivePath = path.join(this.backupPath, 'archived', `${commandId}.json`);
  await fs.mkdir(path.dirname(archivePath), { recursive: true });
  
  await fs.writeFile(archivePath, JSON.stringify({
    command: dynamicCommands.commands[commandId],
    archived: new Date().toISOString(),
    reason: 'removed'
  }, null, 2));
  
  delete dynamicCommands.commands[commandId];
  await fs.writeFile(this.dynamicPath, JSON.stringify(dynamicCommands, null, 2));
  
  return { status: 'archived', archivePath };
}

throw new Error(`Dynamic command not found: ${commandId}`);
}

async createInitialBackup() {
const backupId = initial_${Date.now()};
const backupDir = path.join(this.backupPath, 'recovery-points', backupId);

text
await fs.mkdir(backupDir, { recursive: true });

const filesToBackup = [
  this.corePath,
  this.dynamicPath
];

for (const file of filesToBackup) {
  if (await this.fileExists(file)) {
    await this.backupFile(file, 'recovery-points', backupId);
  }
}

await this.saveBackupManifest(backupDir);
}

async startAutoBackup() {
// Hourly backups
setInterval(async () => {
await this.createHourlyBackup();
}, 60 * 60 * 1000);

text
// Daily backups
setInterval(async () => {
  await this.createDailyBackup();
}, 24 * 60 * 60 * 1000);
}

async createHourlyBackup() {
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupFile = path.join(this.backupPath, 'hourly', commands_${timestamp}.json);

text
const allCommands = {
  core: this.commands[this.commandLayers.CORE],
  dynamic: this.commands[this.commandLayers.DYNAMIC],
  modules: this.commands[this.commandLayers.MODULE],
  timestamp
};

await fs.writeFile(backupFile, JSON.stringify(allCommands, null, 2));

// Keep only last 24 hourly backups
await this.cleanupOldBackups('hourly', 24);
}

async createDailyBackup() {
const date = new Date().toISOString().split('T')[0];
const backupFile = path.join(this.backupPath, 'daily', commands_${date}.json);

text
const allCommands = {
  core: this.commands[this.commandLayers.CORE],
  dynamic: this.commands[this.commandLayers.DYNAMIC],
  modules: this.commands[this.commandLayers.MODULE],
  date
};

await fs.writeFile(backupFile, JSON.stringify(allCommands, null, 2));

// Keep only last 30 daily backups
await this.cleanupOldBackups('daily', 30);
}

async cleanupOldBackups(type, keepLast) {
const backupDir = path.join(this.backupPath, type);

text
try {
  const files = await fs.readdir(backupDir);
  const backupFiles = files
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse();
  
  if (backupFiles.length > keepLast) {
    const toDelete = backupFiles.slice(keepLast);
    
    for (const file of toDelete) {
      await fs.unlink(path.join(backupDir, file));
    }
  }
} catch (error) {
  console.error(`Error cleaning up ${type} backups:`, error);
}
}

async backupFile(sourcePath, backupType, subdir = '') {
const fileName = path.basename(sourcePath);
const backupDir = subdir
? path.join(this.backupPath, backupType, subdir)
: path.join(this.backupPath, backupType);

text
await fs.mkdir(backupDir, { recursive: true });

const content = await fs.readFile(sourcePath, 'utf8');
const backupPath = path.join(backupDir, fileName);

await fs.writeFile(backupPath, content);

// Calculate checksum for verification
const checksum = crypto.createHash('sha256').update(content).digest('hex');

return {
  backupPath,
  checksum,
  timestamp: new Date().toISOString()
};
}

async saveBackupManifest(backupDir) {
const manifest = {
timestamp: new Date().toISOString(),
system: 'autonomous-executor',
version: '1.0.0',
contents: await this.scanBackupContents(backupDir)
};

text
await fs.writeFile(
  path.join(backupDir, 'manifest.json'),
  JSON.stringify(manifest, null, 2)
);
}

async scanBackupContents(backupDir) {
const contents = [];

text
try {
  const files = await fs.readdir(backupDir, { withFileTypes: true });
  
  for (const file of files) {
    if (file.isFile()) {
      const filePath = path.join(backupDir, file.name);
      const stats = await fs.stat(filePath);
      
      contents.push({
        name: file.name,
        size: stats.size,
        modified: stats.mtime
      });
    }
  }
} catch (error) {
  console.error('Error scanning backup contents:', error);
}

return contents;
}

async logExecution(commandId, parameters) {
const logPath = path.join(__dirname, '../../logs/executions.log');
await fs.mkdir(path.dirname(logPath), { recursive: true });

text
const logEntry = {
  timestamp: new Date().toISOString(),
  commandId,
  parameters,
  layer: await this.getCommandLayer(commandId)
};

await fs.appendFile(logPath, JSON.stringify(logEntry) + '\n');
}

async logError(commandId, error) {
const logPath = path.join(__dirname, '../../logs/errors.log');
await fs.mkdir(path.dirname(logPath), { recursive: true });

text
const logEntry = {
  timestamp: new Date().toISOString(),
  commandId,
  error: error.message,
  stack: error.stack
};

await fs.appendFile(logPath, JSON.stringify(logEntry) + '\n');
}

async getCommandLayer(commandId) {
for (const [layer, commands] of Object.entries(this.commands)) {
if (layer === this.commandLayers.MODULE) {
for (const moduleName in commands) {
if (commands[moduleName]?.commands?.[commandId]) {
return module:${moduleName};
}
}
} else if (commands?.commands?.[commandId]) {
return layer;
}
}

text
return 'unknown';
}

async fileExists(filePath) {
try {
await fs.access(filePath);
return true;
} catch {
return false;
}
}

async restoreFromBackup(backupType = 'recovery-points', backupId = null) {
let backupDir;

text
if (backupId) {
  backupDir = path.join(this.backupPath, backupType, backupId);
} else {
  // Find latest backup
  const backupsDir = path.join(this.backupPath, backupType);
  const files = await fs.readdir(backupsDir);
  const backupDirs = files.filter(f => 
    fs.statSync(path.join(backupsDir, f)).isDirectory()
  ).sort().reverse();
  
  if (backupDirs.length === 0) {
    throw new Error(`No backups found in ${backupType}`);
  }
  
  backupDir = path.join(backupsDir, backupDirs[0]);
}

// Restore core commands
const coreBackup = path.join(backupDir, 'immutable-core.json');
if (await this.fileExists(coreBackup)) {
  await fs.copyFile(coreBackup, this.corePath);
}

// Restore dynamic commands
const dynamicBackup = path.join(backupDir, 'dynamic-commands.json');
if (await this.fileExists(dynamicBackup)) {
  await fs.copyFile(dynamicBackup, this.dynamicPath);
}

// Reload all commands
await this.loadAllCommands();

return {
  restoredFrom: backupDir,
  timestamp: new Date().toISOString()
};
}

async listAllCommands() {
const allCommands = [];

text
for (const [layer, commands] of Object.entries(this.commands)) {
  if (layer === this.commandLayers.MODULE) {
    for (const moduleName in commands) {
      const moduleCmds = commands[moduleName]?.commands || {};
      for (const [cmdId, cmd] of Object.entries(moduleCmds)) {
        allCommands.push({
          id: cmdId,
          ...cmd,
          layer: `module:${moduleName}`
        });
      }
    }
  } else {
    const layerCmds = commands?.commands || {};
    for (const [cmdId, cmd] of Object.entries(layerCmds)) {
      allCommands.push({
        id: cmdId,
        ...cmd,
        layer
      });
    }
  }
}

return allCommands;
}

async getStats() {
const stats = {
total: 0,
byLayer: {},
lastBackup: await this.getLastBackupTime()
};

text
for (const [layer, commands] of Object.entries(this.commands)) {
  if (layer === this.commandLayers.MODULE) {
    let moduleCount = 0;
    for (const moduleName in commands) {
      moduleCount += Object.keys(commands[moduleName]?.commands || {}).length;
    }
    stats.byLayer[layer] = moduleCount;
    stats.total += moduleCount;
  } else {
    const count = Object.keys(commands?.commands || {}).length;
    stats.byLayer[layer] = count;
    stats.total += count;
  }
}

return stats;
}

async getLastBackupTime() {
try {
const backupDir = path.join(this.backupPath, 'hourly');
const files = await fs.readdir(backupDir);
const backupFiles = files.filter(f => f.endsWith('.json')).sort().reverse();

text
  if (backupFiles.length > 0) {
    const latestFile = backupFiles[0];
    const filePath = path.join(backupDir, latestFile);
    const stats = await fs.stat(filePath);
    return stats.mtime;
  }
} catch (error) {
  return null;
}
}
}

module.exports = ImmutableCommandRegistry;
