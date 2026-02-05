(function() {
const http = require('http');
const httpProxy = require('http-proxy');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { spawn } = require('child_process');

// Linkitylink configuration
const LINKITYLINK_PORT = process.env.LINKITYLINK_PORT || 6010;
const LINKITYLINK_PATH = process.env.LINKITYLINK_PATH || path.join(__dirname, '../../linkitylink');
const LINKITYLINK_PID_FILE = path.join(__dirname, `linkitylink-${LINKITYLINK_PORT}.pid`);

let linkitylinkProcess = null;

// Function to load wiki's owner.json for base configuration
function loadWikiConfig() {
  try {
    const ownerPath = path.join(process.env.HOME || '/root', '.wiki/status/owner.json');
    if (fs.existsSync(ownerPath)) {
      const ownerData = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));

      // Extract base URLs from owner.json
      // Default to dev allyabase if not specified
      return {
        fountURL: ownerData.fountURL || 'https://dev.fount.allyabase.com',
        bdoURL: ownerData.bdoURL || 'https://dev.bdo.allyabase.com',
        addieURL: ownerData.addieURL || 'https://dev.addie.allyabase.com'
      };
    }
    console.warn('[wiki-plugin-linkitylink] No owner.json found, using dev allyabase defaults');
    return {
      fountURL: 'https://dev.fount.allyabase.com',
      bdoURL: 'https://dev.bdo.allyabase.com',
      addieURL: 'https://dev.addie.allyabase.com'
    };
  } catch (err) {
    console.error('[wiki-plugin-linkitylink] Error loading wiki config:', err);
    return {
      fountURL: 'https://dev.fount.allyabase.com',
      bdoURL: 'https://dev.bdo.allyabase.com',
      addieURL: 'https://dev.addie.allyabase.com'
    };
  }
}

// Function to kill process by PID
function killProcessByPid(pid) {
  try {
    console.log(`[wiki-plugin-linkitylink] Attempting to kill process ${pid}...`);
    process.kill(pid, 'SIGTERM');

    // Wait a bit, then force kill if still running
    setTimeout(() => {
      try {
        process.kill(pid, 0); // Check if still alive
        console.log(`[wiki-plugin-linkitylink] Process ${pid} still running, sending SIGKILL...`);
        process.kill(pid, 'SIGKILL');
      } catch (err) {
        // Process is dead, which is what we want
        console.log(`[wiki-plugin-linkitylink] ✅ Process ${pid} terminated successfully`);
      }
    }, 2000);

    return true;
  } catch (err) {
    if (err.code === 'ESRCH') {
      console.log(`[wiki-plugin-linkitylink] Process ${pid} does not exist`);
    } else {
      console.error(`[wiki-plugin-linkitylink] Error killing process ${pid}:`, err.message);
    }
    return false;
  }
}

// Function to find and kill process using a specific port
function killProcessByPort(port) {
  return new Promise((resolve) => {
    const { exec } = require('child_process');

    // Use lsof to find process using the port
    exec(`lsof -ti tcp:${port}`, (err, stdout, stderr) => {
      if (err || !stdout.trim()) {
        console.log(`[wiki-plugin-linkitylink] No process found using port ${port}`);
        resolve(false);
        return;
      }

      const pid = parseInt(stdout.trim(), 10);
      console.log(`[wiki-plugin-linkitylink] Found process ${pid} using port ${port}`);

      const killed = killProcessByPid(pid);
      resolve(killed);
    });
  });
}

// Function to clean up orphaned linkitylink process from previous run
async function cleanupOrphanedProcess() {
  console.log('[wiki-plugin-linkitylink] Checking for orphaned linkitylink process...');

  // Check PID file
  if (fs.existsSync(LINKITYLINK_PID_FILE)) {
    try {
      const pidString = fs.readFileSync(LINKITYLINK_PID_FILE, 'utf8').trim();
      const pid = parseInt(pidString, 10);

      console.log(`[wiki-plugin-linkitylink] Found PID file with PID ${pid}`);

      // Try to kill the process
      killProcessByPid(pid);

      // Wait for process to die
      await new Promise(resolve => setTimeout(resolve, 2500));

      // Clean up PID file
      fs.unlinkSync(LINKITYLINK_PID_FILE);
      console.log(`[wiki-plugin-linkitylink] Cleaned up PID file`);
    } catch (err) {
      console.error(`[wiki-plugin-linkitylink] Error reading PID file:`, err.message);
    }
  }

  // Fallback: check if port is in use
  const portInUse = await killProcessByPort(LINKITYLINK_PORT);
  if (portInUse) {
    console.log(`[wiki-plugin-linkitylink] Cleaned up process using port ${LINKITYLINK_PORT}`);
    await new Promise(resolve => setTimeout(resolve, 2500));
  }
}

