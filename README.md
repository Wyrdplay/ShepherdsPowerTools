# Shepherds Power Tools

A desktop app for DIY project calculations — built with Electron, React, and TypeScript.

![App Screenshot](resources/doors%20page.jpeg)

## Features

### Door Decoration Calculator

Calculate MDF panel sizes and mitred beading cuts for 4-panel door designs.

- **Precise cut lists** — panel dimensions, beading lengths (long-point → short-point for 45° mitres)
- **Live SVG preview** with zoom, pan, and diagnostic overlays
- **Diagnostic overlay** — visualise margins, gaps, beading widths, handle position, unit dimensions, and ratio splits all at once
- **Multi-door support** — manage multiple door configurations side by side
- **Copy PNG** — export the preview as a high-resolution image to clipboard
- **Copy summary** — share cut lists as formatted text
- **Handle collision detection** — warns if the door handle overlaps panel beading
- **Keyboard navigation** — Tab/Shift-Tab through collapsible cards, arrow keys to navigate between sections
- **Persistent state** — all settings saved to localStorage automatically

### Copy PNG Output

![Copy PNG Output](resources/doors%20overlay.jpeg)

### The Real Thing

![Finished Door](resources/door%20real.jpeg)

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- npm

### Install & Run

```bash
# Clone the repo
git clone https://github.com/Wyrdplay/ShepherdsPowerTools.git
cd ShepherdsPowerTools

# Install dependencies
npm install

# Run in development mode
npm run dev
```

### Build a Portable Executable

```bash
# Build the app bundles
npx electron-vite build

# Package as a portable Windows exe
npx electron-builder --win portable --config electron-builder.yml
```

The output will appear in the `dist/` folder.

## Tech Stack

- **Electron** — desktop shell
- **React 18** + **TypeScript** — UI framework
- **Tailwind CSS v4** — styling
- **shadcn/ui** + **Radix UI** — component primitives
- **electron-vite** — build tooling
- **electron-builder** — packaging & distribution

## Project Structure

```
src/
├── main/           # Electron main process
├── preload/        # Preload scripts
└── renderer/
    └── src/
        ├── components/   # Sidebar, UI primitives
        ├── lib/          # Storage, utilities
        └── pages/        # App pages (Door Calculator, etc.)
```

## License

MIT
