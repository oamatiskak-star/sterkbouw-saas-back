const express = require('express');
const fs = require('fs').promises;
const path = require('path');

module.exports = function modulesRouter() {
const router = express.Router();

// GET all modules
router.get('/', async (req, res) => {
try {
const modulesDir = path.join(__dirname, '../modules/');
const modules = [];

text
  if (await fileExists(modulesDir)) {
    const entries = await fs.readdir(modulesDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const modulePath = path.join(modulesDir, entry.name);
        const moduleInfo = await getModuleInfo(modulePath, entry.name);
        modules.push(moduleInfo);
      }
    }
  }
  
  res.json({
    timestamp: new Date().toISOString(),
    total: modules.length,
    modules
  });
} catch (error) {
  res.status(500).json({
    error: error.message,
    timestamp: new Date().toISOString()
  });
}
});

// GET specific module
router.get('/:moduleId', async (req, res) => {
try {
const { moduleId } = req.params;
const modulePath = path.join(__dirname, '../modules/', moduleId);

text
  if (!await fileExists(modulePath)) {
    return res.status(404).json({
      error: `Module not found: ${moduleId}`,
      timestamp: new Date().toISOString()
    });
  }
  
  const moduleInfo = await getModuleInfo(modulePath, moduleId);
  
  res.json({
    module: moduleId,
    info: moduleInfo,
    timestamp: new Date().toISOString()
  });
} catch (error) {
  res.status(500).json({
    error: error.message,
    timestamp: new Date().toISOString()
  });
}
});

// POST create new module
router.post('/create', async (req, res) => {
try {
const commandRegistry = req.app.get('commandRegistry');
const { name, description, template = 'basic-module', commands = [] } = req.body;

text
  if (!name) {
    return res.status(400).json({
      error: 'Module name is required',
      timestamp: new Date().toISOString()
    });
  }
  
  if (!commandRegistry) {
    return res.status(503).json({
      error: 'Command registry not available',
      timestamp: new Date().toISOString()
    });
  }
  
  // Use command registry to create isolated module
  const result = await commandRegistry.createIsolatedModule({
    name,
    description,
    template,
    commands
  });
  
  res.json({
    status: 'created',
    module: result,
    timestamp: new Date().toISOString(),
    note: 'Module created in isolation without touching core system'
  });
} catch (error) {
  res.status(400).json({
    error: error.message,
    timestamp: new Date().toISOString()
  });
}
});

// DELETE module (archive)
router.delete('/:moduleId', async (req, res) => {
try {
const { moduleId } = req.params;
const { archive = true } = req.query;

text
  const modulePath = path.join(__dirname, '../modules/', moduleId);
  const archivePath = path.join(__dirname, '../modules/archived/', moduleId);
  
  if (!await fileExists(modulePath)) {
    return res.status(404).json({
      error: `Module not found: ${moduleId}`,
      timestamp: new Date().toISOString()
    });
  }
  
  if (archive) {
    // Move to archive instead of delete
    await fs.mkdir(path.dirname(archivePath), { recursive: true });
    await fs.rename(modulePath, archivePath);
    
    res.json({
      status: 'archived',
      module: moduleId,
      archivePath,
      timestamp: new Date().toISOString(),
      note: 'Module archived, can be restored if needed'
    });
  } else {
    // Actually delete (dangerous)
    await fs.rm(modulePath, { recursive: true, force: true });
    
    res.json({
      status: 'deleted',
      module: moduleId,
      timestamp: new Date().toISOString(),
      warning: 'Module permanently deleted'
    });
  }
} catch (error) {
  res.status(500).json({
    error: error.message,
    timestamp: new Date().toISOString()
  });
}
});

