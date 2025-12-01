# Game Architecture

Technical overview of how Readventure works.

## High-Level Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  game-config    │────▶│   qti-parser    │────▶│   Game Engine   │
│     .json       │     │      .js        │     │  (HTML + JS)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │
        ▼                       ▼                       ▼
   Settings &              Story Data              Renders UI &
   Preferences            (sections,              Handles Input
                          questions)
```

---

## Files & Responsibilities

### `readventure.html`
**The game engine.** Contains:
- HTML structure (board, modals, overlays)
- CSS styles (grid, animations, themes)
- JavaScript game logic (`SpaceReadingGame` class)
- State management (tiles, progress, score)
- Event handling (clicks, keyboard)

### `game-config.json`
**All settings.** Controls:
- Which story to load
- Content granularity mode
- Visual settings (blur, icons)
- Game flow (linear progression, confetti)
- Debug options (test mode)

### `qti-parser.js`
**Data extraction.** Provides:
- Functions to load QTI JSON
- Article lookup by ID
- Conversion to game format
- Section/question extraction

### `test-mode-ui.js`
**Development helper.** Enables:
- In-browser config changes
- Live story switching
- Settings preview
- Quick testing without file edits

---

## Game States

```
┌─────────┐    click     ┌─────────┐   complete   ┌────────────┐
│  BOARD  │─────────────▶│ READING │─────────────▶│ QUIZ_INTRO │
└─────────┘              └─────────┘              └────────────┘
     ▲                                                   │
     │                                                   ▼
     │                   ┌─────────┐              ┌──────────────┐
     │◀──────────────────│ RESULTS │◀─────────────│QUIZ_QUESTION │
     │   back to board   └─────────┘   all done   └──────────────┘
```

### States:
1. **BOARD** - Viewing the tile board
2. **READING** - Reading a section
3. **QUIZ_INTRO** - "Ready for quiz?" prompt
4. **QUIZ_QUESTION** - Answering a question
5. **RESULTS** - Final score display

---

## Tile System

### Tile Types
- `start` - First tile, always unlocked
- `section` - Reading content tile
- `quiz` - Quiz question tile

### Tile States
- `locked` - Can't click, blurred
- `unlocked` - Can click, highlighted
- `completed` - Done, shows checkmark

### Dynamic Tile Generation

Tiles are generated based on content mode:

```javascript
// one-question-per-tile mode
generateTilesForOneQuestionMode() {
  // Creates: section1, quiz1, section2, quiz2, ...
}

// all-questions-one-tile mode
generateTilesForAllQuestionsMode() {
  // Creates: section1, section2, ..., quiz-all
}

// full-text-per-tile mode
generateTilesForFullTextMode() {
  // Creates: full-article (1 tile per story)
}
```

---

## Data Flow

### Startup
```
1. Load game-config.json
2. Get startingArticleId
3. Load QTI data via parser
4. Calculate articles needed (auto-fill)
5. Generate tiles based on mode
6. Initialize game with tiles
7. Render board
```

### Tile Click
```
1. Check if tile unlocked
2. Load content for tile type
3. Show reading/quiz modal
4. On complete: mark done, unlock next
```

### Quiz Flow
```
1. Show question
2. User selects answer
3. Check correctness
4. Show explanation
5. Update score
6. Next question or results
```

---

## CSS Architecture

### Grid System
```css
.game-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-template-rows: repeat(4, 1fr);
}
```

### Theme Variables
```css
:root {
  --locked-blur: 8px;
  --lock-icon-color: #ffffff;
  --tile-hover-scale: 1.05;
}
```

### Responsive Design
- Uses `vmin` for board sizing
- Percentage-based positioning
- Works on tablets and desktops

---

## Key Classes & Functions

### `SpaceReadingGame`
Main game controller class.

```javascript
class SpaceReadingGame {
  constructor(config, storyData)
  init()
  createTileHotspots()
  handleTileClick(tileIndex)
  loadSection(sectionIndex)
  loadQuizIntro()
  nextQuizQuestion()
  checkAnswer(selectedIndex)
  showResults()
}
```

### `loadStoryDataFromQTI(config)`
Loads and combines story data.

```javascript
async function loadStoryDataFromQTI(config) {
  // 1. Calculate how many articles needed
  // 2. Load articles sequentially
  // 3. Combine sections and questions
  // 4. Return combined story data
}
```

### `generateActiveTiles()`
Creates tile configuration based on mode.

```javascript
generateActiveTiles() {
  switch(mode) {
    case 'one-question-per-tile': ...
    case 'all-questions-one-tile': ...
    case 'full-text-per-tile': ...
  }
}
```

---

## Adding New Features

### New Content Mode
1. Add mode to `game-config.json` schema
2. Create `generateTilesFor[Mode]Mode()` function
3. Add case to `generateActiveTiles()` switch
4. Update test mode UI dropdown

### New Theme
1. Add theme board image to `assets/`
2. Update `currentTheme` in config
3. Add theme-specific CSS if needed
4. Update background image path logic

### New Tile Type
1. Define type in tile generation
2. Add handler in `handleTileClick()`
3. Create UI for new content type
4. Update tile rendering logic

