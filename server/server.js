(function() {
const http = require('http');
const httpProxy = require('http-proxy');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { spawn } = require('child_process');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const multer = require('multer');
const sessionless = require('sessionless-node');

// ── Multi-tenant storage ──────────────────────────────────────────────────────

const LINKITYLINK_DIR = path.join(process.env.HOME || '/root', '.linkitylink');
const TENANTS_PATH    = path.join(LINKITYLINK_DIR, 'tenants.json');
const TAPESTRIES_PATH = path.join(LINKITYLINK_DIR, 'tapestries.json');
const CONFIG_PATH     = path.join(LINKITYLINK_DIR, 'config.json');
const BLANK_TEMPLATE_PATH = path.join(__dirname, '../client/blank-template.svg');

function ensureDir() {
  if (!fs.existsSync(LINKITYLINK_DIR)) fs.mkdirSync(LINKITYLINK_DIR, { recursive: true });
}

function loadTenants() {
  ensureDir();
  try {
    return fs.existsSync(TENANTS_PATH) ? JSON.parse(fs.readFileSync(TENANTS_PATH, 'utf8')) : {};
  } catch (e) { return {}; }
}

function saveTenants(t) {
  ensureDir();
  fs.writeFileSync(TENANTS_PATH, JSON.stringify(t, null, 2), 'utf8');
}

function loadTapestries() {
  ensureDir();
  try {
    return fs.existsSync(TAPESTRIES_PATH) ? JSON.parse(fs.readFileSync(TAPESTRIES_PATH, 'utf8')) : {};
  } catch (e) { return {}; }
}

function saveTapestries(t) {
  ensureDir();
  fs.writeFileSync(TAPESTRIES_PATH, JSON.stringify(t, null, 2), 'utf8');
}

function loadConfig() {
  ensureDir();
  try {
    return fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {};
  } catch (e) { return {}; }
}

function saveConfig(c) {
  ensureDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2), 'utf8');
}

function isOwner(req) {
  return !!(req.session && req.session.user);
}

function getAddieUrl(wikiConfig) {
  try {
    return new URL(wikiConfig.sanoraUrl).origin + '/plugin/allyabase/addie';
  } catch (e) {
    return 'https://dev.allyabase.com/plugin/allyabase/addie';
  }
}

async function generateAddieKeys() {
  return new Promise((resolve, reject) => {
    sessionless.generateKeys(
      (k) => { resolve(k); return k; },
      () => null
    );
    // Timeout fallback in case callback never fires
    setTimeout(() => reject(new Error('generateKeys timed out')), 5000);
  });
}

async function addieCreateUser(addieUrl, addieKeys) {
  sessionless.getKeys = () => addieKeys;
  const timestamp = Date.now().toString();
  const message = timestamp + addieKeys.pubKey;
  const signature = await sessionless.sign(message);
  const resp = await fetch(`${addieUrl}/user/create`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timestamp, pubKey: addieKeys.pubKey, signature })
  });
  if (!resp.ok) throw new Error(`Addie create failed: ${resp.status}`);
  return resp.json();
}

async function addieGetStripeConnectUrl(addieUrl, addieKeys, addieUuid, returnUrl) {
  sessionless.getKeys = () => addieKeys;
  const timestamp = Date.now().toString();
  const message = timestamp + addieUuid;
  const signature = await sessionless.sign(message);
  const resp = await fetch(
    `${addieUrl}/user/${addieUuid}/processor/stripe/connect?timestamp=${timestamp}&signature=${signature}&returnUrl=${encodeURIComponent(returnUrl)}`,
    { headers: { 'Content-Type': 'application/json' } }
  );
  if (!resp.ok) throw new Error(`Addie Stripe connect failed: ${resp.status}`);
  const data = await resp.json();
  return data.url || data.connectUrl || data.onboardingUrl;
}

