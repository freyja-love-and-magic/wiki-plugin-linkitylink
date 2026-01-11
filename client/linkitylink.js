(function() {

  window.plugins.linkitylink = {
    emit: function($item, item) {
      const div = $item[0];
      div.innerHTML = '<p style="background-color:#eee;padding:15px;">Loading Linkitylink status...</p>';

      // Fetch version status
      fetch('/plugin/linkitylink/version-status')
        .then(res => res.json())
        .then(data => {
          div.innerHTML = renderVersionStatus(data);

          // Add click handler for update button
          const updateBtn = div.querySelector('.linkitylink-update-btn');
          if (updateBtn) {
            updateBtn.addEventListener('click', () => updateLinkitylink(div));
          }
        })
        .catch(err => {
          div.innerHTML = `<p style="background-color:#fee;padding:15px;">❌ Error loading Linkitylink status: ${err.message}</p>`;
        });
    },

    bind: function($item, item) {
      // Nothing to bind
    }
  };

  function renderVersionStatus(data) {
    const { installed, published, updateAvailable } = data;

    // Determine status color
    let statusColor, statusIcon, statusText;
    if (!installed) {
      statusColor = '#f44336'; // red
      statusIcon = '🔴';
      statusText = 'Not installed';
    } else if (updateAvailable) {
      statusColor = '#ff9800'; // orange/yellow
      statusIcon = '🟡';
      statusText = 'Update available';
    } else {
      statusColor = '#4caf50'; // green
      statusIcon = '🟢';
      statusText = 'Up to date';
    }

    let html = `
      <div style="border: 2px solid ${statusColor}; padding: 15px; border-radius: 8px; background-color: #fafafa;">
        <h3 style="margin-top: 0;">
          ${statusIcon} Linkitylink Service ${statusText}
        </h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Installed Version:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${installed || 'Not installed'}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Latest Version:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${published || 'Unknown'}</td>
          </tr>
        </table>
    `;

    if (updateAvailable) {
      html += `
        <button class="linkitylink-update-btn" style="
          margin-top: 15px;
          padding: 10px 20px;
          background-color: #2196F3;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
        ">
          ⬆️ Update to ${published}
        </button>
      `;
    }

    html += `</div>`;
    return html;
  }

  function updateLinkitylink(div) {
    div.innerHTML = '<p style="background-color:#fef3cd;padding:15px;">⏳ Updating Linkitylink service...</p>';

    fetch('/plugin/linkitylink/update', { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          div.innerHTML = `
            <div style="background-color:#d4edda;padding:15px;border-radius:4px;color:#155724;">
              ✅ Linkitylink updated successfully to version ${data.version}!
              <br><br>
              <em>Please restart your wiki server for changes to take effect.</em>
            </div>
          `;
        } else {
          div.innerHTML = `
            <div style="background-color:#f8d7da;padding:15px;border-radius:4px;color:#721c24;">
              ❌ Update failed: ${data.error}
            </div>
          `;
        }
      })
      .catch(err => {
        div.innerHTML = `
          <div style="background-color:#f8d7da;padding:15px;border-radius:4px;color:#721c24;">
            ❌ Update error: ${err.message}
          </div>
        `;
      });
  }

})();