// POST activate/deactivate module
router.post('/:moduleId/:action', async (req, res) => {
try {
const { moduleId, action } = req.params;
const modulePath = path.join(__dirname, '../modules/', moduleId);

text
  if (!await fileExists(modulePath)) {
    return res.status(404).json({
      error: `Module not found: ${moduleId}`,
      timestamp: new Date().toISOString()
    });
  }
  
  const moduleInfo = await getModuleInfo(modulePath, moduleId);
  
  switch (action) {
    case 'activate':
      // In a real system, this would load the module
      moduleInfo.status = 'active';
      await updateModuleStatus(modulePath, 'active');
      break;
      
    case 'deactivate':
      moduleInfo.status = 'inactive';
      await updateModuleStatus(modulePath, 'inactive');
      break;
      
    case 'reload':
      moduleInfo.status = 'reloaded';
      await updateModuleStatus(modulePath, 'active');
      break;
      
    default:
      return res.status(400).json({
        error: `Unknown action: ${action}`,
        available: ['activate', 'deactivate', 'reload']
      });
  }
  
  res.json({
    action,
    module: moduleId,
    status: moduleInfo.status,
    timestamp: new Date().toISOString()
  });
} catch (error) {
  res.status(500).json({
    error: error.message,
    timestamp: new Date().toISOString()
  });
}
});

// GET module templates
router.get('/templates/available', async (req, res) => {
try {
const templatesDir = path.join(__dirname, '../templates/modules/');
const templates = [];

text
  if (await fileExists(templatesDir)) {
    const entries = await fs.readdir(templatesDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const templatePath = path.join(templatesDir, entry.name);
        const templateInfo = await getTemplateInfo(templatePath, entry.name);
        templates.push(templateInfo);
      }
    }
  }
  
  res.json({
    timestamp: new Date().toISOString(),
    total: templates.length,
    templates
  });
} catch (error) {
  res.status(500).json({
    error: error.message,
    timestamp: new Date().toISOString()
  });
}
});

// POST create from template
router.post('/create-from-template', async (req, res) => {
try {
const { templateName, moduleName, variables = {} } = req.body;

text
  if (!templateName || !moduleName) {
    return res.status(400).json({
      error: 'templateName and moduleName are required',
      timestamp: new Date().toISOString()
    });
  }
  
  const templatePath = path.join(__dirname, '../templates/modules/', templateName);
  const modulePath = path.join(__dirname, '../modules/', moduleName);
  
  if (!await fileExists(templatePath)) {
    return res.status(404).json({
      error: `Template not found: ${templateName}`,
      timestamp: new Date().toISOString()
    });
  }
  
  if (await fileExists(modulePath)) {
    return res.status(400).json({
      error: `Module already exists: ${moduleName}`,
      timestamp: new Date().toISOString()
    });
  }
  
  // Copy template to module
  await copyTemplate(templatePath, modulePath, variables);
  
  // Initialize module
  const moduleInfo = await getModuleInfo(modulePath, moduleName);
  
  res.json({
    status: 'created_from_template',
    template: templateName,
    module: moduleInfo,
    timestamp: new Date().toISOString()
  });
} catch (error) {
  res.status(500).json({
    error: error.message,
    timestamp: new Date().toISOString()
  });
}
});

