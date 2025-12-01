# Configuration Guide

Complete reference for `game-config.json` options.

## Overview

All game settings are controlled via `game-config.json`. The game loads this file on startup and applies all settings dynamically.

---

## Configuration Structure

```json
{
  "gameName": "Readventure",
  "currentTheme": "space",
  "dataSource": { ... },
  "contentGranularity": { ... },
  "tileLayout": { ... },
  "visualSettings": { ... },
  "gameFlow": { ... },
  "scoringSettings": { ... },
  "debug": { ... }
}
```

---

## Data Source

Controls which stories are loaded.

```json
"dataSource": {
  "type": "external",
  "qtiDataPath": "texts/qti_grade_3_data.json",
  "startingArticleId": "article_101001",
  "autoLoadMode": "fill-grid",
  "maxArticles": 16
}
```

| Option | Type | Description |
|--------|------|-------------|
| `type` | string | `"external"` = load from QTI file |
| `qtiDataPath` | string | Path to QTI JSON data file |
| `startingArticleId` | string | First article to load (from `article_ids.csv`) |
| `autoLoadMode` | string | `"fill-grid"` = auto-load articles to fill 16 tiles |
| `maxArticles` | number | Maximum articles to load (prevents loading all 131) |

### Auto-Load Modes

- **`fill-grid`** - Automatically loads sequential articles until all 16 tiles are filled
- **`manual`** - Only loads the starting article

---

## Content Granularity

Controls how content is distributed across tiles.

```json
"contentGranularity": {
  "mode": "one-question-per-tile"
}
```

| Mode | Description | Tiles per Article |
|------|-------------|-------------------|
| `one-question-per-tile` | Each tile = 1 section + 1 quiz question | ~8 tiles |
| `all-questions-one-tile` | Sections separate, all quiz in one tile | ~5 tiles |
| `full-text-per-tile` | Entire article in one tile | 1 tile |

---

## Tile Layout

Controls the game board grid.

```json
"tileLayout": {
  "gridSize": {
    "rows": 4,
    "columns": 4
  },
  "tilePathPattern": "horizontal"
}
```

| Option | Type | Description |
|--------|------|-------------|
| `gridSize.rows` | number | Number of rows (default: 4) |
| `gridSize.columns` | number | Number of columns (default: 4) |
| `tilePathPattern` | string | Path pattern for tile progression |

### Tile Path Patterns

- **`horizontal`** - Left to right, row by row
- **`vertical`** - Top to bottom, column by column
- **`snake`** - Alternating direction each row
- **`spiral`** - Clockwise spiral from outside in

---

## Visual Settings

Controls appearance of tiles.

```json
"visualSettings": {
  "lockedTile": {
    "blurAmount": "8px",
    "showLockIcon": true,
    "lockIcon": "🔒",
    "lockIconColor": "#ffffff",
    "lockIconSize": "1.5rem"
  },
  "unlockedTile": {
    "showCheckmark": true,
    "checkmarkIcon": "✓"
  },
  "completedTile": {
    "showCheckmark": true,
    "checkmarkColor": "#00ff00"
  }
}
```

---

## Game Flow

Controls gameplay behavior.

```json
"gameFlow": {
  "linearProgression": true,
  "showConfetti": true,
  "autoAdvance": false,
  "autoAdvanceDelay": 2000
}
```

| Option | Type | Description |
|--------|------|-------------|
| `linearProgression` | boolean | Must complete tiles in order |
| `showConfetti` | boolean | Show confetti on game completion |
| `autoAdvance` | boolean | Auto-advance after correct answer |
| `autoAdvanceDelay` | number | Delay before auto-advance (ms) |

---

## Scoring Settings

Controls score calculation and feedback.

```json
"scoringSettings": {
  "pointsPerCorrect": 10,
  "pointsPerIncorrect": 0,
  "showExplanations": true,
  "scoreMessages": [
    { "minPercentage": 100, "message": "Perfect! You're a reading star! ⭐" },
    { "minPercentage": 80, "message": "Great job! Keep it up! 🎉" },
    { "minPercentage": 60, "message": "Good effort! Try again! 📚" },
    { "minPercentage": 0, "message": "Keep practicing! You'll get it! 💪" }
  ]
}
```

---

## Debug Settings

Controls development/testing features.

```json
"debug": {
  "testMode": true,
  "testModeHotkey": "`",
  "showTileNumbers": false,
  "logDataLoading": true
}
```

| Option | Type | Description |
|--------|------|-------------|
| `testMode` | boolean | Enable test mode UI |
| `testModeHotkey` | string | Key to toggle test panel (default: backtick) |
| `showTileNumbers` | boolean | Show tile indices for debugging |
| `logDataLoading` | boolean | Log data loading to console |

---

## Grid Alignment

Fine-tune tile positioning over background image.

```json
"gridAlignment": {
  "width": "62vmin",
  "top": "51.8%",
  "left": "50.4%",
  "gap": "5.4%"
}
```

Adjust these values if tiles don't align with the board image.

---

## Example: Change to Alice in Wonderland

```json
{
  "dataSource": {
    "startingArticleId": "article_101004"
  }
}
```

Save and refresh → Alice in Wonderland loads!

---

## Example: Full-Text Mode with Multiple Stories

```json
{
  "dataSource": {
    "startingArticleId": "article_101001",
    "autoLoadMode": "fill-grid",
    "maxArticles": 16
  },
  "contentGranularity": {
    "mode": "full-text-per-tile"
  }
}
```

This loads 16 different articles, one per tile.

