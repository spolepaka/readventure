# QTI Parser Guide

Reference for `qti-parser.js` - the module that extracts story data from QTI JSON files.

## Overview

The QTI parser converts raw QTI (Question and Test Interoperability) data into the game's internal story format. It handles:

- Loading QTI JSON files
- Finding articles by ID
- Extracting sections (reading passages)
- Extracting quiz questions with choices
- Converting to game-ready format

---

## Available Functions

### `loadQTIData(path)`

Loads the QTI JSON file.

```javascript
const qtiData = await loadQTIData('texts/qti_grade_3_data.json');
```

**Returns:** Full QTI data object

---

### `getAvailableArticles(qtiData)`

Gets list of all available articles.

```javascript
const articles = getAvailableArticles(qtiData);
// Returns: [{ id: "article_101001", title: "Aladdin Part I" }, ...]
```

**Returns:** Array of `{ id, title }` objects

---

### `findArticleById(qtiData, articleId)`

Finds a specific article by ID.

```javascript
const article = findArticleById(qtiData, 'article_101001');
```

**Returns:** Raw article object or `null`

---

### `parseQTIToStoryData(article)`

Converts a raw QTI article to game format.

```javascript
const storyData = parseQTIToStoryData(article);
```

**Returns:**
```javascript
{
  title: "Aladdin Part I",
  sections: [
    { title: "Section 1", content: "...", guidingQuestion: "..." },
    // ...
  ],
  quizQuestions: [
    {
      question: "What happened...?",
      choices: ["A", "B", "C", "D"],
      correctIndex: 0,
      explanation: "..."
    },
    // ...
  ]
}
```

---

### `loadStoryByArticleId(qtiDataPath, articleId)`

Convenience function: loads QTI file and extracts specific article.

```javascript
const storyData = await loadStoryByArticleId(
  'texts/qti_grade_3_data.json',
  'article_101001'
);
```

**Returns:** Game-ready story data object

---

## Story Data Format

The game expects this format:

```javascript
{
  title: string,           // Story title
  sections: [              // Reading passages
    {
      title: string,       // Section title
      content: string,     // HTML content
      guidingQuestion: string  // Question to think about
    }
  ],
  quizQuestions: [         // Quiz questions
    {
      question: string,    // Question text
      choices: string[],   // Answer options (4 choices)
      correctIndex: number, // Index of correct answer (0-3)
      explanation: string  // Why this answer is correct
    }
  ]
}
```

---

## QTI Data Structure

The raw QTI JSON has this structure:

```javascript
{
  "grade_3": {
    "articles": {
      "article_101001": {
        "article_id": "article_101001",
        "title": "Aladdin Part I",
        "html_content": "<p>Once upon a time...</p>",
        "sections": [
          {
            "section_number": 1,
            "title": "Section 1",
            "html_content": "...",
            "guiding_question": "What do you think...?"
          }
        ],
        "final_quiz": {
          "questions": [
            {
              "question_number": 1,
              "question_text": "What happened...?",
              "choices": [
                { "letter": "A", "text": "..." },
                { "letter": "B", "text": "..." },
                { "letter": "C", "text": "..." },
                { "letter": "D", "text": "..." }
              ],
              "correct_answer": "A",
              "explanation": "..."
            }
          ]
        }
      }
    }
  }
}
```

---

## Adding New Grade Levels

To add Grade 4 stories:

1. Create `texts/qti_grade_4_data.json` with same structure
2. Update config:
   ```json
   "dataSource": {
     "qtiDataPath": "texts/qti_grade_4_data.json"
   }
   ```
3. The parser will work automatically

---

## Usage in Game

The game uses the parser like this:

```javascript
// In readventure.html
const storyData = await loadStoryByArticleId(
  GAME_CONFIG.dataSource.qtiDataPath,
  GAME_CONFIG.dataSource.startingArticleId
);

// storyData is now ready for the game
game = new SpaceReadingGame(GAME_CONFIG, storyData);
```

---

## Error Handling

The parser includes error handling:

```javascript
try {
  const story = await loadStoryByArticleId(path, id);
} catch (error) {
  console.error('Failed to load story:', error);
  // Use fallback or show error to user
}
```

Common errors:
- Article ID not found
- Invalid QTI format
- Network/file loading error

