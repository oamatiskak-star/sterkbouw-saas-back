const express = require('express');
const fs = require('fs').promises;
const path = require('path');

module.exports = function backupRouter() {
const router = express.Router();

// GET backup status
router.get('/', async (req, res) => {
try {
const backupInfo = await getBackupInfo();

text
  res.json({
    timestamp: new Date().toISOString(),
    status: 'available',
    info: backupInfo
  });
} catch (error) {
  res.status(500).json({
    error: error.message,
    timestamp: new Date().toISOString()
  });
}
});

// POST create backup
router.post('/create', async (req, res) => {
try {
const { type = 'manual', label = 'manual-backup', components = ['commands', 'routes', 'config'] } = req.body;

text
  const backupId = `backup_${Date.now()}_${label.replace(/\s+/g, '_')}`;
  const backupDir = path.join(__dirname, '../backups/manual/', backupId);
  
  await fs.mkdir(backupDir, { recursive: true });
  
  const backupResults = {};
  
  // Backup commands
  if (components.includes('commands')) {
    try {
      const commandRegistry = req.app.get('commandRegistry');
      if (commandRegistry) {
        await commandRegistry.createDailyBackup();
        backupResults.commands = { status: 'backed_up' };
      }
    } catch (error) {
      backupResults.commands = { status: 'failed', error: error.message };
    }
  }
  
  // Backup routes
  if (components.includes('routes')) {
    try {
      const routerService = req.app.get('router');
      if (routerService) {
        const manifestPath = path.join(__dirname, '../core/routes/route-manifest.json');
        if (await fileExists(manifestPath)) {
          const manifest = await fs.readFile(manifestPath, 'utf8');
          await fs.writeFile(path.join(backupDir, 'route-manifest.json'), manifest);
          backupResults.routes = { status: 'backed_up' };
        }
      }
    } catch (error) {
      backupResults.routes = { status: 'failed', error: error.message };
    }
  }
  
  // Backup configuration
  if (components.includes('config')) {
    try {
      const configFiles = [
        '../config/server.js',
        '../config/database.js',
        '../config/commands.js',
        '../.env.example'
      ];
      
      for (const configFile of configFiles) {
        const sourcePath = path.join(__dirname, configFile);
        if (await fileExists(sourcePath)) {
          const content = await fs.readFile(sourcePath, 'utf8');
          const fileName = path.basename(configFile);
          await fs.writeFile(path.join(backupDir, fileName), content);
        }
      }
      
      backupResults.config = { status: 'backed_up', files: configFiles.length };
    } catch (error) {
      backupResults.config = { status: 'failed', error: error.message };
    }
  }
  
  // Create backup manifest
  const manifest = {
    id: backupId,
    type,
    label,
    timestamp: new Date().toISOString(),
    components,
    results: backupResults
  };
  
  await fs.writeFile(
    path.join(backupDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
  
  res.json({
    status: 'backup_created',
    backupId,
    manifest,
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
router.get('/list', async (req, res) => {
try {
const backupTypes = ['manual', 'hourly', 'daily', 'recovery-points'];
const backups = {};

text
  for (const type of backupTypes) {
    const backupTypeDir = path.join(__dirname, `../backups/${type}/`);
    
    if (await fileExists(backupTypeDir)) {
      const entries = await fs.readdir(backupTypeDir, { withFileTypes: true });
      const backupDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
      
      backups[type] = {
        count: backupDirs.length,
        backups: await Promise.all(
          backupDirs.slice(0, 10).map(async dir => {
            const manifestPath = path.join(backupTypeDir, dir, 'manifest.json');
            if (await fileExists(manifestPath)) {
              try {
                const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
                return {
                  id: dir,
                  timestamp: manifest.timestamp,
                  size: await getDirectorySize(path.join(backupTypeDir, dir))
                };
              } catch (error) {
                return { id: dir, error: 'invalid_manifest' };
              }
            }
            return { id: dir };
          })
        )
      };
    } else {
      backups[type] = { count: 0, backups: [] };
    }
  }
  
  res.json({
    timestamp: new Date().toISOString(),
    backups
  });
} catch (error) {
  res.status(500).json({
    error: error.message,
    timestamp: new Date().toISOString()
  });
}
});

// POST restore from backup
router.post('/restore/:backupId', async (req, res) => {
try {
const { backupId } = req.params;
const { type = 'manual', components = ['commands'] } = req.body;

text
  const backupDir = path.join(__dirname, `../backups/${type}/`, backupId);
  
  if (!await fileExists(backupDir)) {
    return res.status(404).json({
      error: `Backup not found: ${backupId} (type: ${type})`,
      timestamp: new Date().toISOString()
    });
  }
  
  const restoreResults = {};
  
  // Restore commands
  if (components.includes('commands')) {
    try {
      const commandBackup = path.join(backupDir, 'immutable-core.json');
      if (await fileExists(commandBackup)) {
        const commandContent = await fs.readFile(commandBackup, 'utf8');
        const commandTarget = path.join(__dirname, '../core/commands/immutable-core.json');
        await fs.writeFile(commandTarget, commandContent);
        restoreResults.commands = { status: 'restored' };
      }
    } catch (error) {
      restoreResults.commands = { status: 'failed', error: error.message };
    }
  }
  
  // Restore routes
  if (components.includes('routes')) {
    try {
      const routeBackup = path.join(backupDir, 'route-manifest.json');
      if (await fileExists(routeBackup)) {
        const routeContent = await fs.readFile(routeBackup, 'utf8');
        const routeTarget = path.join(__dirname, '../core/routes/route-manifest.json');
        await fs.writeFile(routeTarget, routeContent);
        restoreResults.routes = { status: 'restored' };
      }
    } catch (error) {
      restoreResults.routes = { status: 'failed', error: error.message };
    }
  }
  
  res.json({
    status: 'restore_completed',
    backupId,
    type,
    components,
    results: restoreResults,
    timestamp: new Date().toISOString()
  });
} catch (error) {
  res.status(500).json({
    error: error.message,
    timestamp: new Date().toISOString()
  });
}
});

// DELETE backup
router.delete('/:backupId', async (req, res) => {
try {
const { backupId } = req.params;
const { type = 'manual', force = false } = req.query;

text
  const backupDir = path.join(__dirname, `../backups/${type}/`, backupId);
  
  if (!await fileExists(backupDir)) {
    return res.status(404).json({
      error: `Backup not found: ${backupId}`,
      timestamp: new Date().toISOString()
    });
  }
  
  if (type === 'recovery-points' && !force) {
    return res.status(403).json({
      error: 'Cannot delete recovery-points without force=true',
      warning: 'Recovery points are critical for system recovery',
      timestamp: new Date().toISOString()
    });
  }
  
  await fs.rm(backupDir, { recursive: true, force: true });
  
  res.json({
    status: 'deleted',
    backupId,
    type,
    timestamp: new Date().toISOString()
  });
} catch (error) {
  res.status(500).json({
    error: error.message,
    timestamp: new Date().toISOString()
  });
}
});

// GET backup statistics
router.get('/stats', async (req, res) => {
try {
const backupDir = path.join(__dirname, '../backups/');
const stats = await getBackupStatistics(backupDir);

text
  res.json({
    timestamp: new Date().toISOString(),
    statistics: stats
  });
} catch (error) {
  res.status(500).json({
    error: error.message,
    timestamp: new Date().toISOString()
  });
}
});

async function getBackupInfo() {
const backupDir = path.join(__dirname, '../backups/');

text
const info = {
  totalSize: await getDirectorySize(backupDir),
  lastBackup: await getLastBackupTime(),
  backupTypes: {}
};

const backupTypes = ['commands', 'routes', 'state', 'manual'];

for (const type of backupTypes) {
  const typeDir = path.join(backupDir, type);
  if (await fileExists(typeDir)) {
    const subDirs = await fs.readdir(typeDir, { withFileTypes: true });
    const dirCount = subDirs.filter(e => e.isDirectory()).length;
    const fileCount = subDirs.filter(e => e.isFile()).length;
    
    info.backupTypes[type] = {
      directories: dirCount,
      files: fileCount,
      size: await getDirectorySize(typeDir)
    };
  }
}

return info;
}

async function getLastBackupTime() {
const backupDirs = [
path.join(__dirname, '../backups/commands/hourly/'),
path.join(__dirname, '../backups/manual/')
];

text
let latestTime = null;

for (const dir of backupDirs) {
  try {
    const files = await fs.readdir(dir);
    const jsonFiles = files.filter(f => f.endsWith('.json')).sort().reverse();
    
    if (jsonFiles.length > 0) {
      const latestFile = jsonFiles[0];
      const filePath = path.join(dir, latestFile);
      const stats = await fs.stat(filePath);
      
      if (!latestTime || stats.mtime > latestTime) {
        latestTime = stats.mtime;
      }
    }
  } catch (error) {
    // Ignore missing directories
  }
}

return latestTime ? latestTime.toISOString() : 'never';
}

async function getDirectorySize(dir) {
if (!await fileExists(dir)) {
return { bytes: 0, human: '0 B' };
}

text
let totalSize = 0;
const entries = await fs.readdir(dir, { withFileTypes: true });

for (const entry of entries) {
  const fullPath = path.join(dir, entry.name);
  
  if (entry.isDirectory()) {
    const subSize = await getDirectorySize(fullPath);
    totalSize += subSize.bytes;
  } else if (entry.isFile()) {
    const stats = await fs.stat(fullPath);
    totalSize += stats.size;
  }
}

return {
  bytes: totalSize,
  human: totalSize < 1024 ? `${totalSize} B` :
         totalSize < 1024 * 1024 ? `${(totalSize / 1024).toFixed(2)} KB` :
         `${(totalSize / 1024 / 1024).toFixed(2)} MB`
};
}

async function getBackupStatistics(backupDir) {
const stats = {
totalBackups: 0,
byType: {},
storageUsed: await getDirectorySize(backupDir),
oldestBackup: null,
newestBackup: null
};

text
const backupTypes = await fs.readdir(backupDir, { withFileTypes: true });

for (const type of backupTypes) {
  if (type.isDirectory()) {
    const typePath = path.join(backupDir, type.name);
    const subDirs = await fs.readdir(typePath, { withFileTypes: true });
    const dirs = subDirs.filter(e => e.isDirectory());
    
    stats.byType[type.name] = {
      count: dirs.length,
      size: await getDirectorySize(typePath)
    };
    
    stats.totalBackups += dirs.length;
    
    // Find oldest and newest
    for (const dir of dirs) {
      const dirPath = path.join(typePath, dir.name);
      const dirStats = await fs.stat(dirPath);
      
      if (!stats.oldestBackup || dirStats.birthtime < stats.oldestBackup) {
        stats.oldestBackup = dirStats.birthtime;
      }
      
      if (!stats.newestBackup || dirStats.mtime > stats.newestBackup) {
        stats.newestBackup = dirStats.mtime;
      }
    }
  }
}

if (stats.oldestBackup) {
  stats.oldestBackup = stats.oldestBackup.toISOString();
}

if (stats.newestBackup) {
  stats.newestBackup = stats.newestBackup.toISOString();
}

return stats;
}

async function fileExists(filePath) {
try {
await fs.access(filePath);
return true;
} catch {
return false;
}
}

return router;
};
