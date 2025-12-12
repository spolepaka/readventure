/**
 * Game Config Loader
 */

import type { GameConfig, StoryData } from '../types';

/**
 * Load game configuration from JSON file
 */
export async function loadConfig(): Promise<GameConfig> {
  try {
    const response = await fetch('/game-config.json');
    if (!response.ok) {
      throw new Error('Failed to load config');
    }
    return await response.json();
  } catch (error) {
    console.error('Error loading config:', error);
    console.warn('Using default configuration');
    return getDefaultConfig();
  }
}

/**
 * Default configuration fallback
 */
export function getDefaultConfig(): GameConfig {
  return {
    gameVersion: '2.0',
    gameName: 'Readventure',
    currentTheme: 'space',
    contentGranularity: {
      mode: 'one-question-per-tile',
      numberOfSectionTiles: 4,
      numberOfQuizTiles: 1,
      showFullPassageBeforeQuiz: true
    },
    tileLayout: {
      gridSize: { rows: 4, columns: 4 },
      tilePathPattern: 'linear-horizontal',
      gridAlignment: {
        width: '62vmin',
        height: '62vmin',
        top: '51.8%',
        left: '50.4%',
        gap: '5.4%'
      }
    },
    gameFlow: {
      linearProgression: true,
      allowSkipTiles: false,
      requireCorrectAnswerToProgress: false,
      showScoreDuringGame: false,
      firstTileUnlockedOnStart: true,
      enableBackButton: true,
      passThresholdPercent: 90
    },
    visualSettings: {
      lockedTile: {
        blurAmount: '8px',
        brightness: 0.6,
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        showLockIcon: true,
        lockIcon: '🔒',
        lockIconSize: '2.5em',
        lockIconColor: '#ffd700'
      },
      completedTile: {
        removeBlur: true,
        showCheckmark: false
      },
      hoverEffect: {
        enabled: true,
        scale: 1.05,
        transitionDuration: '0.3s'
      },
      tileStyle: {
        borderRadius: '15px',
        cursor: 'pointer',
        cursorLocked: 'not-allowed'
      }
    },
    scoringSettings: {
      totalQuestionsCalculation: 'auto',
      scoreMessages: [
        { minPercentage: 100, message: "Perfect score! You're a reading superstar! 🌟" },
        { minPercentage: 75, message: 'Excellent work! Keep it up! 🎉' },
        { minPercentage: 50, message: 'Good job! Practice makes perfect! 👍' },
        { minPercentage: 0, message: "Nice try! Let's read it again! 📚" }
      ],
      showPercentageScore: false,
      showNumericScore: true
    },
    feedbackSettings: {
      showFeedbackModal: true,
      modalAnimation: 'modalPop',
      feedbackIcons: { correct: '✓', incorrect: '✗' },
      feedbackTitles: { correct: 'Correct!', incorrect: 'Not Quite!' },
      disableChoicesAfterSelection: true,
      highlightSelectedAnswer: true
    },
    readingTimerSettings: {
      enabled: true,
      durationSeconds: 30,
      allowSkip: false,
      onlyForGuidingQuestions: true
    },
    confettiSettings: {
      enabled: true,
      particleCount: 150,
      duration: 10000,
      colors: ['#ff6b6b', '#4ecdc4', '#45b7d1', '#ffd93d', '#6c5ce7', '#a29bfe'],
      particleSize: { min: 2, max: 8 }
    },
    assets: {
      boardImage: '/assets/space_board_fullhd.webp'
    },
    ui: {
      theme: {
        primaryColor: '#667eea',
        secondaryColor: '#f093fb',
        backgroundColor: '#0a0e27',
        textColor: '#ffffff',
        correctColor: '#4caf50',
        incorrectColor: '#f44336',
        infoColor: '#64b5f6',
        quizColor: '#ba68c8'
      },
      fontFamily: "'Comic Sans MS', 'Arial Rounded MT Bold', cursive, sans-serif",
      buttonStyle: 'gradient',
      borderStyle: 'rounded'
    },
    accessibility: {
      keyboardNavigation: false,
      screenReaderSupport: false,
      highContrastMode: false,
      focusIndicators: false
    },
    debug: {
      showGridBorders: false,
      showTileIndices: false,
      logStateChanges: false,
      testMode: true,
      testModeHotkey: '`'
    },
    dataSource: {
      type: 'external',
      qtiDataPath: '/texts/qti_grade_3_data.json',
      startingArticleId: 'article_101001',
      autoLoadMode: 'fill-grid',
      maxArticles: 16
    }
  };
}

/**
 * Load story data based on config
 */
