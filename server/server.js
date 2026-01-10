(function() {
const http = require('http');
const httpProxy = require('http-proxy');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { spawn } = require('child_process');

// Linkitylink configuration
const LINKITYLINK_PORT = process.env.LINKITYLINK_PORT || 3010;
const LINKITYLINK_PATH = process.env.LINKITYLINK_PATH || path.join(__dirname, '../../linkitylink');

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

// Function to check if linkitylink is running
async function checkLinkitylinkRunning() {
  try {
    const response = await fetch(`http://localhost:${LINKITYLINK_PORT}/config`, {
      method: 'GET',
      timeout: 2000
    });
    return response.ok;
  } catch (err) {
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
      ENABLE_APP_PURCHASE: process.env.ENABLE_APP_PURCHASE || 'false'
    };

    // Spawn linkitylink process
    linkitylinkProcess = spawn('node', ['linkitylink.js'], {
      cwd: LINKITYLINK_PATH,
      env: env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

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
      console.log(`[wiki-plugin-linkitylink] Linkitylink process exited (code: ${code}, signal: ${signal})`);
      linkitylinkProcess = null;
    });

    linkitylinkProcess.on('error', (err) => {
      console.error('[wiki-plugin-linkitylink] ❌ Failed to start linkitylink:', err);
      reject(err);
    });

    // Wait a bit for the service to start
    setTimeout(async () => {
      const isRunning = await checkLinkitylinkRunning();
      if (isRunning) {
        console.log('[wiki-plugin-linkitylink] ✅ Linkitylink service started successfully');
        resolve();
      } else {
        console.error('[wiki-plugin-linkitylink] ⚠️  Linkitylink may not have started correctly');
        resolve(); // Don't reject, let it try to work anyway
      }
    }, 3000);
  });
}

// Function to configure linkitylink with base URLs
async function configureLinkitylink(config) {
  try {
    const response = await fetch(`http://localhost:${LINKITYLINK_PORT}/config`, {
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

  // Proxy all linkitylink routes
  // Maps /plugin/linkitylink/* -> http://localhost:3010/*
  app.all('/plugin/linkitylink/*', function(req, res) {
    // Remove /plugin/linkitylink prefix
    const targetPath = req.url.replace('/plugin/linkitylink', '');
    req.url = targetPath;

    proxy.web(req, res, {
      target: `http://localhost:${LINKITYLINK_PORT}`,
      changeOrigin: true
    });
  });

  // Also handle root plugin path -> linkitylink root
  app.all('/plugin/linkitylink', function(req, res) {
    req.url = '/';
    proxy.web(req, res, {
      target: `http://localhost:${LINKITYLINK_PORT}`,
      changeOrigin: true
    });
  });

  console.log('✅ wiki-plugin-linkitylink ready!');
  console.log('📍 Routes:');
  console.log('   /plugin/linkitylink/* -> http://localhost:' + LINKITYLINK_PORT + '/*');
}

module.exports = { startServer };
}).call(this);
