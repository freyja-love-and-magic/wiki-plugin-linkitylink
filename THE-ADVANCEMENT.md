# The Advancement

## Vision

**The Advancement** is a project to rebuild known platforms and offer them at lower cost to community members. Rather than relying on centralized, surveillance-based platforms, communities can operate their own federated wiki instances and manage their own deployments.

## Core Principles

### 1. Community Ownership
- Communities operate their own federated wiki instances
- Each community manages their own deployments
- Full control over data and services

### 2. Optional Federation
- Wikis **can** federate with each other
- Federation is **optional**, not required
- Communities decide their own connectivity

### 3. Affordable Alternatives
- Rebuild known platforms at lower cost
- Remove surveillance and tracking
- Offer to community members, not extract from them

### 4. Self-Contained Services
- Each service runs independently
- Services can be installed via wiki plugin system
- No complex infrastructure required

## The Advancement Service Catalog

### Current Services

#### 1. **Linkitylink** (wiki-plugin-linkitylink)
**Replaces**: Linktree, Beacons, Link-in-bio services
**Cost**: $4.99 one-time (vs $10+/month)
**Features**:
- Privacy-first link pages
- Beautiful SVG templates
- Shareable via emojicodes
- No tracking, no surveillance
- Self-hosted on community wiki

#### 2. **Allyabase** (wiki-plugin-allyabase)
**Purpose**: Development platform for building other services
**Features**:
- Backend infrastructure (BDO, Fount, Addie)
- API access for community developers
- Build custom services on community infrastructure

### Planned Services

#### 3. **Mutopia** (wiki-plugin-mutopia) 🎵
**Replaces**: Spotify, SoundCloud, Bandcamp
**Status**: MVP Complete
**Features**:
- Canimus feed support
- Community music hosting
- Sanora storage + Dolores playback
- Artist royalties (100%, no platform cut)
- Federation-ready
- No platform fees

#### 4. **Books Platform**
**Replaces**: Amazon Kindle, Medium
**Features**:
- Self-publishing
- Community libraries
- Author royalties
- DRM-free

#### 5. **Blog Platform**
**Replaces**: Substack, WordPress hosting
**Features**:
- Community-hosted blogs
- RSS/federation
- No platform lock-in
- Subscriber management

#### 6. **[Additional Services]**
- Calendar/scheduling
- Document collaboration
- Media galleries
- Community forums
- And more...

## Technical Architecture

### Wiki as Distribution Platform

Federated wiki serves as the **distribution and hosting platform** for all services:

