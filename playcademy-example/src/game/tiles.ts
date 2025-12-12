/**
 * Tile Generation and Management
 */

import type { 
  GameConfig, 
  StoryData, 
  ActiveTile, 
  TilePosition 
} from '../types';

/**
 * Generate tile positions based on pattern
 */
export function generateTilePositions(
  numTiles: number, 
  pattern: string, 
  gridSize: { rows: number; columns: number }
): TilePosition[] {
  const positions: TilePosition[] = [];
  const { rows, columns } = gridSize;

  switch (pattern) {
    case 'linear-horizontal':
      for (let i = 0; i < numTiles && i < rows * columns; i++) {
        positions.push({
          row: Math.floor(i / columns),
          col: i % columns,
          gridIndex: i
        });
      }
      break;

    case 'linear-vertical':
      for (let i = 0; i < numTiles && i < rows * columns; i++) {
        positions.push({
          row: i % rows,
          col: Math.floor(i / rows),
          gridIndex: (i % rows) * columns + Math.floor(i / rows)
        });
      }
      break;

    case 'snake':
      let index = 0;
      for (let row = 0; row < rows && index < numTiles; row++) {
        const isEvenRow = row % 2 === 0;
        for (let col = 0; col < columns && index < numTiles; col++) {
          const actualCol = isEvenRow ? col : (columns - 1 - col);
          positions.push({
            row,
            col: actualCol,
            gridIndex: row * columns + actualCol
          });
          index++;
        }
      }
      break;

    case 'spiral':
      // Spiral from outside to center
      const visited = new Set<string>();
      let r = 0, c = 0;
      let dr = 0, dc = 1; // Start moving right
      
      for (let i = 0; i < numTiles && i < rows * columns; i++) {
        positions.push({
          row: r,
          col: c,
          gridIndex: r * columns + c
        });
        visited.add(`${r},${c}`);
        
        // Check if we need to turn
        const nextR = r + dr;
        const nextC = c + dc;
        if (
          nextR < 0 || nextR >= rows || 
          nextC < 0 || nextC >= columns || 
          visited.has(`${nextR},${nextC}`)
        ) {
          // Turn right (clockwise)
          [dr, dc] = [dc, -dr];
        }
        r += dr;
        c += dc;
      }
      break;

    default:
      // Default to linear-horizontal
      for (let i = 0; i < numTiles && i < rows * columns; i++) {
        positions.push({
          row: Math.floor(i / columns),
          col: i % columns,
          gridIndex: i
        });
      }
  }

  return positions;
}

/**
 * Generate active tiles based on content mode
 */
export function generateActiveTiles(
  config: GameConfig, 
  storyData: StoryData
): ActiveTile[] {
  const mode = config.contentGranularity.mode;
  const pattern = config.tileLayout.tilePathPattern || 'linear-horizontal';
  
  switch (mode) {
    case 'one-section-per-tile':
    case 'one-question-per-tile': // legacy name
      return generateTilesForOneQuestionMode(config, storyData, pattern);
    case 'one-article-per-tile':
    case 'all-questions-one-tile': // legacy name
      return generateTilesForAllQuestionsMode(config, storyData, pattern);
    case 'full-text-per-tile':
      return generateTilesForFullTextMode(config, storyData, pattern);
    default:
      // Default: one article per tile (reading + quiz tiles per article)
      return generateTilesForAllQuestionsMode(config, storyData, pattern);
  }
}

