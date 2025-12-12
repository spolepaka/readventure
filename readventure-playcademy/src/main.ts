/**
 * Readventure - Turn Reading into Adventure
 * 
 * Main entry point for the Playcademy-integrated reading comprehension game.
 */

import './styles/main.css';
import { SpaceReadingGame } from './game';
import { loadConfig, loadStoryDataFromQTI } from './utils/config-loader';
import { soundManager } from './utils/sound-manager';
import type { GameConfig } from './types';

// Global game instance
let game: SpaceReadingGame | null = null;
let GAME_CONFIG: GameConfig | null = null;

// Initialize sound manager on first user interaction
let soundsInitialized = false;
function initSoundsOnInteraction() {
  if (!soundsInitialized) {
    soundsInitialized = true;
    soundManager.init();
  }
}
document.addEventListener('click', initSoundsOnInteraction, { once: true });
document.addEventListener('keydown', initSoundsOnInteraction, { once: true });

/**
 * Initialize the game
 */
async function initGame(): Promise<void> {
  console.log('🎮 Readventure starting...');
  
  try {
    // Load game configuration
    GAME_CONFIG = await loadConfig();
    console.log('✅ Game config loaded:', GAME_CONFIG);
    console.log(`📍 Starting article: ${GAME_CONFIG.dataSource.startingArticleId}`);
    console.log(`🔄 Auto-load mode: ${GAME_CONFIG.dataSource.autoLoadMode}`);
    
    // Load story data based on config
    const storyData = await loadStoryDataFromQTI(GAME_CONFIG);
    console.log('✅ Story data loaded:', storyData);
    
    if (storyData.sections && storyData.quizQuestions) {
      console.log(`📊 Total sections: ${storyData.sections.length}, Total quiz: ${storyData.quizQuestions.length}`);
    }
    if (storyData.articles) {
      console.log(`📚 Loaded ${storyData.articles.length} articles`);
    }
    
    // Initialize the game
    game = new SpaceReadingGame(GAME_CONFIG, storyData);
    console.log(`✅ Game initialized with ${game.getActiveTiles().length} tiles`);
    
    // Expose game instance globally for button handlers
    (window as any).game = game;
    
    // Hide loader
    const loader = document.getElementById('loader');
    if (loader) {
      setTimeout(() => loader.classList.add('hidden'), 500);
    }
    
  } catch (error) {
    console.error('❌ Game initialization error:', error);
    alert(`Game failed to load: ${(error as Error).message}\n\nCheck console for details.`);
  }
}

/**
 * Try to initialize Playcademy SDK (optional - works without it for local dev)
 */
async function initPlaycademy(): Promise<void> {
  try {
    const { PlaycademyClient } = await import('@playcademy/sdk');
    
    const client = await PlaycademyClient.init({
      onDisconnect: ({ state, displayAlert }) => {
        if (state === 'offline') {
          displayAlert?.('Connection lost. Your progress may not be saved.', { type: 'warning' });
        }
      }
    });
    
    // Get user info
    const user = await client.users.me();
    console.log('🎮 Playcademy user:', user.name);
    
    // Store client globally for game to use
    (window as any).playcademyClient = client;
    
  } catch (error) {
    // SDK not available or failed to init - that's okay for local dev
    console.log('ℹ️ Running without Playcademy SDK (local dev mode)');
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  // Try Playcademy SDK first (non-blocking)
  initPlaycademy();
  
  // Initialize the game
  await initGame();
});

// Export for use in HTML onclick handlers
export { game, GAME_CONFIG };