1. **Installation**: One-click via plugmatic (wiki's plugin manager)
2. **Updates**: Version management UI with traffic light indicators
3. **Hosting**: Each wiki runs its own service instances
4. **Forking**: Fork a wiki page → get independent service instance

### Service-Bundling Plugin Pattern

All services follow the **Service-Bundling Plugin Pattern** (documented in `CLAUDE.md`):

```
npm package (wiki-plugin-{service})
├── Service as npm dependency
├── Server-side spawning & lifecycle management
├── HTTP proxy (transparent integration)
├── Client-side version management UI
└── Zero-configuration deployment
```

**Benefits**:
- ✅ No manual installation or configuration
- ✅ Automatic service management
- ✅ One-click updates
- ✅ True forking (each wiki = independent instance)
- ✅ Works across all PLACEs (Web, Secure Web, World Wide MUD)

### Port Allocation

Wiki plugin servers use **6000 range** for organization:

- **6010**: linkitylink
- **6020**: allyabase (planned)
- **6030**: music (planned)
- **6040**: books (planned)
- **6050**: blogs (planned)
- **6060-6099**: Additional services

### PLACE-Agnostic Design

Services are designed to work across multiple PLACEs:

1. **The Web** (HTTP) - Traditional browser access
2. **The Secure Web** (HTTPS) - Encrypted access
3. **The World Wide MUD** (httpc) - Cookieless, privacy-first (Roam browser)

**Implementation**:
- SVG-based UIs (self-contained, no external CSS)
- JavaScript for interactivity on Web/Secure Web
- Pure SVG rendering for Roam (future)

## Community Model

### How Communities Use The Advancement

1. **Deploy a wiki**: Community sets up their federated wiki instance
2. **Install services**: Use plugmatic to install desired services
3. **Manage independently**: Community controls their own infrastructure
4. **Optional federation**: Connect with other communities or stay independent

### Example Community Setup

**"The Oak Community"** wiki instance:
```
https://oak-community.wiki/

Installed services:
- linkitylink (link pages for members)
- allyabase (development platform)
- music (community artist hosting)
- books (community library)
- blogs (member blogs)
```

### Federation Example

**Optional connection**:
```
Oak Community Wiki ←→ Pine Community Wiki
                ↓
         Maple Community Wiki
```

Communities can:
- Share pages via federation
- Reference each other's services
- Or operate completely independently

## Economic Model

### Pricing Philosophy

**Traditional Platforms** (monthly subscriptions):
- Linktree: $10/month → $120/year
- Substack: 10% of revenue
- Spotify: $10/month for listeners, pennies for artists
- Amazon KDP: 30-65% commission

**The Advancement** (one-time purchases or community hosting):
- Linkitylink: $4.99 one-time
- Music/Books/Blogs: Community-hosted (minimal cost)
- No recurring platform fees
- Creators keep their revenue

### Revenue Model

Services can use:
1. **One-time purchase** (like linkitylink $4.99)
2. **Magic spells** (600 MP for templates, etc.)
3. **Community funding** (wiki operators cover hosting)
4. **Voluntary support** (tip jars, patronage)

### Creator Economics

**For creators using The Advancement services**:
- Keep full revenue (minus payment processing ~3%)
- No platform cut (0% vs traditional 10-30%)
- Own their content and audience
- Portable across communities (federated identity)

## Development Roadmap

### Phase 1: Foundation ✅
- ✅ Linkitylink (link pages)
- ✅ Service-Bundling Plugin Pattern
- ✅ Process lifecycle management
- ✅ SVG-based UI (PLACE-agnostic)
- ✅ Port standardization (6000 range)

### Phase 2: Development Platform
- 🔲 Allyabase plugin (BDO/Fount/Addie access)
- 🔲 Developer documentation
- 🔲 Community developer tools

### Phase 3: Content Platforms
- 🔲 Music platform plugin
- 🔲 Books platform plugin
- 🔲 Blog platform plugin
- 🔲 Media gallery plugin

### Phase 4: Collaboration Tools
- 🔲 Calendar/scheduling
- 🔲 Document collaboration
- 🔲 Community forums
- 🔲 Project management

### Phase 5: Federation Features
- 🔲 Cross-wiki authentication
- 🔲 Federated identity
- 🔲 Shared services (optional)
- 🔲 Community discovery

## For Developers

### Building Services for The Advancement

To create a new service plugin:

1. **Read the pattern**: `wiki-plugin-linkitylink/CLAUDE.md`
2. **Choose a port**: Next available in 6000 range
3. **Build the service**: Standalone Node.js server
4. **Create the plugin**: Follow Service-Bundling pattern
5. **Test locally**: With LINKITYLINK_PATH approach
6. **Publish**: To npm for distribution

### Key Requirements

All Advancement services should:
- ✅ Work without cookies (httpc compatible)
- ✅ Use SVG for UI (PLACE-agnostic)
- ✅ Support process lifecycle management
- ✅ Include version management UI
- ✅ Be privacy-first (no tracking)
- ✅ Be affordable (community-accessible)

### Example Service Structure

```
wiki-plugin-{service}/
├── client/
│   └── {service}.js          # Client-side plugin + version UI
├── server/
│   └── server.js             # Service spawning & proxying
├── package.json              # Service as dependency
├── README.md                 # User documentation
├── CLAUDE.md                 # Developer documentation
└── THE-ADVANCEMENT.md        # This vision (copy)
```

## Values

The Advancement is built on these values:

1. **Privacy**: No surveillance, no tracking, no data extraction
2. **Community**: Operated by communities, for communities
3. **Affordability**: Lower cost than extractive platforms
4. **Ownership**: Communities and creators own their infrastructure
5. **Federation**: Optional connection, not mandatory centralization
6. **Openness**: Open source, open protocols, open to all
7. **Sustainability**: Fair pricing, fair creator economics

## Why Federated Wiki?

Federated wiki is the perfect foundation because:

- **Already federated**: Built for optional federation
- **Plugin system**: Easy to extend with new services
- **Community-friendly**: Designed for community knowledge sharing
- **Forking**: Natural model for service independence
- **Lightweight**: Runs on minimal infrastructure
- **Proven**: Years of development and deployment

## The Future

The Advancement represents a shift from:

- **Platform extraction** → **Community ownership**
- **Surveillance capitalism** → **Privacy-first design**
- **Vendor lock-in** → **Service portability**
- **Recurring subscriptions** → **Affordable one-time purchases**
- **Centralized control** → **Federated independence**

### Long-term Vision

Communities running their own infrastructure:
- **Social**: Community wikis, forums, messaging
- **Content**: Books, music, blogs, media
- **Tools**: Documents, calendars, project management
- **Commerce**: Creator marketplaces, community stores
- **Identity**: Federated identity across communities

All built on the foundation of federated wiki, all following the patterns established by The Advancement.

## Get Involved

### For Communities
- Deploy your own wiki
- Install Advancement services
- Manage your own infrastructure
- Federate with other communities (optional)

### For Developers
- Build new services
- Follow the Service-Bundling pattern
- Contribute to existing services
- Help document and improve

### For Creators
- Use Advancement platforms
- Keep your revenue
- Own your audience
- Port across communities

---

**The Advancement**: Rebuilding platforms for communities, not corporations.

**Built with ❤️ by Planet Nine**
