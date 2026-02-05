# wiki-plugin-linkitylink

A Federated Wiki plugin that demonstrates the **Service-Bundling Plugin Pattern** for integrating standalone Node.js services into fedwiki.

**Part of**: [The Advancement](./THE-ADVANCEMENT.md) - See the full vision for rebuilding platforms for communities.

**This Document**: Technical implementation details for developers. For the broader vision and roadmap, see [THE-ADVANCEMENT.md](./THE-ADVANCEMENT.md).

## Architecture Pattern: Service-Bundling Plugin

This plugin implements a reusable pattern for fedwiki plugins that need to run external services. The pattern solves several key challenges:

### 1. **Service as npm Dependency**

Instead of requiring users to manually install and configure a separate service, we bundle it as a dependency:

```json
{
  "dependencies": {
    "linkitylink": "^0.0.2",
    "http-proxy": "^1.18.1",
    "node-fetch": "^2.6.1"
  }
}
```

**Benefits:**
- ✅ Single `npm install` gets everything
- ✅ Version pinning ensures compatibility
- ✅ Service updates are managed through the plugin

### 2. **Automatic Service Spawning with Process Lifecycle Management**

The plugin automatically spawns the service as a child process when loaded and manages its entire lifecycle:

```javascript
// server/server.js
linkitylinkProcess = spawn('node', ['linkitylink.js'], {
  cwd: LINKITYLINK_PATH,
  env: {
    PORT: LINKITYLINK_PORT.toString(),
    FOUNT_BASE_URL: wikiConfig.fountURL,
    BDO_BASE_URL: wikiConfig.bdoURL,
    ADDIE_BASE_URL: wikiConfig.addieURL
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

// Write PID file immediately after spawning
writePidFile(linkitylinkProcess.pid);
```

**Key Features:**
- Service lifecycle tied to wiki server
- Environment variables passed for configuration
- Stdout/stderr piped for logging
- Health checks verify service is running
- **PID file tracking** - Enables cleanup of orphaned processes
- **Startup cleanup** - Kills any orphaned process from previous run
- **Shutdown hooks** - Gracefully terminates service on wiki shutdown
- **Port-based fallback** - Finds and kills process using port if PID file is stale

**Process Lifecycle:**

1. **Startup:**
   - Check for orphaned process (via PID file or port)
   - Kill orphaned process if found
   - Clean up stale PID file
   - Spawn fresh linkitylink instance
   - Write new PID file

2. **Running:**
   - Monitor stdout/stderr
   - Handle process crashes
   - Clean up PID file on unexpected exit

3. **Shutdown:**
   - Receive SIGINT/SIGTERM
   - Send SIGTERM to linkitylink
   - Wait 2 seconds
   - Send SIGKILL if still running
   - Clean up PID file

**Why This Matters:**

Without proper process lifecycle management, child processes become "orphaned" when the wiki restarts. This causes:
- Port conflicts (new instance can't bind to port)
- Resource leaks (old process keeps running)
- Configuration drift (old process has stale config)
- Multiple instances fighting for same port

The PID file + shutdown hooks pattern solves all these issues.

### 3. **Transparent HTTP Proxying**

All requests to `/plugin/linkitylink/*` are proxied to the running service:

```javascript
app.all('/plugin/linkitylink/*', function(req, res) {
  const targetPath = req.url.replace('/plugin/linkitylink', '');
  req.url = targetPath;
  proxy.web(req, res, {
    target: `http://localhost:${LINKITYLINK_PORT}`
  });
});
```

**User Experience:**
- Service appears to be part of the wiki
- No CORS issues
- No additional port management

### 4. **Client-Side Version Management**

The plugin provides a UI for checking and updating the bundled service, inspired by `wiki-plugin-plugmatic`:

**Traffic Light Status Indicator:**
```javascript
// Colors matching plugmatic
const color = {
  gray: '#ccc',
  red: '#f55',    // Service not installed
  yellow: '#fb0', // Update available
  green: '#0e0'   // Up to date
};
```

**Version Check Endpoint:**
```javascript
app.get('/plugin/linkitylink/version-status', async function(req, res) {
  // Check installed version
  const packageData = JSON.parse(fs.readFileSync(
    path.join(LINKITYLINK_PATH, 'package.json'),
    'utf8'
  ));
  const installed = packageData.version;

  // Fetch latest from npm
  const npmResponse = await fetch('https://registry.npmjs.org/linkitylink/latest');
  const published = npmResponse.json().version;

  res.json({ installed, published, updateAvailable: installed !== published });
});
```

**Update Endpoint:**
```javascript
app.post('/plugin/linkitylink/update', function(req, res) {
  // CRITICAL: Install in correct directory
  const installDir = path.join(LINKITYLINK_PATH, '../..');

  exec('npm install linkitylink@latest', { cwd: installDir }, (err, stdout) => {
    if (err) return res.json({ success: false, error: stderr });
    res.json({ success: true, version: newVersion });
  });
});
```

**Important:** The update must run in the parent package's directory (two levels up from the service), not in the plugin directory.

### 5. **Path Resolution Strategy**

Getting paths right is crucial for the pattern to work:

```javascript
// Default path: look in node_modules
const LINKITYLINK_PATH = process.env.LINKITYLINK_PATH ||
  path.join(__dirname, '../../linkitylink');

// When installed via npm:
// __dirname = /path/to/wiki/node_modules/wiki-plugin-linkitylink/server
// LINKITYLINK_PATH = /path/to/wiki/node_modules/linkitylink ✅

