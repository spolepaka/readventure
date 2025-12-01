# Readventure

An interactive reading comprehension board game with multiple themes. Currently features a Space theme with dynamic story loading from QTI data.

## 🎯 Features

- ✅ **131 Grade 3 Stories** - Load any article from QTI data
- ✅ **Fully Configurable** - Change everything via `game-config.json`
- ✅ **Dynamic Tile Generation** - Uses 1-16 tiles based on story data
- ✅ **Test Mode UI** - Change config via browser (press ` key)
- ✅ **Multiple Themes** - Space theme (more coming soon!)
- ✅ **Educational Feedback** - Detailed explanations for each answer
- ✅ **Progressive Unlocking** - Sequential tile-based gameplay
- ✅ **No Hardcoded Data** - Everything loaded from QTI data
- ✅ **Multiple Tile Patterns** - Horizontal, vertical, snake, spiral paths
- ✅ **Content Granularity Modes** - Control how content distributes to tiles

## 📁 Project Structure

```
readventure/
├── readventure.html                    # Main game file
├── qti-parser.js                       # Story data parser
├── game-config.json                    # Game configuration
├── README.md                           # This file (start here!)
├── assets/
│   └── space_board_fullhd.webp        # Space theme board image
├── texts/
│   ├── qti_grade_3_data.json          # 131 Grade 3 stories
│   └── article_ids.csv                 # List of available articles
└── docs/
    ├── CONFIG-GUIDE.md                 # Configuration reference
    ├── QTI-PARSER-GUIDE.md            # Parser API reference
    └── ...                             # Additional documentation
```

## 🚀 Quick Start

### 1. Start a Local Server

```bash
python3 -m http.server 8080
```

### 2. Open in Browser

Navigate to: `http://localhost:8080/readventure.html`

### 3. Play!

Click the START tile to begin reading!

### 4. Test Mode (Optional)

Press **`** (backtick) key to open test panel and change stories/settings live!

## 🎮 How to Change Stories

### Method 1: Edit Config File (Easiest)

1. Open `game-config.json`
2. Find `dataSource.startingArticleId`
3. Change to any article ID from `texts/article_ids.csv`
4. Save and refresh browser

**Example:**
```json
{
  "dataSource": {
    "startingArticleId": "article_101004"
  }
}
```

Refresh → Alice in Wonderland loads! ✨

## 📖 Available Stories

See `texts/article_ids.csv` for all 131 Grade 3 articles, including:

**Classic Tales:**
- Aladdin (Parts I, II, III)
- Alice's Adventures in Wonderland (Parts I-IV)
- The Open Road (Parts I-IV)

**Science:**
- Animal Classification
- Human Body Systems
- Light and Sound
- Solar System and Space

**History:**
- Ancient Rome
- American Colonies
- Native American Stories

## ⚙️ Configuration Options

### Content Granularity

Control how content is distributed across tiles:

```json
"contentGranularity": {
  "mode": "one-question-per-tile"
}
```

**Modes:**
- `one-question-per-tile` - Each tile = 1 section + 1 question
- `all-questions-one-tile` - All sections separate, quiz in one tile
- `full-text-per-tile` - Full article per tile

### Themes

```json
{
  "gameName": "Readventure",
  "currentTheme": "space"
}
```

**Available Themes:**
- `space` - Space adventure board (current)
- More themes coming soon!

### Visual Settings

```json
"visualSettings": {
  "lockedTile": {
    "blurAmount": "8px",
    "lockIcon": "🔒"
  }
}
```

See `docs/CONFIG-GUIDE.md` for complete configuration reference.

## 🛠️ Technical Details

### Architecture

```
Config → Parser → Game
  ↓        ↓        ↓
JSON    Extracts  Displays
File    & Converts Content
```

### Key Components:

1. **`qti-parser.js`** - Extracts story data from QTI JSON
2. **`game-config.json`** - Configures game behavior
3. **`readventure.html`** - Game engine

### Data Flow:

1. Load `game-config.json`
2. Get `startingArticleId` from config
3. Use parser to load story from QTI data
4. Convert to game format
5. Initialize game with story
6. Distribute content to tiles based on mode

## 📚 Documentation

- **`docs/CONFIG-GUIDE.md`** - Complete configuration reference
- **`docs/QTI-PARSER-GUIDE.md`** - Parser API and usage examples

## 🎨 Customization

### Change Lock Icon
```json
"visualSettings": {
  "lockedTile": {
    "lockIcon": "⭐",
    "lockIconColor": "#ff00ff"
  }
}
```

### Change Score Messages
```json
"scoringSettings": {
  "scoreMessages": [
    { "minPercentage": 100, "message": "You're amazing! 🌟" }
  ]
}
```

## 🐛 Troubleshooting

### Story Doesn't Load

**Check:**
1. Is `startingArticleId` correct? (Check `texts/article_ids.csv`)
2. Is server running? (`python3 -m http.server 8080`)
3. Check browser console for errors (F12)

### Tiles Don't Align

**Adjust in `game-config.json`:**
```json
"gridAlignment": {
  "width": "62vmin",
  "top": "51.8%",
  "left": "50.4%",
  "gap": "5.4%"
}
```

## 📊 Grade Levels

**Currently Supported:**
- ✅ Grade 3 (131 articles)

**Future Support:**
- ⏳ Grade 4, 5, 6, 7, 8 (available in similar format)

## 📜 License

Educational use.

## 🎓 Version

**Name:** Readventure  
**Version:** 2.1 (Dynamic Loading)  
**Date:** November 2024  
**Target:** Grade 3 Reading Comprehension  

---

**Ready to play?** Run the server and open `readventure.html`! 🚀