export async function loadStoryDataFromQTI(config: GameConfig): Promise<StoryData> {
  const { loadQTIData, loadStoryByArticleId, getAvailableArticles } = await import('./qti-parser');
  
  let articleSequence: string[] = [];
  
  console.log('📋 Load mode:', config.dataSource.autoLoadMode);
  
  if (config.dataSource.autoLoadMode === 'fill-grid') {
    console.log('🔄 Auto-fill mode: Calculating articles to load...');
    articleSequence = await calculateArticlesToLoad(config, loadQTIData, loadStoryByArticleId, getAvailableArticles);
  } else if (config.dataSource.articleSequence && Array.isArray(config.dataSource.articleSequence)) {
    console.log('📋 Manual mode: Using specified article sequence');
    articleSequence = config.dataSource.articleSequence;
  } else {
    console.log('📋 Fallback: Loading single article');
    articleSequence = [config.dataSource.startingArticleId];
  }
  
  if (!articleSequence || articleSequence.length === 0) {
    throw new Error('No articles to load - check configuration');
  }
  
  console.log(`📚 Loading ${articleSequence.length} articles:`, articleSequence);
  
  // Load all articles
  const stories: StoryData[] = [];
  for (const articleId of articleSequence) {
    const storyData = await loadStoryByArticleId(
      config.dataSource.qtiDataPath,
      articleId
    );
    stories.push(storyData);
    console.log(`  ✓ Loaded: ${storyData.title} (${storyData.sections.length} sections, ${storyData.quizQuestions.length} quiz)`);
  }
  
  // Combine all stories into a single StoryData
  // Build articles array for multi-article mode
  const articles = stories.map((story, index) => ({
    title: story.title,
    identifier: story.identifier || `article_${index}`,
    metadata: story.metadata || {
      identifier: story.identifier || `article_${index}`,
      title: story.title,
      qtiVersion: '3.0',
      totalSections: story.sections.length,
      totalQuizQuestions: story.quizQuestions.length,
      totalQuestions: story.sections.length + story.quizQuestions.length
    },
    sections: story.sections,
    quizQuestions: story.quizQuestions
  }));

  const combinedStoryData: StoryData = {
    title: stories.length > 1 
      ? `${stories[0].title} (and ${stories.length - 1} more)`
      : stories[0].title,
    articles: articles as any,
    sections: [],
    quizQuestions: []
  };
  
  stories.forEach((story, storyIndex) => {
    if (story.sections && Array.isArray(story.sections)) {
      story.sections.forEach(section => {
        combinedStoryData.sections.push({
          ...section,
          articleIndex: storyIndex,
          articleTitle: story.title
        });
      });
    }
    
    if (story.quizQuestions && Array.isArray(story.quizQuestions)) {
      story.quizQuestions.forEach(quiz => {
        combinedStoryData.quizQuestions.push({
          ...quiz,
          articleIndex: storyIndex,
          articleTitle: story.title
        });
      });
    }
  });
  
  console.log(`✨ Combined: ${stories.length} articles, ${combinedStoryData.sections.length} sections, ${combinedStoryData.quizQuestions.length} quiz questions`);
  return combinedStoryData;
}

async function calculateArticlesToLoad(
  config: GameConfig,
  loadQTIData: any,
  loadStoryByArticleId: any,
  getAvailableArticles: any
): Promise<string[]> {
  const maxTiles = config.tileLayout.gridSize.rows * config.tileLayout.gridSize.columns;
  const mode = config.contentGranularity.mode;
  const startingArticleId = config.dataSource.startingArticleId;
  const maxArticles = config.dataSource.maxArticles || 16;
  
  console.log(`🧮 Calculating articles to fill ${maxTiles} tiles in mode: ${mode}`);
  console.log(`📍 Starting from: ${startingArticleId}`);
  
  const qtiData = await loadQTIData(config.dataSource.qtiDataPath);
  
  if (!qtiData || !qtiData.assessments) {
    throw new Error('Invalid QTI data structure');
  }
  
  const allArticles = getAvailableArticles(qtiData);
  
  if (!allArticles || allArticles.length === 0) {
    throw new Error('No articles found in QTI data');
  }
  
  console.log(`📚 Found ${allArticles.length} total articles in QTI data`);
  
  const startIndex = allArticles.findIndex((a: any) => a.identifier === startingArticleId);
  if (startIndex === -1) {
    throw new Error(`Starting article ${startingArticleId} not found`);
  }
  
  console.log(`📍 Starting article is at index ${startIndex} of ${allArticles.length}`);
  
  const articlesToLoad: string[] = [];
  let tilesUsed = 0;
  let currentIndex = startIndex;
  
  while (tilesUsed < maxTiles && currentIndex < allArticles.length && articlesToLoad.length < maxArticles) {
    const articleId = allArticles[currentIndex].identifier;
    articlesToLoad.push(articleId);
    
    const tempStory = await loadStoryByArticleId(config.dataSource.qtiDataPath, articleId);
    
    if (!tempStory || !tempStory.sections) {
      console.warn(`⚠️ Article ${articleId} has no sections, skipping`);
      currentIndex++;
      continue;
    }
    
    let tilesForArticle = 0;
    switch (mode) {
      case 'one-question-per-tile':
        const sectionsCount = tempStory.sections.length || 0;
        const quizCount = (tempStory.quizQuestions && tempStory.quizQuestions.length > 0) ? 1 : 0;
        tilesForArticle = sectionsCount + quizCount;
        break;
      case 'all-questions-one-tile':
        tilesForArticle = 2;
        break;
      case 'full-text-per-tile':
        tilesForArticle = 1;
        break;
    }
    
    tilesUsed += tilesForArticle;
    console.log(`  📊 Article ${articlesToLoad.length}: ${allArticles[currentIndex].title} → ${tilesForArticle} tiles (cumulative: ${tilesUsed}/${maxTiles})`);
    
    if (tilesUsed >= maxTiles) {
      console.log(`✅ Grid filled with ${articlesToLoad.length} articles (${tilesUsed} tiles)`);
      break;
    }
    
    currentIndex++;
  }
  
  console.log(`📦 Will load ${articlesToLoad.length} articles:`, articlesToLoad);
  return articlesToLoad;
}