// Function to write PID file
function writePidFile(pid) {
  try {
    fs.writeFileSync(LINKITYLINK_PID_FILE, pid.toString(), 'utf8');
    console.log(`[wiki-plugin-linkitylink] Wrote PID ${pid} to ${LINKITYLINK_PID_FILE}`);
  } catch (err) {
    console.error(`[wiki-plugin-linkitylink] Error writing PID file:`, err.message);
  }
}

// Function to clean up PID file
function cleanupPidFile() {
  try {
    if (fs.existsSync(LINKITYLINK_PID_FILE)) {
      fs.unlinkSync(LINKITYLINK_PID_FILE);
      console.log(`[wiki-plugin-linkitylink] Cleaned up PID file`);
    }
  } catch (err) {
    console.error(`[wiki-plugin-linkitylink] Error cleaning up PID file:`, err.message);
  }
}

// Function to gracefully shutdown linkitylink
function shutdownLinkitylink() {
  console.log('[wiki-plugin-linkitylink] Shutting down linkitylink service...');

  if (linkitylinkProcess && !linkitylinkProcess.killed) {
    console.log(`[wiki-plugin-linkitylink] Killing linkitylink process ${linkitylinkProcess.pid}...`);

    try {
      linkitylinkProcess.kill('SIGTERM');

      // Force kill after timeout
      setTimeout(() => {
        if (linkitylinkProcess && !linkitylinkProcess.killed) {
          console.log(`[wiki-plugin-linkitylink] Force killing linkitylink process...`);
          linkitylinkProcess.kill('SIGKILL');
        }
      }, 2000);
    } catch (err) {
      console.error(`[wiki-plugin-linkitylink] Error killing linkitylink:`, err.message);
    }
  }

  cleanupPidFile();
}

// Function to check if linkitylink is running
async function checkLinkitylinkRunning() {
  try {
    console.log(`[wiki-plugin-linkitylink] Health check: GET http://127.0.0.1:${LINKITYLINK_PORT}/config`);
    const response = await fetch(`http://127.0.0.1:${LINKITYLINK_PORT}/config`, {
      method: 'GET',
      timeout: 2000
    });
    console.log(`[wiki-plugin-linkitylink] Health check response: ${response.status} ${response.statusText}`);
    return response.ok;
  } catch (err) {
    console.error(`[wiki-plugin-linkitylink] Health check failed: ${err.message}`);
    return false;
  }
}

