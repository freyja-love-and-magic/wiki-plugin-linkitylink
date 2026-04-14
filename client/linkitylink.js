(function() {

  window.plugins.linkitylink = {
    emit: function($item, item) {
      const div = $item[0];
      div.innerHTML = '<p style="padding:12px;color:#888;">Loading…</p>';

      fetch('/plugin/linkitylink/config', { credentials: 'include' })
        .then(res => res.json())
        .then(data => {
          if (data.isOwner) {
            renderOwnerView(div, data);
          } else {
            renderVersionStatus(div);
          }
        })
        .catch(() => renderVersionStatus(div));
    },

    bind: function($item, item) {}
  };

  // ── Owner view ──────────────────────────────────────────────────────────────

  function renderOwnerView(div, data) {
    div.innerHTML = ownerHTML(data);
    attachOwnerListeners(div, data);
  }

  function ownerHTML(data) {
    const { tenants = [], allyabaseUrl = '', serverAddieReady, stripeOnboarded } = data;
    const step1Done = !!allyabaseUrl;
    const step2Done = serverAddieReady && stripeOnboarded;

    // ── Tenant table rows
    const rows = tenants.length
      ? tenants.map(t => {
          const templateCell = t.hasTemplate
            ? '<span style="color:#0e0;">✅ live</span>'
            : t.bundleTokenUsed
              ? '<span style="color:#fb0;">⏳ awaiting upload</span>'
              : '<span style="color:#7060a0;">📦 bundle not downloaded</span>';
          const stripeCell = t.stripeOnboarded
            ? '<span style="color:#0e0;">✅ active</span>'
            : '<span style="color:#fb0;">⚠️ pending</span>';
          const linkCell = t.hasTemplate
            ? `<a href="/plugin/linkitylink/${esc(t.slug)}" target="_blank" style="color:#c89aff;font-size:0.8rem;">Open →</a>`
            : '—';
          return `<tr style="border-bottom:1px solid rgba(90,48,128,0.3);">
            <td style="padding:6px 8px;font-size:0.85rem;">${esc(t.name)}</td>
            <td style="padding:6px 8px;"><code style="font-size:0.8rem;color:#c89aff;">${esc(t.slug)}</code></td>
            <td style="padding:6px 8px;">${templateCell}</td>
            <td style="padding:6px 8px;">${stripeCell}</td>
            <td style="padding:6px 8px;">${linkCell}</td>
          </tr>`;
        }).join('')
      : `<tr><td colspan="5" style="padding:10px 8px;color:#7060a0;font-size:0.85rem;">No tenants yet — register one below.</td></tr>`;

    // ── Stripe banner
    let stripeBanner = '';
    if (step1Done) {
      if (stripeOnboarded) {
        stripeBanner = `
          <div style="background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.35);border-radius:6px;padding:10px 12px;margin-bottom:14px;font-size:0.8rem;">
            <strong style="color:#10b981;">✅ Server payouts enabled</strong>
            <span style="color:#6ee7b7;margin-left:8px;">Your wiki receives 1% of every tapestry sale.</span>
            <a href="/plugin/linkitylink/setup/stripe" target="_blank" style="float:right;color:#10b981;font-size:0.75rem;">Update →</a>
          </div>`;
      } else {
        stripeBanner = `
          <div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.35);border-radius:6px;padding:10px 12px;margin-bottom:14px;">
            <div style="font-size:0.875rem;font-weight:600;color:#fbbf24;margin-bottom:4px;">💳 Enable server payouts</div>
            <div style="font-size:0.8rem;color:#fde68a;margin-bottom:8px;">Connect Stripe so your wiki receives a 1% platform fee from tapestry purchases.</div>
            <a href="/plugin/linkitylink/setup/stripe" target="_blank"
              style="display:inline-block;padding:5px 12px;background:#7c3aed;border-radius:4px;color:white;font-size:0.8rem;font-weight:600;text-decoration:none;">
              Set up payouts →
            </a>
          </div>`;
      }
    }

    return `
      <div style="border:2px solid #7c3aed;border-radius:10px;padding:16px;background:#12001f;color:#e0d0ff;font-family:system-ui,sans-serif;">

        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span style="font-size:1.1rem;">🔗</span>
          <h3 style="margin:0;color:#c89aff;font-size:1rem;font-weight:700;">Linkitylink</h3>
          <span style="margin-left:auto;font-size:0.7rem;color:#5a3080;background:rgba(124,58,237,.15);border:1px solid rgba(124,58,237,.3);border-radius:4px;padding:2px 6px;">owner</span>
        </div>
        <p style="margin:0 0 14px;font-size:0.78rem;color:#7060a0;line-height:1.4;">
          Create tapestry templates for tenants. Customers pay $20 to create their own link page from a tenant's template.
        </p>

        <!-- How it works -->
        <details style="margin-bottom:14px;">
          <summary style="font-size:0.8rem;color:#a080d0;cursor:pointer;user-select:none;">How it works ▾</summary>
          <div style="margin-top:8px;font-size:0.78rem;color:#9070b0;line-height:1.6;padding-left:8px;border-left:2px solid #5a3080;">
            <strong style="color:#c89aff;">1. You (owner)</strong> register a tenant and send them a bundle ZIP.<br>
            <strong style="color:#c89aff;">2. Tenant</strong> runs <code style="background:#1a0033;padding:1px 4px;border-radius:3px;">node linkitylink-sign.js init bundle.zip</code>,
              edits <code style="background:#1a0033;padding:1px 4px;border-radius:3px;">template.svg</code>, then runs
              <code style="background:#1a0033;padding:1px 4px;border-radius:3px;">node linkitylink-sign.js</code> to create
              <code style="background:#1a0033;padding:1px 4px;border-radius:3px;">upload.zip</code>.<br>
            <strong style="color:#c89aff;">3. Tenant</strong> drags <code style="background:#1a0033;padding:1px 4px;border-radius:3px;">upload.zip</code> onto this wiki item to publish their template.<br>
            <strong style="color:#c89aff;">4. Customers</strong> visit <code style="background:#1a0033;padding:1px 4px;border-radius:3px;">/plugin/linkitylink/{slug}</code>, pay $20, and get a shareable tapestry link page.
          </div>
        </details>

        <!-- Step 1: Allyabase URL -->
        <div style="margin-bottom:14px;">
          <div style="font-size:0.75rem;color:#7060a0;margin-bottom:6px;display:flex;align-items:center;gap:6px;">
            <span style="background:${step1Done ? '#0e0' : '#5a3080'};color:${step1Done ? '#001a00' : '#c89aff'};border-radius:50%;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;flex-shrink:0;">${step1Done ? '✓' : '1'}</span>
            <strong style="color:#a080d0;">Connect Allyabase</strong>
          </div>
          <div style="display:flex;gap:6px;">
            <input id="ll-url-input" value="${esc(allyabaseUrl)}" placeholder="https://dev.allyabase.com"
              style="flex:1;background:#1a0033;border:1px solid #5a3080;border-radius:4px;padding:6px 8px;color:#e0d0ff;font-size:0.8rem;">
            <button id="ll-url-btn"
              style="background:#5a3080;border:none;border-radius:4px;padding:6px 12px;color:#e0d0ff;cursor:pointer;font-size:0.8rem;white-space:nowrap;">
              Save
            </button>
          </div>
          <div id="ll-url-status" style="margin-top:4px;font-size:0.75rem;min-height:1em;"></div>
        </div>

        <!-- Step 2: Stripe -->
        <div style="margin-bottom:14px;">
          <div style="font-size:0.75rem;color:#7060a0;margin-bottom:6px;display:flex;align-items:center;gap:6px;">
            <span style="background:${step2Done ? '#0e0' : '#5a3080'};color:${step2Done ? '#001a00' : '#c89aff'};border-radius:50%;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;flex-shrink:0;">${step2Done ? '✓' : '2'}</span>
            <strong style="color:#a080d0;">Enable server payouts</strong>
          </div>
          ${stripeBanner || `<div style="font-size:0.78rem;color:#5a3080;">Save your Allyabase URL first.</div>`}
        </div>

        <!-- Step 3: Tenants -->
        <div style="margin-bottom:14px;">
          <div style="font-size:0.75rem;color:#7060a0;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
            <span style="background:#5a3080;color:#c89aff;border-radius:50%;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;flex-shrink:0;">3</span>
            <strong style="color:#a080d0;">Tenants</strong>
          </div>

          ${tenants.length ? `
          <table style="width:100%;border-collapse:collapse;font-size:0.85rem;margin-bottom:10px;">
            <thead>
              <tr style="border-bottom:1px solid #5a3080;">
                <th style="text-align:left;padding:4px 8px;color:#7060a0;font-weight:600;font-size:0.75rem;">Name</th>
                <th style="text-align:left;padding:4px 8px;color:#7060a0;font-weight:600;font-size:0.75rem;">Slug</th>
                <th style="text-align:left;padding:4px 8px;color:#7060a0;font-weight:600;font-size:0.75rem;">Template</th>
                <th style="text-align:left;padding:4px 8px;color:#7060a0;font-weight:600;font-size:0.75rem;">Stripe</th>
                <th style="text-align:left;padding:4px 8px;color:#7060a0;font-weight:600;font-size:0.75rem;">Tapestry</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>` : ''}

          ${!step2Done
            ? `<div id="ll-register-locked" style="font-size:0.78rem;color:#5a3080;padding:8px 10px;border:1px dashed #3a2060;border-radius:4px;">
                Complete steps 1 and 2 above before registering tenants.
               </div>`
            : `<form id="ll-register-form" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
                <div style="display:flex;flex-direction:column;gap:3px;">
                  <label style="font-size:0.75rem;color:#a080d0;">Name</label>
                  <input id="ll-tenant-name" placeholder="Alice's Links"
                    style="background:#1a0033;border:1px solid #5a3080;border-radius:4px;padding:6px 8px;color:#e0d0ff;font-size:0.85rem;width:150px;">
                </div>
                <div style="display:flex;flex-direction:column;gap:3px;">
                  <label style="font-size:0.75rem;color:#a080d0;">Slug</label>
                  <input id="ll-tenant-slug" placeholder="alice" pattern="[a-z0-9-]+"
                    style="background:#1a0033;border:1px solid #5a3080;border-radius:4px;padding:6px 8px;color:#e0d0ff;font-size:0.85rem;width:110px;">
                </div>
                <button id="ll-register-btn" type="button"
                  style="background:#7c3aed;border:none;border-radius:4px;padding:8px 14px;color:white;cursor:pointer;font-size:0.85rem;white-space:nowrap;">
                  + Register tenant
                </button>
              </form>`
          }
          <div id="ll-register-result" style="margin-top:10px;font-size:0.8rem;"></div>
        </div>

        <!-- Template upload -->
        <div style="border-top:1px solid #3a2060;padding-top:12px;">
          <div style="font-size:0.75rem;color:#7060a0;margin-bottom:6px;display:flex;align-items:center;gap:6px;">
            <span style="font-size:0.85rem;">📤</span>
            <strong style="color:#a080d0;">Upload tenant template</strong>
            <span style="color:#5a3080;font-size:0.72rem;">(drag upload.zip here)</span>
          </div>
          <input type="file" id="ll-upload-input" accept=".zip"
            style="font-size:0.78rem;color:#a080d0;width:100%;">
          <div id="ll-upload-status" style="margin-top:6px;font-size:0.75rem;min-height:1em;"></div>
        </div>

      </div>`;
  }

  function attachOwnerListeners(div, data) {
    // Save URL
    div.querySelector('#ll-url-btn').addEventListener('click', function() { saveUrl(div); });

    // Register tenant
    const regBtn = div.querySelector('#ll-register-btn');
    if (regBtn) {
      regBtn.addEventListener('click', function() {
        const name = div.querySelector('#ll-tenant-name').value.trim();
        const slug = div.querySelector('#ll-tenant-slug').value.trim();
        if (!name || !slug) {
          div.querySelector('#ll-register-result').innerHTML = '<span style="color:#f55;">Name and slug are required.</span>';
          return;
        }
        if (!/^[a-z0-9-]+$/.test(slug)) {
          div.querySelector('#ll-register-result').innerHTML = '<span style="color:#f55;">Slug must be lowercase letters, numbers, and hyphens only.</span>';
          return;
        }
        registerTenant(div, name, slug);
      });
    }

    // Template upload
    const uploadInput = div.querySelector('#ll-upload-input');
    if (uploadInput) {
      uploadInput.addEventListener('change', function() {
        if (!this.files || !this.files[0]) return;
        uploadTemplate(div, this.files[0]);
      });
    }
  }

  function saveUrl(div) {
    const input  = div.querySelector('#ll-url-input');
    const btn    = div.querySelector('#ll-url-btn');
    const status = div.querySelector('#ll-url-status');
    const url = (input.value || '').trim();
    if (!url) { status.innerHTML = '<span style="color:#f55;">Enter a URL first.</span>'; return; }

    btn.disabled = true; btn.textContent = 'Saving…';
    fetch('/plugin/linkitylink/config', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allyabaseUrl: url })
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) { status.innerHTML = '<span style="color:#f55;">' + esc(d.error) + '</span>'; return; }
        status.innerHTML = '<span style="color:#0e0;">✅ Saved</span>' +
          (d.warning ? ' <span style="color:#fb0;">— ' + esc(d.warning) + '</span>' : '');
        // Re-fetch and re-render so Stripe banner updates
        fetch('/plugin/linkitylink/config', { credentials: 'include' })
          .then(r => r.json()).then(data => { if (data.isOwner) renderOwnerView(div, data); });
      })
      .catch(e => { status.innerHTML = '<span style="color:#f55;">' + esc(e.message) + '</span>'; })
      .finally(() => { btn.disabled = false; btn.textContent = 'Save'; });
  }

  function registerTenant(div, name, slug) {
    const result = div.querySelector('#ll-register-result');
    const btn    = div.querySelector('#ll-register-btn');
    result.textContent = 'Registering…';
    if (btn) btn.disabled = true;

    fetch('/plugin/linkitylink/register', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, slug })
    })
      .then(r => r.json())
      .then(d => {
        if (btn) btn.disabled = false;
        if (d.error) {
          result.innerHTML = '<span style="color:#f55;">Error: ' + esc(d.error) + '</span>';
          return;
        }
        const bundleUrl = window.location.origin + '/plugin/linkitylink/tenant/bundle/' + d.bundleToken;
        result.innerHTML = `
          <div style="background:rgba(0,200,80,.08);border:1px solid rgba(0,200,80,.25);border-radius:6px;padding:10px 12px;margin-top:4px;">
            <div style="color:#0e0;font-weight:600;margin-bottom:6px;">✅ Tenant registered!</div>
            <div style="font-size:0.78rem;color:#a0e0a0;margin-bottom:6px;">
              Send this one-time bundle URL to <strong>${esc(name)}</strong>. It expires after first download.
            </div>
            <code style="word-break:break-all;background:#001a0a;border:1px solid #0a4020;padding:6px 8px;border-radius:4px;display:block;font-size:0.75rem;color:#6ee7b7;">${esc(bundleUrl)}</code>
            <div style="margin-top:8px;font-size:0.75rem;color:#7060a0;line-height:1.5;">
              Tenant workflow:<br>
              1. Download bundle → <code style="background:#1a0033;padding:1px 4px;border-radius:3px;">node linkitylink-sign.js init bundle.zip</code><br>
              2. Edit <code style="background:#1a0033;padding:1px 4px;border-radius:3px;">template.svg</code> (keep the <code style="background:#1a0033;padding:1px 4px;border-radius:3px;">{{link_N_*}}</code> placeholders)<br>
              3. Sign → <code style="background:#1a0033;padding:1px 4px;border-radius:3px;">node linkitylink-sign.js</code><br>
              4. Drag <code style="background:#1a0033;padding:1px 4px;border-radius:3px;">upload.zip</code> onto this wiki item to publish<br>
              5. Set up Stripe payouts → <code style="background:#1a0033;padding:1px 4px;border-radius:3px;">node linkitylink-sign.js payouts &lt;wiki-url&gt;</code>
            </div>
          </div>`;
        // Refresh tenant table
        setTimeout(() => {
          fetch('/plugin/linkitylink/config', { credentials: 'include' })
            .then(r => r.json()).then(data => { if (data.isOwner) renderOwnerView(div, data); });
        }, 400);
      })
      .catch(e => {
        if (btn) btn.disabled = false;
        result.innerHTML = '<span style="color:#f55;">Error: ' + esc(e.message) + '</span>';
      });
  }

  function uploadTemplate(div, file) {
    const status = div.querySelector('#ll-upload-status');
    status.innerHTML = '<span style="color:#a080d0;">Uploading…</span>';

    const fd = new FormData();
    fd.append('archive', file);

    fetch('/plugin/linkitylink/upload', {
      method: 'POST', credentials: 'include', body: fd
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) { status.innerHTML = '<span style="color:#f55;">Error: ' + esc(d.error) + '</span>'; return; }
        status.innerHTML = '<span style="color:#0e0;">✅ Template uploaded for <strong>' + esc(d.slug) + '</strong>!</span>';
        setTimeout(() => {
          fetch('/plugin/linkitylink/config', { credentials: 'include' })
            .then(r => r.json()).then(data => { if (data.isOwner) renderOwnerView(div, data); });
        }, 400);
      })
      .catch(e => { status.innerHTML = '<span style="color:#f55;">Error: ' + esc(e.message) + '</span>'; });
  }

  // ── Visitor / version status view ──────────────────────────────────────────

  function renderVersionStatus(div) {
    fetch('/plugin/linkitylink/version-status')
      .then(res => res.json())
      .then(data => {
        div.innerHTML = versionHTML(data);
        const btn = div.querySelector('.ll-update-btn');
        if (btn) btn.addEventListener('click', () => doUpdate(div));
      })
      .catch(err => {
        div.innerHTML = '<p style="padding:12px;color:#c00;">Error: ' + esc(err.message) + '</p>';
      });
  }

  function versionHTML(data) {
    const { installed, published, updateAvailable } = data;
    const color = !installed ? '#f55' : updateAvailable ? '#fb0' : '#0e0';
    const label = !installed ? 'Not installed' : updateAvailable ? 'Update available' : 'Up to date';

    let html = `
      <div style="border:2px solid ${color};border-radius:8px;padding:14px;background:#fafafa;">
        <h3 style="margin:0 0 10px;font-size:1rem;">
          <span style="color:${color};font-size:18px;">◉</span> Linkitylink — ${label}
        </h3>
        <table style="width:100%;border-collapse:collapse;font-size:0.875rem;">
          <tr><td style="padding:6px;border-bottom:1px solid #ddd;"><strong>Installed</strong></td>
              <td style="padding:6px;border-bottom:1px solid #ddd;">${installed || 'Not installed'}</td></tr>
          <tr><td style="padding:6px;"><strong>Latest</strong></td>
              <td style="padding:6px;">${published || 'Unknown'}</td></tr>
        </table>`;

    if (updateAvailable) {
      html += `<button class="ll-update-btn" style="margin-top:12px;padding:8px 16px;background:#2196F3;color:white;border:none;border-radius:4px;cursor:pointer;">
        ⬆️ Update to ${published}</button>`;
    }
    return html + '</div>';
  }

  function doUpdate(div) {
    div.innerHTML = '<p style="padding:12px;background:#fef3cd;">⏳ Updating…</p>';
    fetch('/plugin/linkitylink/update', { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          div.innerHTML = `<div style="padding:12px;background:#d4edda;color:#155724;border-radius:4px;">
            ✅ Updated to ${data.version}! Restart wiki to apply.</div>`;
        } else {
          div.innerHTML = `<div style="padding:12px;background:#f8d7da;color:#721c24;border-radius:4px;">
            ❌ ${esc(data.error)}</div>`;
        }
      });
  }

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

})();
