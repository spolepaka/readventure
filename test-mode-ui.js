/**
 * Test Mode UI
 * 
 * Provides an in-browser UI panel for testing and changing game configuration
 * in real-time without editing files or refreshing the page.
 * 
 * Press ` (backtick) key to toggle the test panel.
 */

class TestModeUI {
    constructor(game, config) {
        this.game = game;
        this.config = config;
        this.panel = null;
        this.isVisible = false;
        this.qtiData = null;
        this.availableArticles = [];
        
        this.init();
    }
    
    async init() {
        this.createPanel();
        this.setupKeyboardShortcut();
        await this.loadAvailableArticles();
        this.populatePanel();
    }
    
    createPanel() {
        // Create floating test panel
        this.panel = document.createElement('div');
        this.panel.id = 'test-mode-panel';
        this.panel.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            width: 400px;
            max-height: 90vh;
            background: rgba(20, 20, 40, 0.98);
            border: 2px solid #00ff00;
            border-radius: 10px;
            padding: 20px;
            color: #00ff00;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            z-index: 10000;
            overflow-y: auto;
            box-shadow: 0 0 30px rgba(0, 255, 0, 0.5);
            display: none;
        `;
        
        document.body.appendChild(this.panel);
    }
    
    setupKeyboardShortcut() {
        // Press backtick (`) to toggle test panel
        document.addEventListener('keydown', (e) => {
            if (e.key === '`') {
                e.preventDefault();
                this.toggle();
            }
        });
    }
    
    async loadAvailableArticles() {
        try {
            this.qtiData = await loadQTIData(this.config.dataSource.qtiDataPath);
            this.availableArticles = getAvailableArticles(this.qtiData);
            console.log(`Loaded ${this.availableArticles.length} available articles for test mode`);
        } catch (error) {
            console.error('Failed to load articles for test mode:', error);
        }
    }
    
    populatePanel() {
        this.panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 2px solid #00ff00; padding-bottom: 10px;">
                <h3 style="margin: 0; color: #00ff00;">🧪 TEST MODE</h3>
                <button onclick="testMode.close()" style="background: #ff0000; color: white; border: none; padding: 5px 10px; cursor: pointer; border-radius: 5px;">✕</button>
            </div>
            
            <div style="margin-bottom: 15px; padding: 10px; background: rgba(0, 255, 0, 0.1); border-radius: 5px;">
                <strong>Keyboard Shortcut:</strong> Press <code style="background: rgba(0,0,0,0.5); padding: 2px 6px; border-radius: 3px;">\`</code> (backtick) to toggle this panel
            </div>
            
            <!-- Story Selection -->
            <div class="test-section">
                <h4 style="color: #00ffff; margin-top: 0;">📚 Story (${this.availableArticles.length} available)</h4>
                <label>Search & Select Article:</label>
                <input list="article-list" id="test-article-id" 
                    placeholder="Type to search or scroll..." 
                    style="width: 100%; padding: 8px; margin: 5px 0; background: #1a1a2e; color: #00ff00; border: 1px solid #00ff00; border-radius: 5px;">
                <datalist id="article-list">
                    <option value="">Loading...</option>
                </datalist>
                <small style="color: #88ff88; display: block; margin: 5px 0;">Type article ID or title to search through all ${this.availableArticles.length} stories</small>
                <button onclick="testMode.changeStory()" class="test-btn">Load Story</button>
            </div>
            
            <!-- Content Granularity -->
            <div class="test-section">
                <h4 style="color: #00ffff;">🎯 Content Granularity</h4>
                <label>Mode:</label>
                <select id="test-granularity-mode" style="width: 100%; padding: 8px; margin: 5px 0; background: #1a1a2e; color: #00ff00; border: 1px solid #00ff00; border-radius: 5px;">
                    <option value="one-question-per-tile">One Question Per Tile</option>
                    <option value="all-questions-one-tile">All Questions One Tile</option>
                    <option value="full-text-per-tile">Full Text Per Tile</option>
                </select>
                <button onclick="testMode.changeGranularity()" class="test-btn">Apply Mode</button>
            </div>
            
            <!-- Visual Settings -->
            <div class="test-section">
                <h4 style="color: #00ffff;">🎨 Visual Settings</h4>
                
                <label>Lock Icon:</label>
                <input type="text" id="test-lock-icon" value="${this.config.visualSettings.lockedTile.lockIcon}" 
                    style="width: 100%; padding: 8px; margin: 5px 0; background: #1a1a2e; color: #00ff00; border: 1px solid #00ff00; border-radius: 5px;">
                
                <label>Blur Amount:</label>
                <input type="text" id="test-blur-amount" value="${this.config.visualSettings.lockedTile.blurAmount}" 
                    style="width: 100%; padding: 8px; margin: 5px 0; background: #1a1a2e; color: #00ff00; border: 1px solid #00ff00; border-radius: 5px;">
                
                <label>Show Lock Icon:</label>
                <input type="checkbox" id="test-show-lock" ${this.config.visualSettings.lockedTile.showLockIcon ? 'checked' : ''}>
                
                <label style="margin-left: 10px;">Show Checkmark on Complete:</label>
                <input type="checkbox" id="test-show-checkmark" ${this.config.visualSettings.completedTile.showCheckmark ? 'checked' : ''}>
                
                <button onclick="testMode.applyVisuals()" class="test-btn">Apply Visuals</button>
            </div>
            
            <!-- Game Flow -->
            <div class="test-section">
                <h4 style="color: #00ffff;">🎮 Game Flow</h4>
                
                <label>
                    <input type="checkbox" id="test-linear-progression" ${this.config.gameFlow.linearProgression ? 'checked' : ''}>
                    Linear Progression (unlock one at a time)
                </label><br>
                
                <label>
                    <input type="checkbox" id="test-require-correct" ${this.config.gameFlow.requireCorrectAnswerToProgress ? 'checked' : ''}>
                    Require Correct Answer to Progress
                </label><br>
                
                <label>
                    <input type="checkbox" id="test-show-score" ${this.config.gameFlow.showScoreDuringGame ? 'checked' : ''}>
                    Show Score During Game
                </label><br>
                
                <button onclick="testMode.applyGameFlow()" class="test-btn" style="margin-top: 10px;">Apply Flow</button>
            </div>
            
            <!-- Confetti -->
            <div class="test-section">
                <h4 style="color: #00ffff;">🎊 Confetti</h4>
                
                <label>
                    <input type="checkbox" id="test-confetti-enabled" ${this.config.confettiSettings.enabled ? 'checked' : ''}>
                    Enable Confetti
                </label><br>
                
                <label>Particle Count:</label>
                <input type="number" id="test-particle-count" value="${this.config.confettiSettings.particleCount}" 
                    style="width: 100%; padding: 8px; margin: 5px 0; background: #1a1a2e; color: #00ff00; border: 1px solid #00ff00; border-radius: 5px;">
                
                <button onclick="testMode.applyConfetti()" class="test-btn">Apply Confetti</button>
                <button onclick="testMode.testConfetti()" class="test-btn">Test Confetti Now</button>
            </div>
            
            <!-- Debug Actions -->
            <div class="test-section">
                <h4 style="color: #00ffff;">🔧 Debug Actions</h4>
                <button onclick="testMode.unlockAllTiles()" class="test-btn">Unlock All Tiles</button>
                <button onclick="testMode.resetGame()" class="test-btn">Reset Game</button>
                <button onclick="testMode.showCurrentConfig()" class="test-btn">Log Config to Console</button>
                <button onclick="testMode.downloadConfig()" class="test-btn">Download Config</button>
            </div>
            
            <!-- Current Status -->
            <div class="test-section" style="background: rgba(0, 255, 0, 0.05); padding: 10px; border-radius: 5px;">
                <h4 style="color: #00ffff; margin-top: 0;">📊 Current Status</h4>
                <div id="test-status">
                    <div>Article: <strong>${this.config.dataSource.startingArticleId}</strong></div>
                    <div>Mode: <strong>${this.config.contentGranularity.mode}</strong></div>
                    <div>Score: <strong id="test-score-display">0/${this.game.totalQuestions}</strong></div>
                </div>
            </div>
            
            <style>
                .test-section {
                    margin-bottom: 20px;
                    padding: 15px;
                    background: rgba(0, 255, 0, 0.02);
                    border: 1px solid rgba(0, 255, 0, 0.3);
                    border-radius: 5px;
                }
                
                .test-section label {
                    display: block;
                    margin: 5px 0;
                    color: #88ff88;
                }
                
                .test-btn {
                    background: linear-gradient(135deg, #00ff00 0%, #00cc00 100%);
                    color: #000;
                    border: none;
                    padding: 8px 15px;
                    margin: 5px 5px 0 0;
                    border-radius: 5px;
                    cursor: pointer;
                    font-weight: bold;
                    font-size: 11px;
                    transition: all 0.3s ease;
                }
                
                .test-btn:hover {
                    background: linear-gradient(135deg, #00ff00 0%, #00ff00 100%);
                    transform: translateY(-2px);
                    box-shadow: 0 5px 15px rgba(0, 255, 0, 0.4);
                }
                
                #test-mode-panel::-webkit-scrollbar {
                    width: 8px;
                }
                
                #test-mode-panel::-webkit-scrollbar-track {
                    background: rgba(0, 255, 0, 0.1);
                }
                
                #test-mode-panel::-webkit-scrollbar-thumb {
                    background: rgba(0, 255, 0, 0.5);
                    border-radius: 4px;
                }
            </style>
        `;
        
        // Populate article dropdown
        this.populateArticleDropdown();
    }
    
    populateArticleDropdown() {
        const input = document.getElementById('test-article-id');
        const datalist = document.getElementById('article-list');
        
        if (!input || !datalist || this.availableArticles.length === 0) return;
        
        // Set current article as input value
        const currentArticle = this.availableArticles.find(a => a.identifier === this.config.dataSource.startingArticleId);
        if (currentArticle) {
            input.value = currentArticle.identifier;
        }
        
        // Populate datalist with all articles
        datalist.innerHTML = this.availableArticles.map(article => 
            `<option value="${article.identifier}">${article.title}</option>`
        ).join('');
        
        console.log(`✅ Populated article list with ${this.availableArticles.length} articles`);
    }
    
    toggle() {
        this.isVisible = !this.isVisible;
        this.panel.style.display = this.isVisible ? 'block' : 'none';
        
        if (this.isVisible) {
            this.updateStatus();
        }
    }
    
    close() {
        this.isVisible = false;
        this.panel.style.display = 'none';
    }
    
    updateStatus() {
        const statusDiv = document.getElementById('test-status');
        if (statusDiv) {
            statusDiv.innerHTML = `
                <div>Article: <strong>${this.config.dataSource.startingArticleId}</strong></div>
                <div>Mode: <strong>${this.config.contentGranularity.mode}</strong></div>
                <div>Score: <strong>${this.game.score}/${this.game.totalQuestions}</strong></div>
                <div>Current Tile: <strong>${this.game.currentTile + 1}</strong></div>
                <div>State: <strong>${this.game.state}</strong></div>
            `;
        }
    }
    
    async changeStory() {
        const input = document.getElementById('test-article-id');
        let newArticleId = input.value.trim();
        
        // If user typed just the title, find the ID
        const matchedArticle = this.availableArticles.find(a => 
            a.identifier === newArticleId || a.title === newArticleId
        );
        
        if (matchedArticle) {
            newArticleId = matchedArticle.identifier;
        }
        
        if (!newArticleId) return;
        
        console.log(`🧪 TEST MODE: Changing to article ${newArticleId}`);
        
        try {
            // Load new story
            const newStoryData = await loadStoryByArticleId(
                this.config.dataSource.qtiDataPath,
                newArticleId
            );
            
            // Update config
            this.config.dataSource.startingArticleId = newArticleId;
            this.config.dataSource.startingArticleTitle = newStoryData.title;
            
            console.log(`✅ Loaded: ${newStoryData.title}`);
            
            // Prompt to reload game
            if (confirm(`Story "${newStoryData.title}" loaded!\n\nReload the game to play this story?`)) {
                location.reload();
            }
        } catch (error) {
            console.error('Failed to load story:', error);
            alert(`Failed to load story: ${error.message}`);
        }
    }
    
    changeGranularity() {
        const select = document.getElementById('test-granularity-mode');
        const newMode = select.value;
        
        console.log(`🧪 TEST MODE: Changing granularity to ${newMode}`);
        
        this.config.contentGranularity.mode = newMode;
        
        alert(`Granularity mode changed to: ${newMode}\n\nNote: Other modes not yet implemented.\nReload to apply changes.`);
        
        this.updateStatus();
    }
    
    applyVisuals() {
        const lockIcon = document.getElementById('test-lock-icon').value;
        const blurAmount = document.getElementById('test-blur-amount').value;
        const showLock = document.getElementById('test-show-lock').checked;
        const showCheckmark = document.getElementById('test-show-checkmark').checked;
        
        console.log('🧪 TEST MODE: Applying visual settings');
        
        // Update config
        this.config.visualSettings.lockedTile.lockIcon = lockIcon;
        this.config.visualSettings.lockedTile.blurAmount = blurAmount;
        this.config.visualSettings.lockedTile.showLockIcon = showLock;
        this.config.visualSettings.completedTile.showCheckmark = showCheckmark;
        
        // Apply CSS variables
        document.documentElement.style.setProperty('--blur-amount', blurAmount);
        
        // Update lock icons
        document.querySelectorAll('.lock-symbol').forEach(symbol => {
            symbol.textContent = lockIcon;
        });
        
        // Toggle lock icon visibility
        document.querySelectorAll('.lock-icon').forEach(lock => {
            if (lock.querySelector('.lock-symbol')) {
                lock.style.display = showLock ? 'flex' : 'none';
            }
        });
        
        console.log('✅ Visual settings applied');
        alert('Visual settings applied!\n\nRefresh to fully reset.');
    }
    
    applyGameFlow() {
        const linearProgression = document.getElementById('test-linear-progression').checked;
        const requireCorrect = document.getElementById('test-require-correct').checked;
        const showScore = document.getElementById('test-show-score').checked;
        
        console.log('🧪 TEST MODE: Applying game flow settings');
        
        this.config.gameFlow.linearProgression = linearProgression;
        this.config.gameFlow.requireCorrectAnswerToProgress = requireCorrect;
        this.config.gameFlow.showScoreDuringGame = showScore;
        
        alert('Game flow settings updated!\n\nReload to apply changes.');
        
        this.updateStatus();
    }
    
    applyConfetti() {
        const enabled = document.getElementById('test-confetti-enabled').checked;
        const particleCount = parseInt(document.getElementById('test-particle-count').value);
        
        console.log('🧪 TEST MODE: Applying confetti settings');
        
        this.config.confettiSettings.enabled = enabled;
        this.config.confettiSettings.particleCount = particleCount;
        
        alert('Confetti settings updated!\n\nUse "Test Confetti Now" button to preview.');
    }
    
    testConfetti() {
        console.log('🧪 TEST MODE: Testing confetti');
        
        if (this.game && typeof this.game.startConfetti === 'function') {
            this.game.startConfetti();
        } else {
            alert('Confetti function not available');
        }
    }
    
    unlockAllTiles() {
        console.log('🧪 TEST MODE: Unlocking all tiles');
        
        // Remove locked class from all tiles
        document.querySelectorAll('.tile-hotspot').forEach(tile => {
            tile.classList.remove('locked');
        });
        
        // Hide all lock icons
        document.querySelectorAll('.lock-icon').forEach(lock => {
            lock.classList.remove('visible');
        });
        
        console.log('✅ All tiles unlocked');
        alert('All tiles unlocked!\n\nYou can now click any tile.');
    }
    
    resetGame() {
        console.log('🧪 TEST MODE: Resetting game');
        
        if (confirm('Reset the game and start over?')) {
            location.reload();
        }
    }
    
    showCurrentConfig() {
        console.log('🧪 TEST MODE: Current Configuration:');
        console.log(JSON.stringify(this.config, null, 2));
        alert('Current config logged to console!\n\nOpen DevTools (F12) to see.');
    }
    
    downloadConfig() {
        console.log('🧪 TEST MODE: Downloading config');
        
        const configJson = JSON.stringify(this.config, null, 2);
        const blob = new Blob([configJson], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `game-config-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log('✅ Config downloaded');
    }
    
    // Auto-update status periodically
    startStatusUpdates() {
        setInterval(() => {
            if (this.isVisible) {
                this.updateStatus();
            }
        }, 1000);
    }
}

// Global test mode instance
let testMode = null;

// Initialize test mode when game is ready
function initTestMode(game, config) {
    testMode = new TestModeUI(game, config);
    testMode.startStatusUpdates();
    
    console.log('🧪 TEST MODE ENABLED');
    console.log('Press ` (backtick) key to open test panel');
}