// Function to launch linkitylink service
async function launchLinkitylink(wikiConfig) {
  return new Promise((resolve, reject) => {
    console.log('[wiki-plugin-linkitylink] 🚀 Launching linkitylink service...');
    console.log(`[wiki-plugin-linkitylink] Path: ${LINKITYLINK_PATH}`);
    console.log(`[wiki-plugin-linkitylink] Port: ${LINKITYLINK_PORT}`);

    // Check if linkitylink directory exists
    if (!fs.existsSync(LINKITYLINK_PATH)) {
      console.error(`[wiki-plugin-linkitylink] ❌ Linkitylink not found at ${LINKITYLINK_PATH}`);
      console.error('[wiki-plugin-linkitylink] Set LINKITYLINK_PATH environment variable to the correct location');
      return reject(new Error('Linkitylink directory not found'));
    }

    // Check for linkitylink.js
    const serverPath = path.join(LINKITYLINK_PATH, 'linkitylink.js');
    if (!fs.existsSync(serverPath)) {
      console.error(`[wiki-plugin-linkitylink] ❌ linkitylink.js not found at ${serverPath}`);
      return reject(new Error('Linkitylink linkitylink.js not found'));
    }

    // Set environment variables for this linkitylink instance
    const env = {
      ...process.env,
      PORT: LINKITYLINK_PORT.toString(),
      FOUNT_BASE_URL: wikiConfig.fountURL,
      BDO_BASE_URL: wikiConfig.bdoURL,
      ADDIE_BASE_URL: wikiConfig.addieURL,
      ENABLE_APP_PURCHASE: process.env.ENABLE_APP_PURCHASE || 'false',
      BASE_PATH: '/plugin/linkitylink'
    };

    console.log('[wiki-plugin-linkitylink] Environment:');
    console.log(`  PORT: ${env.PORT}`);
    console.log(`  BASE_PATH: ${env.BASE_PATH}`);
    console.log(`  FOUNT_BASE_URL: ${env.FOUNT_BASE_URL}`);
    console.log(`  BDO_BASE_URL: ${env.BDO_BASE_URL}`);
    console.log(`  ADDIE_BASE_URL: ${env.ADDIE_BASE_URL}`);
    console.log(`[wiki-plugin-linkitylink] Spawning: node linkitylink.js`);

    // Spawn linkitylink process
    linkitylinkProcess = spawn('node', ['linkitylink.js'], {
      cwd: LINKITYLINK_PATH,
      env: env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    // Write PID file immediately after spawning
    writePidFile(linkitylinkProcess.pid);

    // Log stdout
    linkitylinkProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      lines.forEach(line => {
        console.log(`[linkitylink:${LINKITYLINK_PORT}] ${line}`);
      });
    });

    // Log stderr
    linkitylinkProcess.stderr.on('data', (data) => {
      console.error(`[linkitylink:${LINKITYLINK_PORT}] ERROR: ${data.toString().trim()}`);
    });

    // Handle process exit
    linkitylinkProcess.on('exit', (code, signal) => {
      if (code === 0) {
        console.log(`[wiki-plugin-linkitylink] ✅ Linkitylink process exited cleanly (code: ${code})`);
      } else if (code) {
        console.error(`[wiki-plugin-linkitylink] ❌ Linkitylink process crashed (exit code: ${code})`);
      } else if (signal) {
        console.error(`[wiki-plugin-linkitylink] ❌ Linkitylink process killed by signal: ${signal}`);
      }

      // Clean up PID file when process exits
      cleanupPidFile();
      linkitylinkProcess = null;
    });

    linkitylinkProcess.on('error', (err) => {
      console.error('[wiki-plugin-linkitylink] ❌ Failed to start linkitylink:', err);
      reject(err);
    });

    // Wait a bit for the service to start
    console.log('[wiki-plugin-linkitylink] Waiting 3 seconds for service to start...');
    setTimeout(async () => {
      const isRunning = await checkLinkitylinkRunning();
      if (isRunning) {
        console.log('[wiki-plugin-linkitylink] ✅ Linkitylink service started successfully');
        console.log(`[wiki-plugin-linkitylink] Service available at http://127.0.0.1:${LINKITYLINK_PORT}`);
        resolve();
      } else {
        console.error('[wiki-plugin-linkitylink] ⚠️  Linkitylink did not respond to health check');
        console.error(`[wiki-plugin-linkitylink] Attempted to connect to: http://127.0.0.1:${LINKITYLINK_PORT}/config`);
        if (linkitylinkProcess && linkitylinkProcess.killed) {
          console.error('[wiki-plugin-linkitylink] Process was killed or crashed');
        } else if (!linkitylinkProcess) {
          console.error('[wiki-plugin-linkitylink] Process is not running');
        } else {
          console.error('[wiki-plugin-linkitylink] Process appears to be running but not responding');
        }
        resolve(); // Don't reject, let it try to work anyway
      }
    }, 3000);
  });
}

