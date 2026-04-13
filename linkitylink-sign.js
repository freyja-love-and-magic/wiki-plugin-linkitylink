#!/usr/bin/env node
/**
 * linkitylink-sign.js — tenant signing tool
 *
 * Usage:
 *   node linkitylink-sign.js init <bundle.zip>
 *     Extract the one-time bundle from the wiki owner:
 *       - keys.json  → ~/.linkitylink/keys/<uuid>.json
 *       - template.svg → ./template.svg  (ready for customization)
 *
 *   node linkitylink-sign.js
 *     Sign template.svg in the current directory and create upload.zip.
 *     Upload upload.zip via the wiki plugin to publish your tapestry template.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEYS_DIR = path.join(process.env.HOME || '/root', '.linkitylink', 'keys');

// ── Crypto helpers ────────────────────────────────────────────────────────────

function signMessage(privKeyPem, message) {
  const sign = crypto.createSign('SHA256');
  sign.update(message);
  sign.end();
  return sign.sign({ key: privKeyPem, dsaEncoding: 'ieee-p1363' }).toString('hex');
}

function getPubKeyPem(privKeyPem) {
  return crypto.createPublicKey(crypto.createPrivateKey(privKeyPem))
    .export({ type: 'spki', format: 'pem' });
}

// ── ZIP helper — use adm-zip if available, fallback to system zip ─────────────

function buildZip(files) {
  // files: [{ name, content (Buffer or string) }]
  let useAdmZip = false;
  try { require.resolve('adm-zip'); useAdmZip = true; } catch (e) {}

  if (useAdmZip) {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    for (const f of files) zip.addFile(f.name, Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content));
    return zip.toBuffer();
  }

  // Fallback: system zip
  const os  = require('os');
  const { execSync } = require('child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'll-'));
  for (const f of files) fs.writeFileSync(path.join(tmp, f.name), f.content);
  const outPath = path.join(os.tmpdir(), `ll-upload-${Date.now()}.zip`);
  const names = files.map(f => f.name).join(' ');
  execSync(`cd "${tmp}" && zip "${outPath}" ${names}`);
  const buf = fs.readFileSync(outPath);
  fs.rmSync(tmp, { recursive: true });
  fs.unlinkSync(outPath);
  return buf;
}

function extractZip(zipPath) {
  // Returns { [name]: Buffer }
  let useAdmZip = false;
  try { require.resolve('adm-zip'); useAdmZip = true; } catch (e) {}

  if (useAdmZip) {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipPath);
    const result = {};
    for (const entry of zip.getEntries()) {
      if (!entry.isDirectory) result[entry.entryName] = zip.readFile(entry);
    }
    return result;
  }

  // Fallback: system unzip
  const os = require('os');
  const { execSync } = require('child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'll-'));
  execSync(`unzip -o "${zipPath}" -d "${tmp}"`);
  const result = {};
  function walk(dir, base) {
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      const rel  = path.join(base, f);
      if (fs.statSync(full).isDirectory()) walk(full, rel);
      else result[rel] = fs.readFileSync(full);
    }
  }
  walk(tmp, '');
  fs.rmSync(tmp, { recursive: true });
  return result;
}

// ── init command ─────────────────────────────────────────────────────────────

function cmdInit(bundlePath) {
  if (!bundlePath) {
    console.error('Usage: node linkitylink-sign.js init <bundle.zip>');
    process.exit(1);
  }
  if (!fs.existsSync(bundlePath)) {
    console.error(`File not found: ${bundlePath}`);
    process.exit(1);
  }

  let files;
  try {
    files = extractZip(bundlePath);
  } catch (e) {
    console.error('Could not extract bundle ZIP:', e.message);
    process.exit(1);
  }

  if (!files['keys.json']) { console.error('Bundle is missing keys.json'); process.exit(1); }
  if (!files['template.svg']) { console.error('Bundle is missing template.svg'); process.exit(1); }

  let keys;
  try {
    keys = JSON.parse(files['keys.json'].toString('utf8'));
  } catch (e) {
    console.error('Invalid keys.json:', e.message);
    process.exit(1);
  }

  const { uuid, slug, name } = keys;
  if (!uuid || !slug) { console.error('keys.json missing uuid or slug'); process.exit(1); }

  if (!fs.existsSync(KEYS_DIR)) fs.mkdirSync(KEYS_DIR, { recursive: true });
  fs.writeFileSync(path.join(KEYS_DIR, `${uuid}.json`), files['keys.json']);

  const templateDest = path.join(process.cwd(), 'template.svg');
  fs.writeFileSync(templateDest, files['template.svg']);

  console.log(`✅ Bundle extracted`);
  console.log(`   uuid : ${uuid}`);
  console.log(`   slug : ${slug}`);
  console.log(`   name : ${name}`);
  console.log(`   keys saved → ${path.join(KEYS_DIR, uuid + '.json')}`);
  console.log(`   template  → ${templateDest}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Edit template.svg to customize your tapestry design');
  console.log('     - Modify colors, fonts, layout in the BACKGROUND LAYER');
  console.log('     - Keep {{tapestry_title}}, {{link_N_title}}, {{link_N_url}} placeholders');
  console.log('  2. Run: node linkitylink-sign.js');
  console.log('  3. Upload the generated upload.zip via the wiki plugin');
}

// ── sign command (default) ────────────────────────────────────────────────────

function cmdSign() {
  if (!fs.existsSync(KEYS_DIR)) {
    console.error('No keys found. Run "node linkitylink-sign.js init <bundle.zip>" first.');
    process.exit(1);
  }

  const keyFiles = fs.readdirSync(KEYS_DIR).filter(f => f.endsWith('.json'));
  if (!keyFiles.length) { console.error('No key files in ' + KEYS_DIR); process.exit(1); }

  let bundle;
  if (keyFiles.length === 1) {
    bundle = JSON.parse(fs.readFileSync(path.join(KEYS_DIR, keyFiles[0]), 'utf8'));
  } else {
    const sorted = keyFiles
      .map(f => ({ f, mtime: fs.statSync(path.join(KEYS_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    bundle = JSON.parse(fs.readFileSync(path.join(KEYS_DIR, sorted[0].f), 'utf8'));
    console.log(`Using most recent key: ${sorted[0].f}`);
  }

  const { uuid, slug, keys } = bundle;
  if (!uuid || !slug || !keys || !keys.privKey) {
    console.error('Bundle missing uuid, slug, or private key');
    process.exit(1);
  }

  const templatePath = path.join(process.cwd(), 'template.svg');
  if (!fs.existsSync(templatePath)) {
    console.error('template.svg not found in current directory');
    console.error('Run "node linkitylink-sign.js init <bundle.zip>" to extract the starter template.');
    process.exit(1);
  }

  const templateSvg = fs.readFileSync(templatePath, 'utf8');

  // Quick sanity check
  if (!templateSvg.includes('{{link_1_title}}')) {
    console.warn('Warning: template.svg has no {{link_1_title}} slot — customers will see empty links');
  }

  const timestamp = Date.now().toString();
  const message   = `${timestamp}${uuid}${slug}`;
  let signature, pubKey;
  try {
    signature = signMessage(keys.privKey, message);
    pubKey    = getPubKeyPem(keys.privKey);
  } catch (e) {
    console.error('Signing failed:', e.message);
    process.exit(1);
  }

  const manifest = { uuid, slug, timestamp, pubKey, signature };

  const zipBuffer = buildZip([
    { name: 'manifest.json', content: JSON.stringify(manifest, null, 2) },
    { name: 'template.svg',  content: templateSvg }
  ]);

  const outPath = path.join(process.cwd(), 'upload.zip');
  fs.writeFileSync(outPath, zipBuffer);

  console.log(`✅ Signed archive created: ${outPath}`);
  console.log(`   uuid      : ${uuid}`);
  console.log(`   slug      : ${slug}`);
  console.log(`   timestamp : ${timestamp}`);
  console.log('');
  console.log('Upload upload.zip via the wiki plugin.');
  console.log(`Customers will create tapestries at: <wiki-url>/plugin/linkitylink/${slug}`);
}

// ── payouts command ───────────────────────────────────────────────────────────

function cmdPayouts(wikiUrl) {
  if (!wikiUrl) {
    console.error('Usage: node linkitylink-sign.js payouts <wiki-url>');
    console.error('Example: node linkitylink-sign.js payouts https://mywiki.example.com');
    process.exit(1);
  }

  if (!fs.existsSync(KEYS_DIR)) {
    console.error('No keys found. Run "node linkitylink-sign.js init <bundle.zip>" first.');
    process.exit(1);
  }

  const keyFiles = fs.readdirSync(KEYS_DIR).filter(f => f.endsWith('.json'));
  if (!keyFiles.length) { console.error('No key files in ' + KEYS_DIR); process.exit(1); }

  let bundle;
  if (keyFiles.length === 1) {
    bundle = JSON.parse(fs.readFileSync(path.join(KEYS_DIR, keyFiles[0]), 'utf8'));
  } else {
    const sorted = keyFiles
      .map(f => ({ f, mtime: fs.statSync(path.join(KEYS_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    bundle = JSON.parse(fs.readFileSync(path.join(KEYS_DIR, sorted[0].f), 'utf8'));
  }

  const { slug, keys } = bundle;
  if (!slug || !keys || !keys.privKey) {
    console.error('Bundle missing slug or private key');
    process.exit(1);
  }

  const timestamp = Date.now().toString();
  const message   = `${timestamp}${slug}`;
  let signature, pubKey;
  try {
    signature = signMessage(keys.privKey, message);
    pubKey    = getPubKeyPem(keys.privKey);
  } catch (e) {
    console.error('Signing failed:', e.message);
    process.exit(1);
  }

  const base = wikiUrl.replace(/\/$/, '');
  const url  = `${base}/plugin/linkitylink/${slug}/payouts` +
               `?timestamp=${encodeURIComponent(timestamp)}` +
               `&pubKey=${encodeURIComponent(pubKey)}` +
               `&signature=${encodeURIComponent(signature)}`;

  console.log('✅ Payouts URL generated (valid for 5 minutes):');
  console.log('');
  console.log(url);
  console.log('');

  // Try to open in browser
  const { exec } = require('child_process');
  const open = process.platform === 'darwin' ? 'open' :
               process.platform === 'win32'  ? 'start' : 'xdg-open';
  exec(`${open} "${url}"`, (err) => {
    if (err) console.log('(Could not open browser — copy the URL above)');
    else console.log('Opening in browser…');
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

const cmd = process.argv[2];
if (cmd === 'init') {
  cmdInit(process.argv[3]);
} else if (cmd === 'payouts') {
  cmdPayouts(process.argv[3]);
} else if (!cmd || cmd === 'sign') {
  cmdSign();
} else {
  console.error(`Unknown command: ${cmd}`);
  console.error('Usage:');
  console.error('  node linkitylink-sign.js init <bundle.zip>');
  console.error('  node linkitylink-sign.js');
  console.error('  node linkitylink-sign.js payouts <wiki-url>');
  process.exit(1);
}