async function addieCreatePaymentIntent(addieUrl, buyerKeys, buyerUuid, amount, payees) {
  sessionless.getKeys = () => buyerKeys;
  const timestamp = Date.now().toString();
  const message = timestamp + buyerUuid + amount + 'USD';
  const signature = await sessionless.sign(message);
  const resp = await fetch(`${addieUrl}/user/${buyerUuid}/processor/stripe/intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timestamp, amount, currency: 'USD', payees, signature })
  });
  if (!resp.ok) throw new Error(`Addie intent failed: ${resp.status}`);
  return resp.json();
}

function generateTenantKeys() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  return {
    privKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    pubKey:  publicKey.export({ type: 'spki',  format: 'pem' })
  };
}

function verifySignature(pubKeyPem, message, signatureHex) {
  try {
    const verify = crypto.createVerify('SHA256');
    verify.update(message);
    verify.end();
    return verify.verify({ key: pubKeyPem, dsaEncoding: 'ieee-p1363' }, Buffer.from(signatureHex, 'hex'));
  } catch (e) {
    return false;
  }
}

// ── SVG template helpers ───────────────────────────────────────────────────────

function countLinkSlots(svg) {
  const matches = svg.match(/\{\{link_(\d+)_title\}\}/g) || [];
  const nums = matches.map(m => parseInt(m.match(/\d+/)[0]));
  return nums.length ? Math.max(...nums) : 0;
}

function renderTemplate(svg, tapestryTitle, links) {
  let result = svg.replace(/\{\{tapestry_title\}\}/g, escapeXml(tapestryTitle || ''));
  for (let i = 1; i <= 20; i++) {
    const link = links[i - 1];
    result = result
      .replace(new RegExp(`\\{\\{link_${i}_title\\}\\}`, 'g'), link ? escapeXml(link.title) : '')
      .replace(new RegExp(`\\{\\{link_${i}_url\\}\\}`, 'g'), link ? escapeXml(link.url) : '#');
  }
  return result;
}

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ── HTML page generators ───────────────────────────────────────────────────────

// Wrap a rendered SVG in a full HTML page for viewing
function tapestryPageHTML(renderedSvg, title) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title || 'Tapestry')}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      background: #0a001a;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      padding: 2rem 1rem;
    }
    .tapestry { width: 100%; max-width: 420px; }
    .tapestry svg { width: 100%; height: auto; display: block; }
    svg a { cursor: pointer; }
    svg a text { transition: opacity 0.15s; }
    svg a:hover text { opacity: 0.75; }
    .powered { margin-top: 1.5rem; font-size: 0.75rem; color: #5a4070; font-family: sans-serif; }
    .powered a { color: #7060a0; text-decoration: none; }
  </style>
</head>
<body>
  <div class="tapestry">${renderedSvg}</div>
  <div class="powered">Made with <a href="/plugin/linkitylink/federation">Linkitylink</a></div>
</body>
</html>`;
}

// Customer-facing create page for a given tenant
function customerCreatePageHTML(tenant, slots) {
  const previewSvg = tenant.template
    .replace(/\{\{tapestry_title\}\}/g, 'Your Title Here')
    .replace(/\{\{link_(\d+)_title\}\}/g, (_, n) => `Link ${n}`)
    .replace(/\{\{link_(\d+)_url\}\}/g, '#');

  const linkFields = Array.from({ length: slots }, (_, i) => `
      <div class="link-row">
        <span class="link-num">${i + 1}</span>
        <input name="title_${i+1}" placeholder="Link title" class="inp inp-title">
        <input name="url_${i+1}" placeholder="https://…" class="inp inp-url" type="url">
      </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Create your tapestry — ${escapeHtml(tenant.name)}</title>
  <script src="https://js.stripe.com/v3/"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      background: linear-gradient(135deg, #1a0033 0%, #0a001a 100%);
      color: #e0d0ff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      display: flex; gap: 2rem; padding: 2rem;
      align-items: flex-start; justify-content: center;
    }
    @media (max-width: 700px) { body { flex-direction: column; padding: 1rem; } }
    .preview { flex: 0 0 300px; }
    .preview svg { width: 100%; height: auto; display: block; border-radius: 12px; }
    .panel {
      flex: 1; max-width: 420px;
      background: rgba(30, 0, 50, 0.6);
      border: 1px solid rgba(180, 100, 255, 0.2);
      border-radius: 12px; padding: 1.5rem;
    }
    h1 { font-size: 1.25rem; color: #c89aff; margin-bottom: 0.5rem; }
    .sub { font-size: 0.8rem; color: #7060a0; margin-bottom: 1.5rem; }
    .field { margin-bottom: 1rem; }
    .field label { display: block; font-size: 0.8rem; color: #a080d0; margin-bottom: 4px; }
    .inp {
      width: 100%; padding: 8px 10px;
      background: #2a0044; border: 1px solid #5a3080; border-radius: 6px;
      color: #e0d0ff; font-size: 0.875rem;
    }
    .inp:focus { outline: none; border-color: #9060d0; }
    .link-row { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
    .link-num { flex: 0 0 20px; text-align: right; font-size: 0.75rem; color: #7060a0; }
    .inp-title { flex: 1.2; }
    .inp-url { flex: 2; }
    .links-label { font-size: 0.8rem; color: #a080d0; margin-bottom: 8px; margin-top: 1.25rem; display: block; }
    .btn {
      width: 100%; margin-top: 1.25rem; padding: 12px;
      background: #7c3aed; border: none; border-radius: 8px;
      color: white; font-size: 1rem; cursor: pointer; font-weight: 600;
    }
    .btn:hover { background: #9060f0; }
    .btn:disabled { opacity: .5; cursor: not-allowed; }
    #payment-section { display: none; }
    #payment-element { margin: 1rem 0; }
    .price-badge {
      display: inline-block; background: rgba(124,58,237,.2);
      border: 1px solid rgba(180,100,255,.3); border-radius: 6px;
      padding: 4px 10px; font-size: 0.85rem; color: #c89aff; margin-bottom: 1rem;
    }
    #status { margin-top: 1rem; font-size: 0.875rem; min-height: 1.2em; }
    .err { color: #f55; } .ok { color: #0e0; }
  </style>
</head>
<body>
  <div class="preview">${previewSvg}</div>
  <div class="panel">
    <h1>Create your tapestry</h1>
    <p class="sub">Template by ${escapeHtml(tenant.name)}</p>
    <div class="price-badge">$20.00</div>

    <div id="form-section">
      <div class="field">
        <label>Your name or title</label>
        <input id="tapestry-title" class="inp" placeholder="e.g. Alice's Links">
      </div>
      <span class="links-label">Your links (${slots} slots)</span>
      <div id="link-fields">${linkFields}</div>
      <button class="btn" id="continue-btn">Continue to payment →</button>
    </div>

    <div id="payment-section">
      <div style="font-size:.85rem;color:#a080d0;margin-bottom:.75rem;">Complete payment to create your tapestry</div>
      <div id="payment-element"></div>
      <button class="btn" id="pay-btn">Pay $20.00</button>
    </div>

    <div id="status"></div>
  </div>

  <script>
  (function() {
    var slug = ${JSON.stringify(tenant.slug)};
    var slots = ${slots};
    var stripe, elements, pendingTitle, pendingLinks;

    // Read window.params payees from URL query string
    var searchParams = new URLSearchParams(window.location.search);
    var clientPayees = [];
    var payeeKey = searchParams.get('payee');
    var payeeAmt = parseInt(searchParams.get('payeeAmount') || '0');
    if (payeeKey && payeeAmt > 0) clientPayees.push({ pubKey: payeeKey, amount: payeeAmt });

    function setStatus(html, cls) {
      var el = document.getElementById('status');
      el.innerHTML = '<span class="' + (cls||'') + '">' + html + '</span>';
    }

    document.getElementById('continue-btn').addEventListener('click', function() {
      var title = document.getElementById('tapestry-title').value.trim();
      var links = [];
      for (var i = 1; i <= slots; i++) {
        var t = document.querySelector('[name="title_' + i + '"]').value.trim();
        var u = document.querySelector('[name="url_' + i + '"]').value.trim();
        if (t && u) links.push({ title: t, url: u });
      }
      if (!links.length) { setStatus('Add at least one link.', 'err'); return; }
      pendingTitle = title;
      pendingLinks = links;

      var btn = document.getElementById('continue-btn');
      btn.disabled = true; btn.textContent = 'Setting up payment…';

      fetch('/plugin/linkitylink/' + slug + '/purchase/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientPayees: clientPayees })
      })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.error) { setStatus(d.error, 'err'); btn.disabled = false; btn.textContent = 'Continue to payment →'; return; }
        stripe = Stripe(d.publishableKey);
        elements = stripe.elements({ clientSecret: d.clientSecret });
        var paymentEl = elements.create('payment');
        paymentEl.mount('#payment-element');
        document.getElementById('form-section').style.display = 'none';
        document.getElementById('payment-section').style.display = 'block';
      })
      .catch(function(e) { setStatus(e.message, 'err'); btn.disabled = false; btn.textContent = 'Continue to payment →'; });
    });

    document.getElementById('pay-btn').addEventListener('click', async function() {
      var payBtn = document.getElementById('pay-btn');
      payBtn.disabled = true; payBtn.textContent = 'Processing…';
      var result = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required'
      });
      if (result.error) {
        setStatus(result.error.message, 'err');
        payBtn.disabled = false; payBtn.textContent = 'Pay $20.00';
        return;
      }
      var piId = result.paymentIntent && result.paymentIntent.id;
      fetch('/plugin/linkitylink/' + slug + '/purchase/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentIntentId: piId, title: pendingTitle, links: pendingLinks })
      })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.error) { setStatus(d.error, 'err'); payBtn.disabled = false; payBtn.textContent = 'Pay $20.00'; return; }
        var url = window.location.origin + d.url;
        document.getElementById('payment-section').style.display = 'none';
        setStatus('✅ Tapestry created! Your link: <a href="' + url + '" target="_blank" style="color:#c89aff;">' + url + '</a>', 'ok');
      })
      .catch(function(e) { setStatus(e.message, 'err'); payBtn.disabled = false; payBtn.textContent = 'Pay $20.00'; });
    });
  })();
  </script>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Linkitylink configuration
const LINKITYLINK_PORT = process.env.LINKITYLINK_PORT || 6010;
const LINKITYLINK_PATH = process.env.LINKITYLINK_PATH || path.dirname(require.resolve('linkitylink/package.json'));
const LINKITYLINK_PID_FILE = path.join(__dirname, `linkitylink-${LINKITYLINK_PORT}.pid`);

let linkitylinkProcess = null;

// Function to load wiki's owner.json for base configuration
function loadWikiConfig() {
  try {
    const ownerPath = path.join(process.env.HOME || '/root', '.wiki/status/owner.json');
    if (fs.existsSync(ownerPath)) {
      const ownerData = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
      return {
        sanoraUrl: ownerData.sanoraUrl || 'https://dev.allyabase.com/plugin/allyabase/sanora'
      };
    }
    console.warn('[wiki-plugin-linkitylink] No owner.json found, using dev allyabase defaults');
    return { sanoraUrl: 'https://dev.allyabase.com/plugin/allyabase/sanora' };
  } catch (err) {
    console.error('[wiki-plugin-linkitylink] Error loading wiki config:', err);
    return { sanoraUrl: 'https://dev.allyabase.com/plugin/allyabase/sanora' };
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
      SANORA_URL: wikiConfig.sanoraUrl,
      BASE_PATH: '/plugin/linkitylink'
    };

    console.log('[wiki-plugin-linkitylink] Environment:');
    console.log(`  PORT: ${env.PORT}`);
    console.log(`  BASE_PATH: ${env.BASE_PATH}`);
    console.log(`  SANORA_URL: ${env.SANORA_URL}`);
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

// Function to configure linkitylink with Sanora URL
async function configureLinkitylink(config) {
  try {
    const response = await fetch(`http://127.0.0.1:${LINKITYLINK_PORT}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sanoraUrl: config.sanoraUrl })
    });

    const result = await response.json();
    if (result.success) {
      console.log('[wiki-plugin-linkitylink] ✅ Linkitylink configured');
      console.log(`  Sanora: ${result.sanoraUrl}`);
      console.log(`  Addie:  ${result.addieUrl}`);
    } else {
      console.error('[wiki-plugin-linkitylink] ❌ Failed to configure linkitylink:', result.error);
    }
  } catch (err) {
    console.error('[wiki-plugin-linkitylink] ❌ Error configuring linkitylink:', err.message);
  }
}

