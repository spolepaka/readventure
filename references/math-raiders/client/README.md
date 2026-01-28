# Vite + React + TypeScript + Playcademy Template

This template provides a starting point for building web-native games for the Playcademy platform using Vite, React, and TypeScript.

## Features

- A standard Vite React TypeScript setup.
- Pre-configured `@playcademy/sdk` integration with simplified initialization.
- Automatic `playcademy.manifest.json` generation using `@playcademy/vite-plugin`.
- Automatic development environment for local development with real API simulation.
- Example React component structure (`src/App.tsx`, `src/components/*`) showing initialization status and an exit button.

## Getting Started

### Using `tiged` (Recommended)

```bash
# Replace my-cademy-game with your desired project name
bunx tiged superbuilders/playcademy-vite-template-react my-playcademy-game
cd my-cademy-game
```

Install dependencies:

```bash
bun install
```

```bash
pnpm install
```

```bash
npm install
```

## Development

Run the development server:

```bash
bun dev
```

```bash
pnpm dev
```

```bash
npm run dev
```

The `@playcademy/vite-plugin` automatically provides a **development environment** that simulates the Playcademy platform:

- **Full Platform Simulation:** Your game runs in the same environment as production, complete with user authentication, inventory system, and all Playcademy APIs.

- **Fully Functional APIs:** SDK calls like `client.users.me()`, `client.inventory.get()`, and `client.games.saveState()` work exactly like production - no mocking required.

- **Automatic Setup:** The plugin handles all the complexity - just run `bun dev` and start building your game.

- **Hot Reload:** Changes to your game code are instantly reflected, just like standard Vite development.

## SDK Access & Game Logic

- The SDK is initialized within the main `<App>` component (`src/App.tsx`) using `PlaycademyClient.init()`.
- The initialized `PlaycademyClient` instance is stored in the `client` state variable within `<App>`.
- Once initialization is successful (`initStatus === 'success'`), the `client` instance is passed down to the `<GameArea>` component (`src/components/GameArea.tsx`).
- **Start implementing your game logic within the `<GameArea>` component.** You have access to the `client` prop there to make SDK calls.

### Example SDK Usage

```typescript
// Get user data
const user = await client.users.me()

// Update progress
await client.games.saveState({ level: 5, score: 1000 })

// Access inventory
const inventory = await client.users.inventory.get()
```

See the example `client.users.me()` call in `<GameArea>` and the `<ExitButton>` component (`src/components/Controls.tsx`) for usage patterns.

## Building for Playcademy

Build the production-ready assets:

```bash
bun run build
```

```bash
pnpm build
```

```bash
npm run build
```

This command will:

1. Run Vite's build process, outputting optimized files to the `dist/` directory.
2. Trigger the `@playcademy/vite-plugin`, which will generate the `playcademy.manifest.json` file inside `dist/`. Ensure you have configured the plugin options (like `bootMode`, `entryPoint`) in `vite.config.ts` as needed for your game.

The `dist/` directory will contain all the necessary files for your game. **You must create a zip file from the contents of this `dist/` directory** and upload that zip file to the Playcademy platform when creating or updating your game.

For more details on the build and upload process, please refer to the [Playcademy Documentation](https://docs.playcademy.net).

## Customization

- **Game Logic**: Implement your core game logic primarily within `src/components/GameArea.tsx` and potentially other components you create.
- **Component Structure**: Modify or add React components in `src/components/`. Update `src/App.tsx` to integrate them.
- **SDK Integration**: The SDK is initialized directly in `src/App.tsx` - no separate files needed.
- **Styling**: Adjust global styles in `src/index.css` and component-specific styles (like `src/rainbow-status.css`) as needed.
- **HTML Structure**: The base HTML is in `index.html`.
- **Vite Configuration**: Add plugins or adjust build settings in `vite.config.ts`.