function generateTilesForOneQuestionMode(
  config: GameConfig, 
  storyData: StoryData, 
  pattern: string
): ActiveTile[] {
  const tiles: ActiveTile[] = [];

  if (storyData.articles) {
    // Multi-article mode
    storyData.articles.forEach((article, articleIndex) => {
      // Add section tiles
      article.sections.forEach((section, sectionIndex) => {
        const globalSectionIndex = storyData.sections.findIndex(s => 
          s.articleIndex === articleIndex && s.id === section.id
        );
        tiles.push({
          type: 'section',
          sectionIndex: globalSectionIndex >= 0 ? globalSectionIndex : sectionIndex,
          articleIndex,
          label: `${article.title} - Section ${sectionIndex + 1}`,
          row: 0,
          col: 0,
          gridIndex: 0
        });
      });

      // Add quiz tile if article has quiz questions
      if (article.quizQuestions.length > 0) {
        tiles.push({
          type: 'quiz',
          sectionIndex: null,
          articleIndex,
          label: `${article.title} - Quiz`,
          row: 0,
          col: 0,
          gridIndex: 0
        });
      }
    });
  } else {
    // Single story mode (backward compatibility)
    const numSectionTiles = storyData.sections.length;
    const numQuizTiles = storyData.quizQuestions.length > 0 ? 1 : 0;

    for (let i = 0; i < numSectionTiles; i++) {
      tiles.push({
        type: 'section',
        sectionIndex: i,
        articleIndex: 0,
        label: `Section ${i + 1}`,
        row: 0,
        col: 0,
        gridIndex: 0
      });
    }

    if (numQuizTiles > 0) {
      tiles.push({
        type: 'quiz',
        sectionIndex: null,
        articleIndex: 0,
        label: 'Quiz',
        row: 0,
        col: 0,
        gridIndex: 0
      });
    }
  }

  // Assign positions
  const positions = generateTilePositions(
    tiles.length, 
    pattern, 
    config.tileLayout.gridSize
  );
  
  return tiles.map((tile, i) => ({
    ...tile,
    ...positions[i]
  }));
}

function generateTilesForAllQuestionsMode(
  config: GameConfig, 
  storyData: StoryData, 
  pattern: string
): ActiveTile[] {
  const tiles: ActiveTile[] = [];

  if (storyData.articles) {
    storyData.articles.forEach((article, articleIndex) => {
      // One reading tile per article
      tiles.push({
        type: 'section',
        sectionIndex: -1, // -1 means "all sections"
        articleIndex,
        label: `${article.title} - Reading`,
        row: 0,
        col: 0,
        gridIndex: 0
      });

      // One quiz tile per article
      if (article.quizQuestions.length > 0) {
        tiles.push({
          type: 'quiz',
          sectionIndex: null,
          articleIndex,
          label: `${article.title} - Quiz`,
          row: 0,
          col: 0,
          gridIndex: 0
        });
      }
    });
  } else {
    tiles.push({
      type: 'section',
      sectionIndex: -1,
      articleIndex: 0,
      label: 'Reading',
      row: 0,
      col: 0,
      gridIndex: 0
    });

    if (storyData.quizQuestions.length > 0) {
      tiles.push({
        type: 'quiz',
        sectionIndex: null,
        articleIndex: 0,
        label: 'Quiz',
        row: 0,
        col: 0,
        gridIndex: 0
      });
    }
  }

  const positions = generateTilePositions(
    tiles.length, 
    pattern, 
    config.tileLayout.gridSize
  );
  
  return tiles.map((tile, i) => ({
    ...tile,
    ...positions[i]
  }));
}

function generateTilesForFullTextMode(
  config: GameConfig, 
  storyData: StoryData, 
  pattern: string
): ActiveTile[] {
  const tiles: ActiveTile[] = [];

  if (storyData.articles) {
    storyData.articles.forEach((_, articleIndex) => {
      tiles.push({
        type: 'section',
        sectionIndex: -2, // -2 means "full text mode"
        articleIndex,
        label: `Article ${articleIndex + 1}`,
        row: 0,
        col: 0,
        gridIndex: 0
      });
    });
  } else {
    tiles.push({
      type: 'section',
      sectionIndex: -2,
      articleIndex: 0,
      label: 'Full Story',
      row: 0,
      col: 0,
      gridIndex: 0
    });
  }

  const positions = generateTilePositions(
    tiles.length, 
    pattern, 
    config.tileLayout.gridSize
  );
  
  return tiles.map((tile, i) => ({
    ...tile,
    ...positions[i]
  }));
}