// ── Freyja federation page ────────────────────────────────────────────────────

function generateFederationPage(currentId) {
  const PLUGINS = {
    agora:       { id: 'agora',       color: '#00cc00', icon: '🛍️', name: 'Agora',       tagline: 'Digital marketplace',      desc: 'A federated marketplace for independent creators. Buy and sell books, music, posts, and more — commerce the way it was supposed to work.', path: '/plugin/agora/directory',  ping: '/plugin/agora/directory',       fed: '/plugin/agora/federation' },
    lucille:     { id: 'lucille',     color: '#ee22ee', icon: '🎬', name: 'Lucille',     tagline: 'P2P video hosting',         desc: 'Upload and stream video peer-to-peer. No corporate infrastructure, no surveillance — your wiki hosts your content directly.',               path: '/plugin/lucille/setup',     ping: '/plugin/lucille/setup/status',  fed: '/plugin/lucille/federation' },
    linkitylink: { id: 'linkitylink', color: '#9922cc', icon: '🔗', name: 'Linkitylink', tagline: 'Privacy-first link pages',  desc: 'Create beautiful tapestries of links. No tracking, no algorithms — just your links, shared your way, on your terms.',                        path: '/plugin/linkitylink',       ping: '/plugin/linkitylink/config',    fed: '/plugin/linkitylink/federation' },
    salon:       { id: 'salon',       color: '#ffdd00', icon: '🏛️', name: 'Salon',       tagline: 'Community gathering space', desc: 'A gathering place for your wiki community. Members register, connect, and receive updates from the wider Freyja ecosystem.',                 path: '/plugin/salon',             ping: '/plugin/salon/config',          fed: '/plugin/salon/federation' },
  };

  const current = PLUGINS[currentId];
  const others  = Object.values(PLUGINS).filter(p => p.id !== currentId);

  const navDotsHtml = Object.values(PLUGINS).map(p => `
      <a href="${p.fed}" class="fnav-dot" style="--dot-color:${p.color};" title="${p.name}">
        <span class="fnav-dot-inner"></span>
      </a>`).join('');

  const cardsHtml = others.map(p => `
      <a href="${p.fed}" class="fed-card" style="--card-color:${p.color};">
        <div class="fed-card-top">
          <span class="fed-card-icon">${p.icon}</span>
          <div class="fed-card-meta">
            <div class="fed-card-name">
              <span class="fed-status-dot" id="dot-${p.id}"></span>
              ${p.name}
            </div>
            <div class="fed-card-tagline">${p.tagline}</div>
          </div>
        </div>
        <div class="fed-card-desc">${p.desc}</div>
        <div class="fed-card-cta">Explore ${p.name} →</div>
      </a>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Freyja — ${current.name}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;600;700;900&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #04040f;
      --surface: rgba(12, 12, 30, 0.75);
      --border: rgba(100, 120, 200, 0.18);
      --text: #ffffff;
      --text-muted: rgba(220, 225, 255, 0.88);
      --text-dim: rgba(200, 210, 255, 0.65);
      --radius-card: 1.25rem;
      --radius-pill: 9999px;
      --ease: cubic-bezier(0.16, 1, 0.3, 1);
      --current-color: ${current.color};
    }

    html, body { height: 100%; }

    body {
      font-family: 'Inter', system-ui, sans-serif;
      font-weight: 300;
      background: var(--bg);
      color: var(--text-muted);
      min-height: 100vh;
      overflow-x: hidden;
    }

    #starfield {
      position: fixed;
      inset: 0;
      z-index: 0;
      pointer-events: none;
    }

    .fnav {
      position: fixed;
      top: 0; left: 0; right: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 2rem;
      height: 56px;
      background: rgba(4, 4, 15, 0.8);
      backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border);
    }
    .fnav-brand {
      font-family: 'Orbitron', sans-serif;
      font-weight: 700;
      font-size: 1rem;
      color: var(--current-color);
      text-decoration: none;
      filter: drop-shadow(0 0 8px var(--current-color));
      letter-spacing: 0.06em;
    }
    .fnav-dots { display: flex; align-items: center; gap: 0.75rem; }
    .fnav-dot {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      text-decoration: none;
      transition: transform 0.2s var(--ease);
    }
    .fnav-dot:hover { transform: scale(1.25); }
    .fnav-dot-inner {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--dot-color);
      filter: drop-shadow(0 0 6px var(--dot-color));
    }

    .page { position: relative; z-index: 1; }

    .hero {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 7rem 2rem 4rem;
      gap: 1.25rem;
      opacity: 0;
      transform: translateY(24px);
      transition: opacity 0.8s var(--ease), transform 0.8s var(--ease);
    }
    .hero.visible { opacity: 1; transform: none; }

    .hero-eyebrow {
      font-family: 'Orbitron', sans-serif;
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: var(--current-color);
    }
    .hero-icon {
      font-size: 5rem;
      line-height: 1;
      filter: drop-shadow(0 0 24px ${current.color});
    }
    .hero-title {
      font-family: 'Orbitron', sans-serif;
      font-size: clamp(3rem, 10vw, 6rem);
      font-weight: 900;
      color: var(--current-color);
      filter: drop-shadow(0 0 30px var(--current-color));
      line-height: 1;
      letter-spacing: -0.02em;
    }
    .hero-tagline {
      font-family: 'Orbitron', sans-serif;
      font-size: 0.75rem;
      font-weight: 400;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--text-dim);
    }
    .hero-desc {
      max-width: 520px;
      font-size: 1rem;
      font-weight: 300;
      color: var(--text-muted);
      line-height: 1.7;
    }
    .hero-btn {
      display: inline-block;
      margin-top: 0.5rem;
      padding: 0.75rem 2rem;
      border-radius: var(--radius-pill);
      background: var(--current-color);
      color: #000;
      font-family: 'Inter', sans-serif;
      font-weight: 600;
      font-size: 0.9rem;
      text-decoration: none;
      transition: transform 0.2s var(--ease), filter 0.2s;
    }
    .hero-btn:hover { transform: scale(1.04); filter: brightness(1.15); }

    .cards-section {
      max-width: 1000px;
      margin: 0 auto;
      padding: 4rem 2rem 6rem;
      opacity: 0;
      transform: translateY(32px);
      transition: opacity 0.8s var(--ease) 0.15s, transform 0.8s var(--ease) 0.15s;
    }
    .cards-section.visible { opacity: 1; transform: none; }

    .section-label {
      font-family: 'Orbitron', sans-serif;
      font-size: 0.65rem;
      font-weight: 600;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: var(--text-dim);
      margin-bottom: 1.5rem;
    }

    .fed-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1.25rem;
    }

    .fed-card {
      --card-color: #ffffff;
      background: var(--surface);
      backdrop-filter: blur(10px);
      border: 1px solid var(--border);
      border-radius: var(--radius-card);
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
      text-decoration: none;
      color: var(--text-muted);
      transition: border-color 0.25s var(--ease), filter 0.25s var(--ease), transform 0.25s var(--ease);
    }
    .fed-card:hover {
      border-color: var(--card-color);
      filter: drop-shadow(0 0 14px var(--card-color));
      transform: translateY(-4px);
    }
    .fed-card-top { display: flex; align-items: flex-start; gap: 1rem; }
    .fed-card-icon { font-size: 2rem; line-height: 1; flex-shrink: 0; }
    .fed-card-meta { flex: 1; }
    .fed-card-name {
      font-family: 'Orbitron', sans-serif;
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.25rem;
    }
    .fed-status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: rgba(200, 210, 255, 0.3);
      flex-shrink: 0;
      transition: background 0.4s, filter 0.4s;
    }
    .fed-card-tagline { font-size: 0.75rem; color: var(--card-color); font-weight: 500; }
    .fed-card-desc { font-size: 0.85rem; line-height: 1.6; color: var(--text-dim); flex: 1; }
    .fed-card-cta { font-size: 0.8rem; font-weight: 600; color: var(--card-color); align-self: flex-start; }

    .fed-footer {
      text-align: center;
      padding: 2rem;
      font-size: 0.78rem;
      color: var(--text-dim);
      border-top: 1px solid var(--border);
      position: relative;
      z-index: 1;
    }
    .fed-footer strong { font-family: 'Orbitron', sans-serif; color: var(--text-muted); }
  </style>
</head>
<body>
  <canvas id="starfield"></canvas>

  <nav class="fnav">
    <a href="${current.fed}" class="fnav-brand">✦ FREYJA</a>
    <div class="fnav-dots">${navDotsHtml}
    </div>
  </nav>

  <div class="page">
    <section class="hero" id="hero">
      <div class="hero-eyebrow">Freyja Ecosystem</div>
      <div class="hero-icon">${current.icon}</div>
      <div class="hero-title">${current.name}</div>
      <div class="hero-tagline">${current.tagline}</div>
      <div class="hero-desc">${current.desc}</div>
      <a href="${current.path}" class="hero-btn">Open ${current.name} →</a>
    </section>

    <section class="cards-section" id="cards">
      <div class="section-label">Also on this wiki</div>
      <div class="fed-grid">${cardsHtml}
      </div>
    </section>

    <footer class="fed-footer">
      <strong>Freyja</strong> — open, federated, and owned by you.
    </footer>
  </div>

  <script>
  (function() {
    var canvas = document.getElementById('starfield');
    var ctx = canvas.getContext('2d');
    var stars = [];
    function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
    resize();
    window.addEventListener('resize', resize);
    for (var i = 0; i < 180; i++) {
      stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.2 + 0.2, a: Math.random(), da: (Math.random() - 0.5) * 0.008 });
    }
    function drawStars() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        s.a += s.da;
        if (s.a <= 0 || s.a >= 1) s.da = -s.da;
        ctx.beginPath();
        ctx.arc(s.x * canvas.width, s.y * canvas.height, s.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(200,210,255,' + s.a.toFixed(2) + ')';
        ctx.fill();
      }
      requestAnimationFrame(drawStars);
    }
    drawStars();

    var obs = new IntersectionObserver(function(entries) {
      entries.forEach(function(e) { if (e.isIntersecting) e.target.classList.add('visible'); });
    }, { threshold: 0.1 });
    obs.observe(document.getElementById('hero'));
    obs.observe(document.getElementById('cards'));

    var pluginColors = { agora: '#00cc00', lucille: '#ee22ee', linkitylink: '#9922cc', salon: '#ffdd00' };
    var pings = [
      { id: 'agora',       url: '/plugin/agora/directory' },
      { id: 'lucille',     url: '/plugin/lucille/setup/status' },
      { id: 'linkitylink', url: '/plugin/linkitylink/config' },
      { id: 'salon',       url: '/plugin/salon/config' }
    ];
    pings.forEach(function(p) {
      fetch(p.url, { signal: AbortSignal.timeout(3000) })
        .then(function(r) {
          var d = document.getElementById('dot-' + p.id);
          if (d) {
            d.style.background = r.ok ? pluginColors[p.id] : 'rgba(200,210,255,0.3)';
            if (r.ok) d.style.filter = 'drop-shadow(0 0 5px ' + pluginColors[p.id] + ')';
          }
        })
        .catch(function() {});
    });
  })();
  </script>
</body>
</html>`;
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

  // Freyja federation page
  app.get('/plugin/linkitylink/federation', function(req, res) {
    res.send(generateFederationPage('linkitylink'));
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

  // ── Multi-tenant routes ────────────────────────────────────────────────────

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

  // Config / owner check
  app.get('/plugin/linkitylink/config', function(req, res) {
    const config  = loadConfig();
    const tenants = loadTenants();
    const list = Object.values(tenants).map(t => ({
      uuid: t.uuid, slug: t.slug, name: t.name,
      hasTemplate: !!t.template,
      bundleTokenUsed: t.bundleTokenUsed,
      stripeOnboarded: !!t.stripeOnboarded
    }));
    const allyabaseUrl = config.allyabaseUrl ||
      (config.addieUrl ? config.addieUrl.replace(/\/plugin\/allyabase\/addie$/, '') : null);
    res.json({
      isOwner: isOwner(req),
      tenants: list,
      allyabaseUrl,
      serverAddieReady: !!(config.serverAddie && config.serverAddie.uuid),
      stripeOnboarded: !!config.stripeOnboarded
    });
  });

  // Save allyabase URL + create server Addie account (owner only)
  app.post('/plugin/linkitylink/config', async function(req, res) {
    if (!isOwner(req)) return res.status(403).json({ error: 'Owner only' });
    const { addieUrl, allyabaseUrl } = req.body || {};
    const resolvedAddieUrl = allyabaseUrl
      ? allyabaseUrl.replace(/\/$/, '') + '/plugin/allyabase/addie'
      : addieUrl;
    if (!resolvedAddieUrl) return res.status(400).json({ error: 'allyabaseUrl required' });

    const config = loadConfig();
    if (allyabaseUrl) config.allyabaseUrl = allyabaseUrl.replace(/\/$/, '');
    config.addieUrl = resolvedAddieUrl;

    // Create server Addie user if not already done
    if (!config.serverAddie || !config.serverAddie.uuid) {
      try {
        const serverAddieKeys = await generateAddieKeys();
        const addieUser = await addieCreateUser(addieUrl, serverAddieKeys);
        config.serverAddie = { uuid: addieUser.uuid, ...serverAddieKeys };
        console.log(`[linkitylink] Created server Addie user ${addieUser.uuid}`);
      } catch (err) {
        console.error('[linkitylink] Server Addie creation failed:', err.message);
        saveConfig(config); // save URL even if Addie failed
        return res.json({ success: true, serverAddieReady: false, stripeOnboarded: false,
          warning: 'Saved URL but could not reach Addie: ' + err.message });
      }
    }

    saveConfig(config);
    res.json({
      success: true,
      serverAddieReady: true,
      stripeOnboarded: !!config.stripeOnboarded
    });
  });

  // Owner Stripe Connect onboarding (session-authenticated — no signed URL needed)
  app.get('/plugin/linkitylink/setup/stripe', async function(req, res) {
    if (!isOwner(req)) return res.status(403).send('Owner only');
    const config = loadConfig();
    if (!config.serverAddie || !config.serverAddie.uuid) {
      return res.status(503).send('Save your allyabase URL first to set up a server Addie account');
    }
    try {
      const addieUrl  = config.addieUrl || getAddieUrl(wikiConfig);
      const returnUrl = `${req.protocol}://${req.get('host')}/plugin/linkitylink/setup/stripe/return`;
      const connectUrl = await addieGetStripeConnectUrl(
        addieUrl, config.serverAddie, config.serverAddie.uuid, returnUrl
      );
      if (!connectUrl) return res.status(502).send('Addie did not return a Stripe Connect URL');
      res.redirect(connectUrl);
    } catch (err) {
      res.status(502).send('Could not start Stripe onboarding: ' + err.message);
    }
  });

  // Return URL after owner Stripe Connect onboarding
  app.get('/plugin/linkitylink/setup/stripe/return', function(req, res) {
    const config = loadConfig();
    config.stripeOnboarded = true;
    saveConfig(config);
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Stripe Connect complete</title>
<style>body{font-family:sans-serif;background:#0a001a;color:#e0d0ff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
.card{background:rgba(30,0,50,.7);border:1px solid rgba(180,100,255,.25);border-radius:12px;padding:2rem;max-width:400px;text-align:center;}
h1{color:#0e0;font-size:1.5rem;margin-bottom:.75rem;}p{color:#a080d0;font-size:.9rem;}</style>
</head><body><div class="card">
<h1>✅ Server payouts enabled</h1>
<p>Your Linkitylink server is connected to Stripe. You'll receive a platform fee from purchases made through tenant tapestry pages.</p>
</div></body></html>`);
  });

  // Register a new tenant (owner only) — bundle is a ZIP with keys.json + blank template.svg
  app.post('/plugin/linkitylink/register', async function(req, res) {
    if (!isOwner(req)) return res.status(403).json({ error: 'Owner only' });
    const { name, slug } = req.body || {};
    if (!name || !slug) return res.status(400).json({ error: 'name and slug required' });
    if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'slug must be lowercase letters, numbers, hyphens' });

    const tenants = loadTenants();
    if (Object.values(tenants).some(t => t.slug === slug)) {
      return res.status(409).json({ error: 'slug already taken' });
    }

    const uuid = crypto.randomUUID();
    const keys = generateTenantKeys();
    const bundleToken = crypto.randomBytes(32).toString('hex');

    // Create Addie user for Stripe payouts
    let addieKeys = null;
    let addieUuid = null;
    try {
      addieKeys = await generateAddieKeys();
      const addieUrl = getAddieUrl(wikiConfig);
      const addieUser = await addieCreateUser(addieUrl, addieKeys);
      addieUuid = addieUser.uuid;
      console.log(`[linkitylink] Created Addie user ${addieUuid} for tenant ${slug}`);
    } catch (err) {
      console.error(`[linkitylink] Warning: Addie user creation failed for ${slug}:`, err.message);
      // Non-fatal — tenant can still upload template; Stripe payouts won't work until resolved
    }

    tenants[uuid] = { uuid, slug, name, keys, bundleToken, bundleTokenUsed: false, template: null, addieKeys, addieUuid, stripeOnboarded: false };
    saveTenants(tenants);

    res.json({ uuid, slug, bundleToken });
  });

  // One-time bundle download — returns a ZIP with keys.json + blank template.svg
  app.get('/plugin/linkitylink/tenant/bundle/:token', function(req, res) {
    const { token } = req.params;
    const tenants = loadTenants();
    const tenant = Object.values(tenants).find(t => t.bundleToken === token);
    if (!tenant) return res.status(404).json({ error: 'Invalid or expired token' });
    if (tenant.bundleTokenUsed) return res.status(410).json({ error: 'Bundle already downloaded' });

    let blankTemplate;
    try {
      blankTemplate = fs.readFileSync(BLANK_TEMPLATE_PATH, 'utf8');
    } catch (e) {
      return res.status(500).json({ error: 'Blank template not found on server' });
    }

    const zip = new AdmZip();
    zip.addFile('keys.json', Buffer.from(JSON.stringify({
      uuid: tenant.uuid, slug: tenant.slug, name: tenant.name, keys: tenant.keys
    }, null, 2)));
    zip.addFile('template.svg', Buffer.from(blankTemplate));

    tenant.bundleTokenUsed = true;
    saveTenants(tenants);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="linkitylink-bundle-${tenant.slug}.zip"`);
    res.send(zip.toBuffer());
  });

  // Upload signed ZIP archive (manifest.json + template.svg)
  app.post('/plugin/linkitylink/upload', upload.single('archive'), function(req, res) {
    if (!req.file) return res.status(400).json({ error: 'No archive file' });

    let manifest, templateSvg;
    try {
      const zip = new AdmZip(req.file.buffer);
      const manifestEntry = zip.getEntry('manifest.json');
      const templateEntry = zip.getEntry('template.svg');
      if (!manifestEntry || !templateEntry) {
        return res.status(400).json({ error: 'ZIP must contain manifest.json and template.svg' });
      }
      manifest = JSON.parse(zip.readAsText(manifestEntry));
      templateSvg = zip.readAsText(templateEntry);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid ZIP: ' + e.message });
    }

    const { uuid, slug, timestamp, pubKey, signature } = manifest;
    if (!uuid || !slug || !timestamp || !pubKey || !signature) {
      return res.status(400).json({ error: 'manifest.json missing required fields' });
    }

    const tenants = loadTenants();
    const tenant = tenants[uuid];
    if (!tenant) return res.status(404).json({ error: 'Unknown UUID' });
    if (tenant.slug !== slug) return res.status(400).json({ error: 'slug mismatch' });

    const message = `${timestamp}${uuid}${slug}`;
    if (!verifySignature(tenant.keys.pubKey, message, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    tenant.template = templateSvg;
    saveTenants(tenants);

    const slots = countLinkSlots(templateSvg);
    res.json({ success: true, slug, slots, url: `/plugin/linkitylink/${slug}` });
  });

  // List tenants (owner only)
  app.get('/plugin/linkitylink/tenants', function(req, res) {
    if (!isOwner(req)) return res.status(403).json({ error: 'Owner only' });
    const tenants = loadTenants();
    res.json(Object.values(tenants).map(t => ({
      uuid: t.uuid, slug: t.slug, name: t.name,
      hasTemplate: !!t.template,
      slots: t.template ? countLinkSlots(t.template) : 0,
      bundleTokenUsed: t.bundleTokenUsed
    })));
  });

  // View a customer tapestry (intercept before proxy — check local storage first)
  app.get('/plugin/linkitylink/view/:tapestryId', function(req, res, next) {
    const tapestries = loadTapestries();
    const tapestry = tapestries[req.params.tapestryId];
    if (!tapestry) return next(); // fall through to proxy (non-tenant tapestry)

    const tenants = loadTenants();
    const tenant = tenants[tapestry.tenantUuid];
    if (!tenant || !tenant.template) return res.status(404).send('Tapestry not found');

    const rendered = renderTemplate(tenant.template, tapestry.title, tapestry.links);
    res.send(tapestryPageHTML(rendered, tapestry.title));
  });

  // Customer create page — shows tenant's SVG template + link entry form
  app.get('/plugin/linkitylink/:slug', function(req, res, next) {
    const { slug } = req.params;
    const reserved = ['create', 'layouts', 'parse-linktree', 'view', 'config', 'federation',
                      'version-status', 'update', 'register', 'tenants', 'upload', 'tenant'];
    if (reserved.includes(slug)) return next();

    const tenants = loadTenants();
    const tenant = Object.values(tenants).find(t => t.slug === slug);
    if (!tenant || !tenant.template) return res.status(404).send('Template not found');

    const slots = countLinkSlots(tenant.template);
    res.send(customerCreatePageHTML(tenant, slots));
  });

  const ll_json = require('express').json({ limit: '64kb' });
  const TAPESTRY_PRICE = 2000; // $20 in cents

  // Step 1: Create Stripe payment intent for tapestry purchase
  app.post('/plugin/linkitylink/:slug/purchase/intent', ll_json, async function(req, res) {
    const { slug } = req.params;
    const tenants = loadTenants();
    const tenant = Object.values(tenants).find(t => t.slug === slug);
    if (!tenant || !tenant.template) return res.status(404).json({ error: 'Template not found' });
    if (!tenant.addieKeys) return res.status(503).json({ error: 'Tenant has not set up payments' });

    const config = loadConfig();
    const addieUrl = config.addieUrl;
    if (!addieUrl) return res.status(503).json({ error: 'Allyabase not configured' });

    const { clientPayees = [] } = req.body || {};

    try {
      // Create a fresh buyer Addie account
      const buyerKeys = await generateAddieKeys();
      const buyerUser = await addieCreateUser(addieUrl, buyerKeys);
      if (buyerUser.error) return res.status(502).json({ error: 'Could not create buyer account' });

      // Build payees — tenant starts with full amount
      let payees = [{ pubKey: tenant.addieKeys.pubKey, amount: TAPESTRY_PRICE }];

      // Carve server 1% from tenant's share
      if (config.serverAddie && config.stripeOnboarded) {
        const serverAmount = Math.floor(TAPESTRY_PRICE * 0.01);
        payees[0].amount -= serverAmount;
        payees.push({ pubKey: config.serverAddie.pubKey, amount: serverAmount });
      }

      // Add URL-param payees (capped at 5% each), carved from tenant's share
      const maxPayeeAmount = Math.floor(TAPESTRY_PRICE * 0.05);
      for (const p of clientPayees) {
        if (!p.pubKey) continue;
        const pAmount = Math.min(parseInt(p.amount) || 0, maxPayeeAmount);
        if (pAmount <= 0) continue;
        const tenantIdx = payees.findIndex(x => x.pubKey === tenant.addieKeys.pubKey);
        if (tenantIdx >= 0 && payees[tenantIdx].amount - pAmount > 0) {
          payees[tenantIdx].amount -= pAmount;
          payees.push({ pubKey: p.pubKey, amount: pAmount });
        }
      }

      const intentData = await addieCreatePaymentIntent(addieUrl, buyerKeys, buyerUser.uuid, TAPESTRY_PRICE, payees);
      if (!intentData.clientSecret) return res.status(502).json({ error: 'Could not create payment intent' });

      res.json({ clientSecret: intentData.clientSecret, publishableKey: intentData.publishableKey });
    } catch (err) {
      console.error('[linkitylink] purchase/intent error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Step 2: Payment confirmed — store tapestry + trigger transfers
  app.post('/plugin/linkitylink/:slug/purchase/complete', ll_json, async function(req, res) {
    const { slug } = req.params;
    const tenants = loadTenants();
    const tenant = Object.values(tenants).find(t => t.slug === slug);
    if (!tenant || !tenant.template) return res.status(404).json({ error: 'Template not found' });

    const { paymentIntentId, title, links } = req.body || {};
    if (!paymentIntentId) return res.status(400).json({ error: 'paymentIntentId required' });
    if (!Array.isArray(links) || !links.length) return res.status(400).json({ error: 'links required' });

    const config = loadConfig();
    // Fire-and-forget transfer trigger
    if (config.addieUrl) {
      fetch(`${config.addieUrl}/payment/${paymentIntentId}/process-transfers`, { method: 'POST' })
        .catch(err => console.warn('[linkitylink] process-transfers error:', err.message));
    }

    const tapestryId = crypto.randomUUID();
    const tapestries = loadTapestries();
    tapestries[tapestryId] = { tenantUuid: tenant.uuid, title: title || slug, links, paidAt: Date.now() };
    saveTapestries(tapestries);

    res.json({ tapestryId, url: `/plugin/linkitylink/view/${tapestryId}` });
  });

  // Tenant Stripe Connect onboarding — signed URL (tenant visits this from linkitylink-sign.js payouts)
  app.get('/plugin/linkitylink/:slug/payouts', async function(req, res) {
    const { slug } = req.params;
    const { timestamp, pubKey, signature } = req.query;
    if (!timestamp || !pubKey || !signature) {
      return res.status(400).send('Missing timestamp, pubKey, or signature');
    }

    // Reject stale URLs (5-minute window)
    if (Math.abs(Date.now() - parseInt(timestamp)) > 5 * 60 * 1000) {
      return res.status(410).send('URL expired — generate a fresh one with: node linkitylink-sign.js payouts');
    }

    const tenants = loadTenants();
    const tenant = Object.values(tenants).find(t => t.slug === slug);
    if (!tenant) return res.status(404).send('Tenant not found');

    const message = `${timestamp}${slug}`;
    if (!verifySignature(tenant.keys.pubKey, message, signature)) {
      return res.status(401).send('Invalid signature');
    }

    if (!tenant.addieUuid || !tenant.addieKeys) {
      return res.status(503).send('Addie account not set up for this tenant — contact the wiki owner');
    }

    try {
      const addieUrl = getAddieUrl(wikiConfig);
      const returnUrl = `${req.protocol}://${req.get('host')}/plugin/linkitylink/${slug}/payouts/return`;
      const connectUrl = await addieGetStripeConnectUrl(addieUrl, tenant.addieKeys, tenant.addieUuid, returnUrl);
      if (!connectUrl) return res.status(502).send('Addie did not return a Stripe Connect URL');
      res.redirect(connectUrl);
    } catch (err) {
      console.error('[linkitylink] Stripe connect error:', err.message);
      res.status(502).send('Could not start Stripe onboarding: ' + err.message);
    }
  });

  // Return URL after Stripe Connect onboarding
  app.get('/plugin/linkitylink/:slug/payouts/return', function(req, res) {
    const { slug } = req.params;
    const tenants = loadTenants();
    const tenant = Object.values(tenants).find(t => t.slug === slug);
    if (tenant) {
      tenant.stripeOnboarded = true;
      saveTenants(tenants);
    }
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Stripe Connect complete</title>
<style>body{font-family:sans-serif;background:#0a001a;color:#e0d0ff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
.card{background:rgba(30,0,50,.7);border:1px solid rgba(180,100,255,.25);border-radius:12px;padding:2rem;max-width:400px;text-align:center;}
h1{color:#0e0;font-size:1.5rem;margin-bottom:.75rem;}p{color:#a080d0;font-size:.9rem;}</style>
</head><body><div class="card">
<h1>✅ Stripe account connected</h1>
<p>Payouts for <strong>${escapeHtml(slug)}</strong> are now active. Customers can purchase tapestries using your template.</p>
</div></body></html>`);
  });

  // ── Landing page redirect ──────────────────────────────────────────────────

  // Skip the landing page — go straight to the create form
  app.get(['/plugin/linkitylink', '/plugin/linkitylink/'], function(req, res) {
    res.redirect('/plugin/linkitylink/create');
  });

  // Serve our create page (with proxy-aware API paths) instead of the npm version
  app.get('/plugin/linkitylink/create', function(req, res) {
    res.sendFile(path.join(__dirname, '../client/create.html'));
  });

  // Proxy all OTHER linkitylink routes
  // Maps /plugin/linkitylink/* -> http://localhost:6010/*
  // Use a regex — path-to-regexp v8 (bundled with current wiki) no longer
  // accepts bare `/*` wildcards; they require a named capture like `{*path}`.
  app.all(/^\/plugin\/linkitylink\//, function(req, res) {
    // Remove /plugin/linkitylink prefix
    const targetPath = req.url.replace('/plugin/linkitylink', '');
    req.url = targetPath;

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