// For updates:
const installDir = path.join(LINKITYLINK_PATH, '../..');
// installDir = /path/to/wiki/ ✅
```

### 6. **Configuration Management**

The plugin reads configuration from fedwiki's standard `owner.json`:

```javascript
function loadWikiConfig() {
  const ownerPath = path.join(process.env.HOME || '/root', '.wiki/status/owner.json');
  const ownerData = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));

  return {
    fountURL: ownerData.fountURL || 'https://dev.fount.allyabase.com',
    bdoURL: ownerData.bdoURL || 'https://dev.bdo.allyabase.com',
    addieURL: ownerData.addieURL || 'https://dev.addie.allyabase.com'
  };
}
```

**Fallback Strategy:**
- First check `owner.json` for user configuration
- Fall back to sensible defaults (dev servers)
- Allow `LINKITYLINK_PATH` env var override for development

## File Structure

```
wiki-plugin-linkitylink/
├── client/
│   └── linkitylink.js       # Client-side plugin with version UI
├── server/
│   └── server.js            # Service spawning, proxying, version management
├── index.js                 # Plugin entry point
├── factory.json             # Fedwiki plugin metadata
├── package.json             # Dependencies including service
└── CLAUDE.md                # This file
```

## Implementation Checklist

If you're implementing this pattern for a new plugin:

### Server-Side
- [ ] Add service as npm dependency
- [ ] Implement service spawning with proper error handling
- [ ] **Implement process lifecycle management:**
  - [ ] Create PID file path (unique per port)
  - [ ] Write PID file after spawning
  - [ ] Clean up orphaned processes on startup
  - [ ] Register shutdown hooks (SIGINT, SIGTERM, exit)
  - [ ] Implement graceful shutdown function
  - [ ] Clean up PID file on process exit
  - [ ] Add port-based fallback cleanup
- [ ] Set up HTTP proxy for all service routes
- [ ] Add health check endpoint for service
- [ ] Implement version check endpoint (GET /plugin/{name}/version-status)
- [ ] Implement update endpoint (POST /plugin/{name}/update)
- [ ] Ensure correct path resolution (../../{service})
- [ ] Configure logging for service stdout/stderr
- [ ] Pass configuration via environment variables

### Client-Side
- [ ] Create client plugin with `emit()` and `bind()` functions
- [ ] Implement version status UI with traffic light (◉)
- [ ] Use plugmatic colors (red: #f55, yellow: #fb0, green: #0e0)
- [ ] Add update button when new version available
- [ ] Handle update success/failure with clear messaging
- [ ] Prompt for server restart after update

### Configuration
- [ ] Read from `~/.wiki/status/owner.json`
- [ ] Provide sensible defaults
- [ ] Allow environment variable overrides
- [ ] Document required configuration fields

### Testing
- [ ] Test fresh install via plugmatic
- [ ] Test service spawns correctly
- [ ] Test proxy routes work
- [ ] Test version checking
- [ ] Test update functionality
- [ ] Test with outdated service version
- [ ] Test server restart after update
- [ ] **Test process lifecycle management:**
  - [ ] Test wiki restart kills linkitylink
  - [ ] Test PID file is created on spawn
  - [ ] Test PID file is cleaned up on exit
  - [ ] Test orphaned process cleanup on startup
  - [ ] Test port-based fallback cleanup
  - [ ] Test graceful shutdown (Ctrl+C)
  - [ ] Test hard kill recovery (kill -9)

## Key Learnings

### What Worked Well

1. **npm dependency approach** - Much cleaner than requiring manual service installation
2. **Automatic spawning** - Users don't need to manage service lifecycle
3. **Transparent proxying** - Service feels like part of wiki
4. **Version management UI** - Clear upgrade path without CLI
5. **Health checks** - Fail gracefully if service doesn't start

### Common Pitfalls

1. **Orphaned child processes** - CRITICAL: Without proper lifecycle management, child processes keep running after wiki restart, causing port conflicts. Solution: Use PID files + shutdown hooks (see Process Lifecycle Management above)
2. **Wrong install directory** - Updates must run in wiki root, not plugin directory
3. **Path resolution** - `__dirname` is in server/ subfolder, must go up two levels
4. **Postinstall scripts** - Don't use postinstall for updates (causes crashes)
5. **Service filename** - Must match what spawn() calls (e.g., linkitylink.js not server.js)
6. **Default URLs** - Localhost defaults fail without local services, use dev servers
7. **Shutdown timing** - Don't call `process.exit()` in shutdown handlers; let parent process manage exit

### Performance Considerations

- Service runs continuously (memory overhead)
- Each wiki gets its own service instance (use different ports)
- Proxy adds minimal latency
- Version checks hit npm registry (cache if needed)

## Related Patterns

- **wiki-plugin-plugmatic** - Plugin version management (inspired our version UI)
- **wiki-security-sessionless** - Security plugin pattern (server-side only)
- **wiki-plugin-assets** - Static file serving pattern

## Future Enhancements

Potential improvements to the pattern:

- [ ] Service pooling (share one instance across multiple wikis)
- [ ] Graceful service restart without wiki restart
- [ ] Service status monitoring/metrics
- [ ] Automatic service updates on schedule
- [ ] Service configuration UI (not just version management)

## References

- [Fedwiki Plugin Architecture](https://github.com/fedwiki/wiki)
- [wiki-plugin-plugmatic](https://github.com/fedwiki/wiki-plugin-plugmatic)
- [Linkitylink Service](https://github.com/planet-nine-app/linkitylink)