async function getModuleInfo(modulePath, moduleId) {
const info = {
id: moduleId,
path: modulePath,
exists: true,
status: 'unknown'
};

text
try {
  // Check for package.json
  const packagePath = path.join(modulePath, 'package.json');
  if (await fileExists(packagePath)) {
    const packageContent = await fs.readFile(packagePath, 'utf8');
    const packageJson = JSON.parse(packageContent);
    info.package = packageJson;
  }
  
  // Check for module metadata
  const moduleFile = path.join(modulePath, 'index.js');
  if (await fileExists(moduleFile)) {
    try {
      const module = require(moduleFile);
      info.name = module.name || moduleId;
      info.version = module.version || '1.0.0';
      info.description = module.description;
    } catch (error) {
      info.loadError = error.message;
    }
  }
  
  // Check for commands
  const commandsFile = path.join(modulePath, 'commands.json');
  if (await fileExists(commandsFile)) {
    const commandsContent = await fs.readFile(commandsFile, 'utf8');
    const commands = JSON.parse(commandsContent);
    info.commands = commands.commands || {};
    info.commandCount = Object.keys(info.commands).length;
  }
  
  // Check status file
  const statusFile = path.join(modulePath, 'status.json');
  if (await fileExists(statusFile)) {
    const statusContent = await fs.readFile(statusFile, 'utf8');
    const status = JSON.parse(statusContent);
    info.status = status.status || 'active';
    info.lastActive = status.lastActive;
  } else {
    info.status = 'inactive';
  }
  
  // Get file stats
  const stats = await fs.stat(modulePath);
  info.created = stats.birthtime;
  info.modified = stats.mtime;
  info.size = await getDirectorySize(modulePath);
  
} catch (error) {
  info.error = error.message;
}

return info;
}

async function getTemplateInfo(templatePath, templateName) {
const info = {
name: templateName,
path: templatePath
};

text
try {
  // Check for template manifest
  const manifestPath = path.join(templatePath, 'template.json');
  if (await fileExists(manifestPath)) {
    const manifestContent = await fs.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestContent);
    Object.assign(info, manifest);
  }
  
  // Count files
  const fileCount = await countFiles(templatePath);
  info.fileCount = fileCount;
  
  // Get template description from README if exists
  const readmePath = path.join(templatePath, 'README.md');
  if (await fileExists(readmePath)) {
    const readmeContent = await fs.readFile(readmePath, 'utf8');
    info.readme = readmeContent.substring(0, 200) + '...';
  }
  
} catch (error) {
  info.error = error.message;
}

return info;
}

async function updateModuleStatus(modulePath, status) {
const statusFile = path.join(modulePath, 'status.json');
const statusData = {
status,
lastActive: new Date().toISOString(),
updated: new Date().toISOString()
};

text
await fs.writeFile(statusFile, JSON.stringify(statusData, null, 2));
}

async function copyTemplate(source, destination, variables) {
await fs.mkdir(destination, { recursive: true });

text
const entries = await fs.readdir(source, { withFileTypes: true });

for (const entry of entries) {
  const sourcePath = path.join(source, entry.name);
  const destPath = path.join(destination, entry.name);
  
  if (entry.isDirectory()) {
    await copyTemplate(sourcePath, destPath, variables);
  } else if (entry.isFile()) {
    let content = await fs.readFile(sourcePath, 'utf8');
    
    // Replace variables in template files
    if (sourcePath.endsWith('.js') || sourcePath.endsWith('.json')) {
      Object.entries(variables).forEach(([key, value]) => {
        const placeholder = `{{${key}}}`;
        content = content.replace(new RegExp(placeholder, 'g'), value);
      });
    }
    
    await fs.writeFile(destPath, content);
  }
}
}

async function getDirectorySize(dir) {
let size = 0;
const entries = await fs.readdir(dir, { withFileTypes: true });

text
for (const entry of entries) {
  const fullPath = path.join(dir, entry.name);
  
  if (entry.isDirectory()) {
    size += await getDirectorySize(fullPath);
  } else if (entry.isFile()) {
    const stats = await fs.stat(fullPath);
    size += stats.size;
  }
}

return {
  bytes: size,
  human: size < 1024 ? `${size} B` :
         size < 1024 * 1024 ? `${(size / 1024).toFixed(2)} KB` :
         `${(size / 1024 / 1024).toFixed(2)} MB`
};
}

async function countFiles(dir) {
let count = 0;
const entries = await fs.readdir(dir, { withFileTypes: true });

text
for (const entry of entries) {
  const fullPath = path.join(dir, entry.name);
  
  if (entry.isDirectory()) {
    count += await countFiles(fullPath);
  } else if (entry.isFile()) {
    count++;
  }
}

return count;
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