// Function to configure linkitylink with base URLs
async function configureLinkitylink(config) {
  try {
    const response = await fetch(`http://127.0.0.1:${LINKITYLINK_PORT}/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(config)
    });

    const result = await response.json();
    if (result.success) {
      console.log('[wiki-plugin-linkitylink] ✅ Linkitylink configured with base URLs:');
      console.log(`  Fount: ${result.config.fountURL}`);
      console.log(`  BDO: ${result.config.bdoURL}`);
      console.log(`  Addie: ${result.config.addieURL}`);
    } else {
      console.error('[wiki-plugin-linkitylink] ❌ Failed to configure linkitylink:', result.error);
    }
  } catch (err) {
    console.error('[wiki-plugin-linkitylink] ❌ Error configuring linkitylink:', err.message);
  }
}

async function startServer(params) {
  const app = params.app;

  console.log('🔗 wiki-plugin-linkitylink starting...');
  console.log(`📍 Linkitylink service on port ${LINKITYLINK_PORT}`);

  // Clean up any orphaned linkitylink process from previous run
  await cleanupOrphanedProcess();

  // Load wiki configuration
  const wikiConfig = loadWikiConfig();

  // Check if linkitylink is already running
  const isRunning = await checkLinkitylinkRunning();

  if (!isRunning) {
    console.log('[wiki-plugin-linkitylink] Linkitylink not detected, attempting to launch...');
    try {
      await launchLinkitylink(wikiConfig);
    } catch (err) {
      console.error('[wiki-plugin-linkitylink] ❌ Failed to launch linkitylink:', err.message);
      console.error('[wiki-plugin-linkitylink] You may need to start linkitylink manually');
    }
  } else {
    console.log('[wiki-plugin-linkitylink] ✅ Linkitylink already running, configuring...');
    await configureLinkitylink(wikiConfig);
  }

  // Create proxy server
  const proxy = httpProxy.createProxyServer({});

  // Handle proxy errors
  proxy.on('error', function(err, req, res) {
    console.error('[LINKITYLINK PROXY ERROR]', err.message);

    // Return JSON error response
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Linkitylink service not available',
      message: err.message,
      hint: 'Is linkitylink running on port ' + LINKITYLINK_PORT + '?'
    }));
  });

  // Log proxy requests
  proxy.on('proxyReq', function(proxyReq, req, res, options) {
    console.log(`[LINKITYLINK PROXY] ${req.method} ${req.url} -> http://localhost:${LINKITYLINK_PORT}${req.url}`);

    // If body was parsed by Express, restream it
    if (req.body && Object.keys(req.body).length > 0) {
      let bodyData = JSON.stringify(req.body);
      proxyReq.setHeader('Content-Type', 'application/json');
      proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
      proxyReq.write(bodyData);
      proxyReq.end();
    }
  });

  // Version status endpoint
  app.get('/plugin/linkitylink/version-status', async function(req, res) {
    try {
      const linkitylinkPackagePath = path.join(LINKITYLINK_PATH, 'package.json');
      let installed = null;

      if (fs.existsSync(linkitylinkPackagePath)) {
        const packageData = JSON.parse(fs.readFileSync(linkitylinkPackagePath, 'utf8'));
        installed = packageData.version;
      }

      // Fetch latest version from npm
      const npmResponse = await fetch('https://registry.npmjs.org/linkitylink/latest');
      const npmData = await npmResponse.json();
      const published = npmData.version;

      const updateAvailable = installed && published && installed !== published;

      res.json({
        installed,
        published,
        updateAvailable
      });
    } catch (err) {
      console.error('[wiki-plugin-linkitylink] Error checking version:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Update endpoint
  app.post('/plugin/linkitylink/update', function(req, res) {
    const { exec } = require('child_process');

    console.log('[wiki-plugin-linkitylink] Updating linkitylink to latest version...');

    // Determine the correct directory to run npm install
    // LINKITYLINK_PATH points to node_modules/linkitylink
    // We need to run npm install in its grandparent directory (where package.json is)
    const installDir = path.join(LINKITYLINK_PATH, '../..');
    console.log(`[wiki-plugin-linkitylink] Running npm install in: ${installDir}`);

    // Run npm install linkitylink@latest in the correct directory
    exec('npm install linkitylink@latest', { cwd: installDir }, (err, stdout, stderr) => {
      if (err) {
        console.error('[wiki-plugin-linkitylink] Update failed:', stderr);
        return res.json({ success: false, error: stderr || err.message });
      }

      console.log('[wiki-plugin-linkitylink] Update output:', stdout);

      // Try to get the new version
      try {
        const linkitylinkPackagePath = path.join(LINKITYLINK_PATH, 'package.json');
        const packageData = JSON.parse(fs.readFileSync(linkitylinkPackagePath, 'utf8'));
        const newVersion = packageData.version;

        console.log(`[wiki-plugin-linkitylink] ✅ Updated to version ${newVersion}`);
        res.json({ success: true, version: newVersion });
      } catch (readErr) {
        console.log('[wiki-plugin-linkitylink] ✅ Update completed');
        res.json({ success: true, version: 'unknown' });
      }
    });
  });

  // Proxy all OTHER linkitylink routes
  // Maps /plugin/linkitylink/* -> http://localhost:6010/*
  app.all('/plugin/linkitylink/*', function(req, res) {
    // Remove /plugin/linkitylink prefix
    const targetPath = req.url.replace('/plugin/linkitylink', '');
    req.url = targetPath;

    proxy.web(req, res, {
      target: `http://127.0.0.1:${LINKITYLINK_PORT}`,
      changeOrigin: true
    });
  });

  // Also handle root plugin path -> linkitylink root
  app.all('/plugin/linkitylink', function(req, res) {
    req.url = '/';
    proxy.web(req, res, {
      target: `http://127.0.0.1:${LINKITYLINK_PORT}`,
      changeOrigin: true
    });
  });

  console.log('✅ wiki-plugin-linkitylink ready!');
  console.log('📍 Routes:');
  console.log('   /plugin/linkitylink/* -> http://127.0.0.1:' + LINKITYLINK_PORT + '/*');

  // Set up shutdown hooks to clean up linkitylink process
  let isShuttingDown = false;

  const handleShutdown = (signal) => {
    if (isShuttingDown) {
      return; // Already shutting down
    }
    isShuttingDown = true;

    console.log(`[wiki-plugin-linkitylink] Received ${signal}, shutting down...`);
    shutdownLinkitylink();

    // Give it a moment to clean up, then exit
    setTimeout(() => {
      console.log('[wiki-plugin-linkitylink] Shutdown complete');
      // Don't call process.exit() here - let the parent process handle that
    }, 3000);
  };

  // Register shutdown handlers (only once per process)
  if (!process.linkitylinkShutdownRegistered) {
    process.linkitylinkShutdownRegistered = true;

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('exit', () => {
      if (!isShuttingDown) {
        shutdownLinkitylink();
      }
    });

    console.log('[wiki-plugin-linkitylink] Shutdown handlers registered');
  }
}

module.exports = { startServer };
}).call(this);
