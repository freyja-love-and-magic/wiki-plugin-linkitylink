(function() {

  window.plugins.linkitylink = {
    emit: function($item, item) {
      const div = $item[0];
      div.innerHTML = '<p style="padding:12px;color:#888;">Loading Linkitylink…</p>';

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
    div.querySelector('#ll-register-form').addEventListener('submit', function(e) {
      e.preventDefault();
      const name = div.querySelector('#ll-tenant-name').value.trim();
      const slug = div.querySelector('#ll-tenant-slug').value.trim();
      if (!name || !slug) return;
      registerTenant(div, name, slug);
    });
    div.querySelector('#ll-url-btn').addEventListener('click', function() {
      saveUrl(div);
    });
    updateStripeBanner(div, data);
  }

  function ownerHTML(data) {
    const { tenants, allyabaseUrl, serverAddieReady, stripeOnboarded } = data;
    const addieUrl = allyabaseUrl;
    const rows = tenants.length ? tenants.map(t => `
      <tr>
        <td style="padding:6px 8px;">${esc(t.name)}</td>
        <td style="padding:6px 8px;"><code>${esc(t.slug)}</code></td>
        <td style="padding:6px 8px;">${t.hasTemplate ? '✅ live' : t.bundleTokenUsed ? '⏳ awaiting upload' : '📦 bundle not downloaded'}</td>
        <td style="padding:6px 8px;">${t.stripeOnboarded ? '✅ payouts active' : '⚠️ run payouts cmd'}</td>
        <td style="padding:6px 8px;">
          ${t.hasTemplate ? `<a href="/plugin/linkitylink/${esc(t.slug)}" target="_blank" style="color:#c89aff;">Create page</a>` : '—'}
        </td>
      </tr>`).join('') : `<tr><td colspan="5" style="padding:8px;color:#888;">No tenants yet.</td></tr>`;

    const stripeReady = serverAddieReady && stripeOnboarded;
    const stripePending = serverAddieReady && !stripeOnboarded;

    return `
      <div style="border:2px solid #7c3aed;border-radius:8px;padding:16px;background:#1a0033;color:#e0d0ff;font-family:sans-serif;">
        <h3 style="margin:0 0 12px;color:#c89aff;font-size:1rem;">🔗 Linkitylink</h3>

        <!-- allyabase URL -->
        <div style="margin-bottom:14px;">
          <label style="font-size:0.8rem;color:#a080d0;display:block;margin-bottom:4px;">Allyabase URL</label>
          <div style="display:flex;gap:6px;">
            <input id="ll-url-input" value="${esc(addieUrl || '')}" placeholder="https://dev.allyabase.com"
              style="flex:1;background:#2a0044;border:1px solid #5a3080;border-radius:4px;padding:6px 8px;color:#e0d0ff;font-size:0.8rem;">
            <button id="ll-url-btn"
              style="background:#5a3080;border:none;border-radius:4px;padding:6px 12px;color:#e0d0ff;cursor:pointer;font-size:0.8rem;white-space:nowrap;">
              Save
            </button>
          </div>
          <div id="ll-url-status" style="margin-top:6px;font-size:0.75rem;"></div>
        </div>

        <!-- Stripe banner -->
        <div id="ll-stripe-banner" style="display:none;border-radius:8px;padding:12px 14px;margin-bottom:14px;">
          <div id="ll-stripe-title" style="font-size:0.875rem;font-weight:600;margin-bottom:4px;"></div>
          <div id="ll-stripe-desc" style="font-size:0.8rem;margin-bottom:8px;"></div>
          <a id="ll-stripe-btn" href="/plugin/linkitylink/setup/stripe"
            style="display:inline-block;padding:6px 14px;border-radius:4px;font-size:0.8rem;font-weight:600;text-decoration:none;color:white;background:#7c3aed;">
            Set up payouts →
          </a>
        </div>

        <!-- Tenant table -->
        <table style="width:100%;border-collapse:collapse;font-size:0.875rem;margin-bottom:14px;">
          <thead>
            <tr style="border-bottom:1px solid #5a3080;">
              <th style="text-align:left;padding:4px 8px;color:#a080d0;">Name</th>
              <th style="text-align:left;padding:4px 8px;color:#a080d0;">Slug</th>
              <th style="text-align:left;padding:4px 8px;color:#a080d0;">Template</th>
              <th style="text-align:left;padding:4px 8px;color:#a080d0;">Stripe</th>
              <th style="text-align:left;padding:4px 8px;color:#a080d0;">Link</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>

        <!-- Register form — locked until Stripe is onboarded -->
        <div id="ll-register-locked" style="display:${stripeReady ? 'none' : 'block'};font-size:0.8rem;color:#7060a0;margin-bottom:10px;">
          Complete server Stripe setup above before registering tenants.
        </div>
        <form id="ll-register-form" style="display:${stripeReady ? 'flex' : 'none'};gap:8px;flex-wrap:wrap;align-items:flex-end;">
          <div style="display:flex;flex-direction:column;gap:4px;">
            <label style="font-size:0.8rem;color:#a080d0;">Name</label>
            <input id="ll-tenant-name" placeholder="Alice's Links"
              style="background:#2a0044;border:1px solid #5a3080;border-radius:4px;padding:6px 8px;color:#e0d0ff;font-size:0.875rem;width:160px;">
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;">
            <label style="font-size:0.8rem;color:#a080d0;">Slug</label>
            <input id="ll-tenant-slug" placeholder="alice" pattern="[a-z0-9-]+"
              style="background:#2a0044;border:1px solid #5a3080;border-radius:4px;padding:6px 8px;color:#e0d0ff;font-size:0.875rem;width:120px;">
          </div>
          <button type="submit"
            style="background:#7c3aed;border:none;border-radius:4px;padding:8px 14px;color:white;cursor:pointer;font-size:0.875rem;white-space:nowrap;">
            + Register Tenant
          </button>
        </form>

        <div id="ll-register-result" style="margin-top:10px;font-size:0.8rem;"></div>
      </div>`;
  }

  function updateStripeBanner(div, data) {
    const banner = div.querySelector('#ll-stripe-banner');
    const locked = div.querySelector('#ll-register-locked');
    const form   = div.querySelector('#ll-register-form');
    if (!banner) return;

    if (!data.serverAddieReady) {
      banner.style.display = 'none';
      return;
    }

    banner.style.display = 'block';
    const title = div.querySelector('#ll-stripe-title');
    const desc  = div.querySelector('#ll-stripe-desc');
    const btn   = div.querySelector('#ll-stripe-btn');

    if (data.stripeOnboarded) {
      banner.style.background = 'rgba(16,185,129,0.15)';
      banner.style.border = '1px solid rgba(16,185,129,0.4)';
      title.textContent = '✅ Server payouts enabled';
      desc.textContent  = 'Your server is connected to Stripe and will receive a platform fee from tapestry purchases.';
      btn.textContent   = 'Update Stripe account';
      btn.style.background = '#10b981';
      if (locked) locked.style.display = 'none';
      if (form)   form.style.display   = 'flex';
    } else {
      banner.style.background = 'rgba(245,158,11,0.12)';
      banner.style.border = '1px solid rgba(245,158,11,0.4)';
      title.textContent = '💳 Enable server payouts';
      desc.textContent  = 'Complete Stripe onboarding so your server receives a platform fee from all tapestry purchases.';
      btn.textContent   = 'Set up payouts →';
      btn.style.background = '#7c3aed';
      if (locked) locked.style.display = 'block';
      if (form)   form.style.display   = 'none';
    }
  }

  function saveUrl(div) {
    const input = div.querySelector('#ll-url-input');
    const btn   = div.querySelector('#ll-url-btn');
    const status = div.querySelector('#ll-url-status');
    const url = input.value.trim();
    if (!url) { status.innerHTML = '<span style="color:#f55;">Enter a URL first</span>'; return; }

    btn.disabled = true;
    btn.textContent = 'Saving…';
    fetch('/plugin/linkitylink/config', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allyabaseUrl: url })
    })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.error) { status.innerHTML = '<span style="color:#f55;">' + esc(d.error) + '</span>'; return; }
        status.innerHTML = '<span style="color:#0e0;">✅ Saved</span>' +
          (d.warning ? ' <span style="color:#fb0;">— ' + esc(d.warning) + '</span>' : '');
        updateStripeBanner(div, d);
      })
      .catch(function(e) { status.innerHTML = '<span style="color:#f55;">' + esc(e.message) + '</span>'; })
      .finally(function() { btn.disabled = false; btn.textContent = 'Save'; });
  }

  function registerTenant(div, name, slug) {
    const result = div.querySelector('#ll-register-result');
    result.textContent = 'Registering…';

    fetch('/plugin/linkitylink/register', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, slug })
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          result.innerHTML = `<span style="color:#f55;">Error: ${esc(data.error)}</span>`;
          return;
        }
        const bundleUrl = `/plugin/linkitylink/tenant/bundle/${data.bundleToken}`;
        const fullUrl = window.location.origin + bundleUrl;
        result.innerHTML = `
          <span style="color:#0e0;">✅ Tenant registered!</span>
          One-time bundle download (ZIP — send this URL to the tenant):<br>
          <code style="word-break:break-all;background:#2a0044;padding:4px 6px;border-radius:4px;display:block;margin-top:4px;">
            ${fullUrl}
          </code>
          <div style="margin-top:6px;font-size:0.75rem;color:#7060a0;">
            Tenant runs: <code>node linkitylink-sign.js init bundle.zip</code>, edits template.svg, then
            <code>node linkitylink-sign.js</code> to create upload.zip
          </div>`;
        // Refresh the tenant list
        setTimeout(() => {
          fetch('/plugin/linkitylink/config', { credentials: 'include' })
            .then(r => r.json())
            .then(d => {
              if (d.isOwner) {
                const table = div.querySelector('table tbody');
                if (table) table.outerHTML = ownerHTML(d.tenants).match(/<tbody>[\s\S]*<\/tbody>/)[0];
              }
            });
        }, 300);
      })
      .catch(err => {
        result.innerHTML = `<span style="color:#f55;">Error: ${esc(err.message)}</span>`;
      });
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
        div.innerHTML = `<p style="padding:12px;color:#c00;">Error: ${esc(err.message)}</p>`;
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
