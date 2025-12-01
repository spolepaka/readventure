# Themes Guide

How to add and configure visual themes for Readventure.

## Current Theme

**Space Theme** - A space-themed board game with planets and stars.

Files:
- `assets/space_board_fullhd.webp` - Main board image

---

## Theme Configuration

In `game-config.json`:

```json
{
  "gameName": "Readventure",
  "currentTheme": "space"
}
```

---

## Adding a New Theme

### Step 1: Create Board Image

Create a 1920x1080 (or similar HD) image with:
- 4x4 grid of tile positions
- Visual path connecting tiles
- Theme-appropriate background

Save as: `assets/[theme]_board_fullhd.webp`

**Examples:**
- `assets/jungle_board_fullhd.webp`
- `assets/ocean_board_fullhd.webp`
- `assets/castle_board_fullhd.webp`

### Step 2: Update Config

Add theme to config:

```json
{
  "currentTheme": "jungle",
  "themes": {
    "space": {
      "boardImage": "assets/space_board_fullhd.webp",
      "name": "Space Adventure"
    },
    "jungle": {
      "boardImage": "assets/jungle_board_fullhd.webp",
      "name": "Jungle Safari"
    }
  }
}
```

### Step 3: Update HTML (if needed)

In `readventure.html`, update the background image logic:

```javascript
// Current (hardcoded)
background-image: url('assets/space_board_fullhd.webp');

// Future (dynamic)
const theme = GAME_CONFIG.themes[GAME_CONFIG.currentTheme];
document.querySelector('.board').style.backgroundImage = 
  `url('${theme.boardImage}')`;
```

### Step 4: Theme-Specific Styles (Optional)

Add CSS variables for theme colors:

```css
/* Space theme */
[data-theme="space"] {
  --primary-color: #1a1a2e;
  --accent-color: #00d4ff;
  --text-color: #ffffff;
}

/* Jungle theme */
[data-theme="jungle"] {
  --primary-color: #1a3c1a;
  --accent-color: #7cfc00;
  --text-color: #f5f5dc;
}
```

---

## Theme Ideas

| Theme | Description | Color Palette |
|-------|-------------|---------------|
| **Ocean** | Underwater adventure | Blues, teals, coral |
| **Jungle** | Rainforest exploration | Greens, browns, gold |
| **Castle** | Medieval fantasy | Purple, silver, gold |
| **Desert** | Egyptian pyramids | Sand, gold, turquoise |
| **Arctic** | Polar expedition | White, blue, silver |
| **Candy** | Sweet treats land | Pink, pastels, bright |

---

## Board Image Guidelines

### Dimensions
- **Recommended:** 1920x1080 (16:9)
- **Minimum:** 1280x720
- **Format:** WebP (smaller file size)

### Tile Positions
The 4x4 grid should have clear positions for tiles:

```
┌───┬───┬───┬───┐
│ 1 │ 2 │ 3 │ 4 │
├───┼───┼───┼───┤
│ 5 │ 6 │ 7 │ 8 │
├───┼───┼───┼───┤
│ 9 │10 │11 │12 │
├───┼───┼───┼───┤
│13 │14 │15 │16 │
└───┴───┴───┴───┘
```

### Visual Path
Show a path connecting tiles in the pattern defined by `tilePathPattern`:
- Horizontal: 1→2→3→4→5→6...
- Snake: 1→2→3→4→8→7→6→5→9...

### Design Tips
- Leave tile areas slightly lighter/highlighted
- Add decorative elements between tiles
- Include theme-appropriate characters/objects
- Keep text minimal on the board itself

---

## Future: Theme Selector UI

Eventually add a theme selector to the test mode panel:

```html
<select id="theme-select">
  <option value="space">🚀 Space Adventure</option>
  <option value="jungle">🌴 Jungle Safari</option>
  <option value="ocean">🌊 Ocean Explorer</option>
</select>
```

```javascript
document.getElementById('theme-select').addEventListener('change', (e) => {
  GAME_CONFIG.currentTheme = e.target.value;
  applyTheme();
});
```

---

## Assets Folder Structure

```
assets/
├── space_board_fullhd.webp      # Space theme board
├── jungle_board_fullhd.webp     # Jungle theme board (future)
├── ocean_board_fullhd.webp      # Ocean theme board (future)
└── icons/
    ├── lock_space.png           # Theme-specific icons (optional)
    ├── lock_jungle.png
    └── lock_ocean.png
```

