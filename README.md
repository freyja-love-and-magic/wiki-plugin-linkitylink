# wiki-plugin-linkitylink

> **🎉 This is the code for wiki-based federated distribution of software apps.**
>
> This plugin demonstrates a complete pattern for distributing and running software applications through Federated Wiki, enabling true peer-to-peer app distribution with automatic updates, version management, and zero-configuration deployment.

Federated Wiki plugin that integrates Linkitylink - a privacy-first link page service.

## What This Plugin Does

This plugin integrates Linkitylink with Federated Wiki by:
- **Launching a dedicated linkitylink instance** for each wiki
- **Auto-configuring** that instance with the wiki's base URLs
- **Proxying requests** between wiki and linkitylink
- **Managing the lifecycle** of the linkitylink service

Each wiki gets its own linkitylink instance, enabling true forking and independent operation.

## Wiki-Based Federated Distribution

This plugin implements the **Service-Bundling Plugin Pattern**, which enables:

- ✅ **One-Click Installation** - Install apps via plugmatic (fedwiki's plugin manager)
- ✅ **Automatic Service Management** - Apps spawn and manage themselves
- ✅ **Built-In Version Management** - Traffic light indicators show update status
- ✅ **One-Click Updates** - Users can update apps without touching the command line
- ✅ **True Forking** - Fork a wiki page, get an independent instance of the app
- ✅ **Zero Configuration** - Works out of the box with sensible defaults

**For developers:** See [CLAUDE.md](./CLAUDE.md) for the complete Service-Bundling Plugin Pattern documentation. This pattern is reusable for any fedwiki plugin that needs to integrate an external service or application.

## Installation

### Via Plugmatic (Recommended)

1. Open your Federated Wiki
2. Add a `plugmatic` item to any page
3. Add `linkitylink` to the plugin list
4. Click the status indicator to install
5. Done! Linkitylink is now available at `/plugin/linkitylink/`

### Via npm

### 1. Install the plugin

```bash
# In your wiki's node_modules directory
cd /path/to/wiki/node_modules
git clone https://github.com/planet-nine-app/wiki-plugin-linkitylink.git
cd wiki-plugin-linkitylink
npm install
```

### 2. Install linkitylink

```bash
# Clone linkitylink where the plugin can find it
cd /path/to/planet-nine
git clone https://github.com/planet-nine-app/linkitylink.git
cd linkitylink
npm install
```

### 3. Use in your wiki

Create a page with a linkitylink item to trigger plugin loading. The plugin will automatically:
- Launch its own linkitylink instance
- Configure it with your wiki's base URLs
- Start proxying requests

```json
{
  "type": "linkitylink",
  "id": "unique-id",
  "text": "My Link Page"
}
```

## Routes

All routes are proxied from the wiki to the Linkitylink service:

- `/plugin/linkitylink/` → Linkitylink homepage
- `/plugin/linkitylink/create` → Create link page
- `/plugin/linkitylink/view/:emojicode` → View link page by emojicode
- `/plugin/linkitylink/t/:alphanumeric` → View link page by alphanumeric ID

## Configuration

### Environment Variables

**Required for multiple wikis on same machine:**

```bash
# Wiki 1
export LINKITYLINK_PORT=6010
export LINKITYLINK_PATH=/path/to/linkitylink
wiki --port 3000

# Wiki 2 (different terminal)
export LINKITYLINK_PORT=6011
export LINKITYLINK_PATH=/path/to/linkitylink-copy
wiki --port 3001
```

**Variables:**
- `LINKITYLINK_PORT` - Port for this wiki's linkitylink instance (default: 6010)
- `LINKITYLINK_PATH` - Path to linkitylink installation (default: `../../linkitylink` relative to plugin)
- `ENABLE_APP_PURCHASE` - Show "Buy in App" button (default: false, set to `true` to enable)

### Base URLs (owner.json)

The plugin automatically configures linkitylink with base URLs from `~/.wiki/status/owner.json`:

```json
{
  "fountURL": "http://localhost:3006",
  "bdoURL": "http://localhost:3003",
  "addieURL": "http://localhost:3005"
}
```

**For wiki federation, each wiki's owner.json should point to its own base:**

```json
// Wiki A's owner.json
{
  "fountURL": "http://base-a.example.com/plugin/allyabase/fount",
  "bdoURL": "http://base-a.example.com/plugin/allyabase/bdo",
  "addieURL": "http://base-a.example.com/plugin/allyabase/addie"
}

// Wiki B's owner.json
{
  "fountURL": "http://base-b.example.com/plugin/allyabase/fount",
  "bdoURL": "http://base-b.example.com/plugin/allyabase/bdo",
  "addieURL": "http://base-b.example.com/plugin/allyabase/addie"
}
```

## How It Works

### Plugin Startup Flow

1. **Plugin loads** when wiki page uses linkitylink type
2. **Reads configuration** from `~/.wiki/status/owner.json`
3. **Checks for running linkitylink** on configured port
4. **If not running:**
   - Spawns linkitylink as child process
   - Sets environment variables (PORT, FOUNT_BASE_URL, BDO_BASE_URL, ADDIE_BASE_URL)
   - Waits for startup (3 seconds)
5. **If already running:**
   - Sends configuration update via `POST /config`
6. **Creates proxy** for all `/plugin/linkitylink/*` routes

### Request Flow

1. User visits `http://your-wiki.com/plugin/linkitylink/view/🔗💎...`
2. Plugin strips `/plugin/linkitylink` prefix
3. Proxies to `http://localhost:{LINKITYLINK_PORT}/view/🔗💎...`
4. Linkitylink fetches data from configured base URLs
5. Returns beautiful SVG page to wiki

### Architecture Benefits

- **Independent Instances** - Each wiki runs its own linkitylink
- **Isolated Bases** - Wiki A connects to Base A, Wiki B connects to Base B
- **True Forking** - Fork a wiki page, get independent linkitylink data
- **Process Management** - Plugin manages linkitylink lifecycle
- **Automatic Configuration** - No manual setup required

## Dependencies

- `http-proxy`: ^1.18.1 - For proxying requests to Linkitylink service
- `node-fetch`: ^2.6.1 - For configuring linkitylink via HTTP

## License

MIT
