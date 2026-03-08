# MoveServerToTop

A BetterDiscord plugin that adds a **Move Server to Top** action to a server's context menu.

## Features

- Adds a context menu item on guilds: `Move Server to Top`
- Uses BetterDiscord APIs (`BdApi.ContextMenu`, `BdApi.Webpack`, `BdApi.Logger`)
- Includes fallback dependency resolution for client changes
- Verifies move persistence and retries when needed

## Installation

1. Download `MoveServerToTop.plugin.js`.
2. Place it in your BetterDiscord plugins folder:
   - macOS: `~/Library/Application Support/BetterDiscord/plugins`
   - Windows: `%appdata%\\BetterDiscord\\plugins`
   - Linux: `~/.config/BetterDiscord/plugins`
3. Enable **MoveServerToTop** in BetterDiscord's plugin settings.

## Usage

1. Right-click a server icon in the left server list.
2. Click **Move Server to Top**.

## Development

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test -- --run
```

## Repository

- Source: <https://github.com/masonc15/BetterDiscordPlugins>
- Plugin file: <https://raw.githubusercontent.com/masonc15/BetterDiscordPlugins/main/MoveServerToTop.plugin.js>
