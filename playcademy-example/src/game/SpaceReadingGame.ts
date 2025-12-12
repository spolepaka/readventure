/**
 * SpaceReadingGame - Main Game Class
 * A reading comprehension game with board-based progression
 * Now powered by PowerPath 100 adaptive algorithm!
 */

import type {
  GameConfig,
  StoryData,
  GameState,
  ActiveTile,
  TileProgress,
  QuestionResult,
  Choice,
  Section,
  QuizQuestion,
} from '../types';
import { generateActiveTiles } from './tiles';
import { startConfetti } from './confetti';
import { PowerPath100, convertToPowerPathQuestion, type PowerPathQuestion, type PowerPathStats } from './powerpath';
import { soundManager } from '../utils/sound-manager';

export class SpaceReadingGame {
  private config: GameConfig;
  private storyData: StoryData;
  private state: GameState = 'BOARD';
  private currentTile = 0;
  private currentQuizQuestion = 0;
  private score = 0;
  private totalQuestions: number;
  private activeTiles: ActiveTile[];
  private selectedAnswer: Choice | null = null;
  private tilesCompleted: boolean[];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private _tileProgress: Record<number, TileProgress> = {};
  
  // Tile results tracking
  private currentTileGuidingResults: QuestionResult[] = [];
  private currentTileQuizResults: QuestionResult[] = [];
  
  // Timer settings
  private readingTimerEnabled: boolean;
  private readingTimerDuration: number;
  private readingTimerAllowSkip: boolean;
  private readingTimerOnlyGuiding: boolean;
  private currentTimerValue = 0;
  private timerInterval: number | null = null;
  
  // Current question context
  private _currentArticleIndex = 0;
  private currentArticleTitle = '';
  private isInGuidingPhase = true;
  private guidingQuestions: QuizQuestion[] = [];
  private _quizQuestions: QuizQuestion[] = [];
  private sectionsForArticle: Section[] = [];
  private _currentFullGameQuestion = 0;
  private currentSectionQuestion = 0;
  private currentTileQuizQuestions: QuizQuestion[] = [];
  
  // PowerPath 100 algorithm
  private powerPath: PowerPath100 | null = null;
  private currentPowerPathQuestion: PowerPathQuestion | null = null;
  private powerPathStartTime: number = 0;
  private powerPathTimerInterval: number | null = null;
  
  constructor(config: GameConfig, storyData: StoryData) {
    console.log('🎮 SpaceReadingGame constructor called');
    console.log('📊 Story data:', storyData);
    
    this.config = config;
    this.storyData = storyData;
    
    // Validate story data
    if (!storyData || !storyData.sections || !storyData.quizQuestions) {
      throw new Error('Invalid story data structure - missing sections or quizQuestions');
    }
    
    console.log(`📚 Story has ${storyData.sections.length} sections, ${storyData.quizQuestions.length} quiz questions`);
    
    // Generate tiles dynamically
    console.log('🔧 Generating active tiles...');
    this.activeTiles = generateActiveTiles(config, storyData);
    console.log(`✅ Generated ${this.activeTiles.length} active tiles`);
    
    // Calculate total questions
    if (config.scoringSettings.totalQuestionsCalculation === 'auto') {
      this.totalQuestions = storyData.sections.length + storyData.quizQuestions.length;
    } else {
      this.totalQuestions = config.scoringSettings.totalQuestionsCalculation as number;
    }
    
    this.tilesCompleted = new Array(this.activeTiles.length).fill(false);
    
    // Timer settings
    const timerSettings = config.readingTimerSettings || {};
    this.readingTimerEnabled = timerSettings.enabled !== false;
    this.readingTimerDuration = timerSettings.durationSeconds || 30;
    this.readingTimerAllowSkip = timerSettings.allowSkip === true;
    this.readingTimerOnlyGuiding = timerSettings.onlyForGuidingQuestions !== false;
    
    console.log(`✨ Game initialized with ${this.activeTiles.length} tiles, ${this.totalQuestions} total questions`);
    
    this.init();
  }

  private init(): void {
    this.renderBoard();
    this.applyVisualSettings();
    this.setupEventListeners();
  }

  private applyVisualSettings(): void {
    const root = document.documentElement;
    const { lockedTile } = this.config.visualSettings;
    
    root.style.setProperty('--blur-amount', lockedTile.blurAmount);
    root.style.setProperty('--blur-brightness', lockedTile.brightness.toString());
    root.style.setProperty('--lock-bg-color', lockedTile.backgroundColor);
    root.style.setProperty('--lock-icon-size', lockedTile.lockIconSize);
    root.style.setProperty('--lock-icon-color', lockedTile.lockIconColor);
  }

  private renderBoard(): void {
    const tilesOverlay = document.getElementById('tiles-overlay');
    const locksOverlay = document.getElementById('locks-overlay');
    if (!tilesOverlay || !locksOverlay) return;

    tilesOverlay.innerHTML = '';
    locksOverlay.innerHTML = '';

    const { rows, columns } = this.config.tileLayout.gridSize;
    const totalSlots = rows * columns;

    // Create all grid slots
    for (let i = 0; i < totalSlots; i++) {
      // Find if there's an active tile at this position
      const activeTile = this.activeTiles.find(t => t.gridIndex === i);

      const tileDiv = document.createElement('div');
      tileDiv.className = 'tile-hotspot';
      tileDiv.dataset.gridIndex = i.toString();

      const lockDiv = document.createElement('div');
      lockDiv.className = 'lock-icon';
      lockDiv.dataset.gridIndex = i.toString();

      if (activeTile) {
        const tileIndex = this.activeTiles.indexOf(activeTile);
        tileDiv.dataset.tileIndex = tileIndex.toString();
        lockDiv.dataset.tileIndex = tileIndex.toString();

        // All tiles start locked (blurred) if linear progression is enabled
        // This matches the original Readventure behavior
        if (this.config.gameFlow.linearProgression) {
          tileDiv.classList.add('locked');
        }
        
        // Show lock icon based on config
        // Lock icon shown for: tiles > 0, OR tile 0 if firstTileUnlockedOnStart is false
        const showLockIcon = this.config.visualSettings.lockedTile.showLockIcon;
        const firstTileUnlocked = this.config.gameFlow.firstTileUnlockedOnStart;
        
        if (showLockIcon && (tileIndex > 0 || !firstTileUnlocked)) {
          lockDiv.classList.add('visible');
          lockDiv.innerHTML = `<span class="lock-symbol">${this.config.visualSettings.lockedTile.lockIcon}</span>`;
          // Mark tile as not clickable (shows not-allowed cursor)
          tileDiv.classList.add('not-clickable');
        }

        tileDiv.addEventListener('click', () => this.onTileClick(tileIndex));
      } else {
        // Empty slot - no interaction
        tileDiv.classList.add('empty-slot');
        tileDiv.style.pointerEvents = 'none';
      }

      tilesOverlay.appendChild(tileDiv);
      locksOverlay.appendChild(lockDiv);
    }
  }

  private setupEventListeners(): void {
    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.state !== 'BOARD') {
          this.backToBoard();
        }
      }
    });
  }

  private onTileClick(tileIndex: number): void {
    const tile = document.querySelector(`#tiles-overlay [data-tile-index="${tileIndex}"]`);
    const lockIcon = document.querySelector(`#locks-overlay [data-tile-index="${tileIndex}"]`);
    
    // Check if tile has a lock icon visible (not just blur)
    // This matches the original Readventure behavior where lock icon controls clickability
    if (lockIcon && lockIcon.classList.contains('visible')) {
      // Shake animation for locked tiles
      soundManager.play('locked');
      tile?.classList.add('shake');
      setTimeout(() => tile?.classList.remove('shake'), 500);
      return;
    }

    // Play tile selection sound
    soundManager.play('tile-select');

    this.currentTile = tileIndex;
    const activeTile = this.activeTiles[tileIndex];

    // Reset tile results tracking
    this.currentTileGuidingResults = [];
    this.currentTileQuizResults = [];

    // Enter reading mode (disables sounds during reading)
    soundManager.enterReadingMode();

    if (activeTile.type === 'section') {
      this.loadSection(activeTile.sectionIndex!, activeTile.articleIndex);
    } else if (activeTile.type === 'quiz') {
      this.loadQuizIntro(activeTile.articleIndex);
    }
  }

  private loadSection(sectionIndex: number, articleIndex: number): void {
    this.state = 'READING';
    this._currentArticleIndex = articleIndex;

    // Get sections for this article
    this.sectionsForArticle = this.storyData.sections.filter(s => 
      s.articleIndex === articleIndex
    );

    // Handle "all sections" mode (sectionIndex: -1) - one article per tile
    if (sectionIndex === -1) {
      this.loadArticleTile(articleIndex);
      return;
    }

    const section = this.sectionsForArticle[sectionIndex] || this.storyData.sections[sectionIndex];
    if (!section) {
      console.error('Section not found:', sectionIndex);
      return;
    }

    this.currentArticleTitle = section.articleTitle || this.storyData.title;

    // Create guiding question from section
    this.guidingQuestions = [{
      id: section.identifier,
      prompt: section.question,
      choices: section.choices,
      articleIndex,
      articleTitle: this.currentArticleTitle
    }];

    this.isInGuidingPhase = true;
    this._currentFullGameQuestion = 0;
    this.currentSectionQuestion = 0;

    // Render passage
    this.renderPassage(section);
    
    // Show timer or question immediately
    if (this.readingTimerEnabled && this.readingTimerOnlyGuiding) {
      this.startReadingTimer(() => {
        this.renderQuestion(this.guidingQuestions[0]);
      });
    } else {
      this.renderQuestion(this.guidingQuestions[0]);
    }

    this.showScreen('reading-screen');
  }

  /**
   * Load an entire article as one tile (guiding questions + quiz questions)
   * Sections are revealed PROGRESSIVELY during guiding phase, then full passage for quiz
   * Now powered by PowerPath 100 algorithm!
   */
  private loadArticleTile(articleIndex: number): void {
    // Get all sections for this article and store for progressive reveal
    this.sectionsForArticle = this.storyData.sections.filter(s => s.articleIndex === articleIndex);
    
    if (this.sectionsForArticle.length === 0) {
      console.error('No sections found for article:', articleIndex);
      return;
    }

    this.currentArticleTitle = this.sectionsForArticle[0].articleTitle || this.storyData.title;
    this._currentArticleIndex = articleIndex;

    // Create guiding questions from ALL sections
    this.guidingQuestions = this.sectionsForArticle.map(section => ({
      id: section.identifier,
      prompt: section.question,
      choices: section.choices,
      articleIndex,
      articleTitle: this.currentArticleTitle
    }));

    // Get quiz questions for this article
    const quizForArticle = this.storyData.quizQuestions.filter(q => q.articleIndex === articleIndex);
    this._quizQuestions = quizForArticle.map(quiz => ({
      id: quiz.id,
      prompt: quiz.prompt,
      choices: quiz.choices,
      articleIndex,
      articleTitle: this.currentArticleTitle,
      metadata: quiz.metadata
    }));

    console.log(`📚 Article tile: ${this.guidingQuestions.length} guiding + ${this._quizQuestions.length} quiz questions`);

    // Initialize PowerPath 100 algorithm
    const powerPathGuiding = this.guidingQuestions.map(q => convertToPowerPathQuestion(q));
    const powerPathQuiz = this._quizQuestions.map(q => convertToPowerPathQuestion(q));
    
    this.powerPath = new PowerPath100(
      powerPathGuiding,
      powerPathQuiz,
      (stats) => this.updatePowerPathUI(stats)
    );
    
    // Start PowerPath timer
    this.powerPathStartTime = Date.now();
    this.startPowerPathTimer();
    
    console.log(`🚀 PowerPath 100 initialized with ${powerPathGuiding.length} guiding + ${powerPathQuiz.length} quiz questions`);
    const counts = this.powerPath.getQuestionCounts();
    console.log(`📊 Quiz difficulty distribution: Easy=${counts.easy}, Medium=${counts.medium}, Hard=${counts.hard}`);

    this.isInGuidingPhase = true;
    this._currentFullGameQuestion = 0;
    this.currentSectionQuestion = 0;
    
    // Reset tile results tracking
    this.currentTileGuidingResults = [];
    this.currentTileQuizResults = [];

    // Load first question using PowerPath
    this.loadNextPowerPathQuestion();
    this.showScreen('reading-screen');
  }
  
  /**
   * Start the PowerPath timer for time tracking
   */
  private startPowerPathTimer(): void {
    // Clear any existing timer
    if (this.powerPathTimerInterval) {
      window.clearInterval(this.powerPathTimerInterval);
    }
    
    // Update time display every second
    this.powerPathTimerInterval = window.setInterval(() => {
      const elapsed = Date.now() - this.powerPathStartTime;
      const timeEl = document.getElementById('pp-time');
      if (timeEl) {
        timeEl.textContent = this.formatTime(elapsed);
      }
    }, 1000);
  }
  
  /**
   * Stop the PowerPath timer
   */
  private stopPowerPathTimer(): void {
    if (this.powerPathTimerInterval) {
      window.clearInterval(this.powerPathTimerInterval);
      this.powerPathTimerInterval = null;
    }
  }
  
  /**
   * Format milliseconds to HH:MM:SS
   */
  private formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  
  /**
   * Update PowerPath 100 UI elements
   */
  private updatePowerPathUI(stats: PowerPathStats): void {
    // Update score
    const scoreEl = document.getElementById('pp-score');
    if (scoreEl) {
      scoreEl.textContent = stats.score.toString();
    }
    
    // Update questions answered
    const questionsEl = document.getElementById('pp-questions');
    if (questionsEl) {
      questionsEl.textContent = stats.questionsAnswered.toString();
    }
    
    // Update accuracy
    const accuracyEl = document.getElementById('pp-accuracy');
    if (accuracyEl) {
      accuracyEl.textContent = `${stats.accuracy}%`;
    }
    
    // Update accuracy bar
    const accuracyFill = document.getElementById('pp-accuracy-fill');
    if (accuracyFill) {
      accuracyFill.style.width = `${stats.accuracy}%`;
    }
    
    // Update time
    const timeEl = document.getElementById('pp-time');
    if (timeEl) {
      timeEl.textContent = stats.timeElapsed;
    }
  }
  
  /**
   * Load the next question from PowerPath algorithm
   */
  private loadNextPowerPathQuestion(): void {
    if (!this.powerPath) {
      console.error('PowerPath not initialized');
      return;
    }
    
    // Check if PowerPath is complete (score >= 100)
    if (this.powerPath.isComplete()) {
      console.log('🎉 PowerPath 100 complete!');
      this.stopPowerPathTimer();
      this.showTileResults();
      return;
    }
    
    // Get next question from PowerPath
    const nextQuestion = this.powerPath.getNextQuestion();
    
    if (!nextQuestion) {
      console.log('No more questions available');
      this.stopPowerPathTimer();
      this.showTileResults();
      return;
    }
    
    this.currentPowerPathQuestion = nextQuestion;
    const phase = this.powerPath.getCurrentPhase();
    this.isInGuidingPhase = phase === 'guiding';
    
    // Update passage title
    const titleEl = document.getElementById('passage-title');
    if (titleEl) titleEl.textContent = this.currentArticleTitle;
    
    // Update passage content based on phase
    const contentEl = document.getElementById('passage-content');
    
    if (this.isInGuidingPhase) {
      // Progressive passage reveal for guiding questions
      // Find which section index this guiding question corresponds to
      const guidingIndex = this.guidingQuestions.findIndex(q => q.id === nextQuestion.id);
      this.currentSectionQuestion = guidingIndex >= 0 ? guidingIndex : 0;
      
      if (contentEl) {
        contentEl.innerHTML = this.buildProgressivePassage(this.currentSectionQuestion);
      }
      this.scrollToCurrentSection();
      
      // Show timer for guiding questions if enabled
      if (this.readingTimerEnabled && this.readingTimerOnlyGuiding) {
        this.startReadingTimer(() => {
          this.renderPowerPathQuestion(nextQuestion, phase);
        });
      } else {
        this.renderPowerPathQuestion(nextQuestion, phase);
      }
    } else {
      // Full passage for quiz phase
      if (contentEl) {
        contentEl.innerHTML = this.buildFullPassage();
      }
      
      // Show quiz question directly (no timer for quiz)
      document.getElementById('activity-timer-panel')?.classList.remove('active');
      document.getElementById('question-content')?.classList.remove('hidden');
      
      this.renderPowerPathQuestion(nextQuestion, phase);
    }
  }
  
  /**
   * Render a PowerPath question
   */
  private renderPowerPathQuestion(question: PowerPathQuestion, phase: 'guiding' | 'quiz'): void {
    const promptEl = document.getElementById('question-prompt');
    const choicesEl = document.getElementById('choices-container');
    const confirmBtn = document.getElementById('confirm-btn') as HTMLButtonElement;
    
    // Get stats for display
    const stats = this.powerPath?.getStats();
    const questionNum = stats?.questionsAnswered ? stats.questionsAnswered + 1 : 1;
    
    // Build question text with phase indicator
    let phaseLabel = '';
    if (phase === 'guiding') {
      const guidingIndex = this.guidingQuestions.findIndex(q => q.id === question.id);
      phaseLabel = `📖 Guiding Question ${guidingIndex + 1} of ${this.guidingQuestions.length}`;
    } else {
      const difficulty = question.difficulty.charAt(0).toUpperCase() + question.difficulty.slice(1);
      phaseLabel = `🎯 Quiz Question (${difficulty})`;
    }
    
    if (promptEl) {
      promptEl.innerHTML = `<span class="phase-label">${phaseLabel}</span><br>${question.prompt}`;
    }
    if (confirmBtn) confirmBtn.disabled = true;
    
    if (choicesEl) {
      choicesEl.innerHTML = '';
      question.choices.forEach((choice, index) => {
        const btn = document.createElement('button');
        btn.className = 'choice-btn';
        btn.textContent = choice.text;
        btn.addEventListener('click', () => this.selectAnswer(choice, index));
        choicesEl.appendChild(btn);
      });
    }
    
    // Show question content, hide timer
    document.getElementById('activity-timer-panel')?.classList.remove('active');
    document.getElementById('question-content')?.classList.remove('hidden');
  }

  /**
   * Load a question (guiding or quiz) for the article tile
   * Handles both phases: progressive sections for guiding, full passage for quiz
   */
  private loadArticleQuestion(questionIndex: number): void {
    const totalGuiding = this.guidingQuestions.length;
    const totalQuiz = this._quizQuestions.length;

    if (questionIndex < totalGuiding) {
      // GUIDING PHASE: Progressive section reveal
      this.isInGuidingPhase = true;
      this.currentSectionQuestion = questionIndex;

      // Update passage title
      const titleEl = document.getElementById('passage-title');
      if (titleEl) titleEl.textContent = this.currentArticleTitle;

      // Build progressive passage (sections 0 through questionIndex)
      const contentEl = document.getElementById('passage-content');
      if (contentEl) {
        contentEl.innerHTML = this.buildProgressivePassage(questionIndex);
      }

      // Auto-scroll to current section
      this.scrollToCurrentSection();

      // Show timer or question
      if (this.readingTimerEnabled && this.readingTimerOnlyGuiding) {
        this.startReadingTimer(() => {
          this.renderGuidingQuestion(questionIndex);
        });
      } else {
        this.renderGuidingQuestion(questionIndex);
      }

    } else {
      // QUIZ PHASE: Full passage shown, quiz questions
      this.isInGuidingPhase = false;
      const quizIndex = questionIndex - totalGuiding;

      if (quizIndex >= totalQuiz) {
        // All questions done - show tile results
        this.showTileResults();
        return;
      }

      // Update passage title
      const titleEl = document.getElementById('passage-title');
      if (titleEl) titleEl.textContent = this.currentArticleTitle;

      // Show FULL passage for quiz phase
      const contentEl = document.getElementById('passage-content');
      if (contentEl) {
        contentEl.innerHTML = this.buildFullPassage();
      }

      // Show quiz question directly (no timer for quiz if onlyForGuidingQuestions)
      document.getElementById('activity-timer-panel')?.classList.remove('active');
      document.getElementById('question-content')?.classList.remove('hidden');

      this.renderQuizQuestion(quizIndex, totalQuiz);
    }
  }

  /**
   * Build progressive passage HTML - shows sections up to current question
   * with the current section highlighted
   */
  private buildProgressivePassage(sectionsUpTo: number): string {
    let passageHTML = '';
    
    for (let i = 0; i <= sectionsUpTo && i < this.sectionsForArticle.length; i++) {
      const section = this.sectionsForArticle[i];
      
      // Add section divider between sections
      if (i > 0) {
        passageHTML += '<hr class="section-divider">';
      }
      
      // Strip title from first section content
      let content = section.content;
      if (i === 0 && this.currentArticleTitle) {
        content = this.stripTitleFromContent(content, this.currentArticleTitle);
      }
      
      // Mark current (latest) section for highlighting and auto-scroll
      const isCurrentSection = (i === sectionsUpTo);
      const sectionId = isCurrentSection ? 'id="current-section"' : '';
      const currentClass = isCurrentSection ? ' current' : '';
      
      passageHTML += `<p ${sectionId} class="section-paragraph${currentClass}">${content}</p>`;
    }
    
    return passageHTML;
  }

  /**
   * Build full passage HTML - all sections for quiz phase
   */
  private buildFullPassage(): string {
    let passageHTML = '';
    
    for (let i = 0; i < this.sectionsForArticle.length; i++) {
      const section = this.sectionsForArticle[i];
      
      // Add section divider between sections
      if (i > 0) {
        passageHTML += '<hr class="section-divider">';
      }
      
      // Strip title from first section content
      let content = section.content;
      if (i === 0 && this.currentArticleTitle) {
        content = this.stripTitleFromContent(content, this.currentArticleTitle);
      }
      
      passageHTML += `<p>${content}</p>`;
    }
    
    return passageHTML;
  }

  /**
   * Render a guiding question with question number
   */
  private renderGuidingQuestion(questionIndex: number): void {
    const question = this.guidingQuestions[questionIndex];
    const totalQuestions = this.guidingQuestions.length;

    const promptEl = document.getElementById('question-prompt');
    const choicesEl = document.getElementById('choices-container');
    const confirmBtn = document.getElementById('confirm-btn') as HTMLButtonElement;

    if (promptEl) {
      promptEl.textContent = `Guiding Question ${questionIndex + 1} of ${totalQuestions}: ${question.prompt}`;
    }
    if (confirmBtn) confirmBtn.disabled = true;

    if (choicesEl) {
      choicesEl.innerHTML = '';
      question.choices.forEach((choice, index) => {
        const btn = document.createElement('button');
        btn.className = 'choice-btn';
        btn.textContent = choice.text;
        btn.addEventListener('click', () => this.selectAnswer(choice, index));
        choicesEl.appendChild(btn);
      });
    }

    // Show question content, hide timer
    document.getElementById('activity-timer-panel')?.classList.remove('active');
    document.getElementById('question-content')?.classList.remove('hidden');
  }

  /**
   * Render a quiz question with question number
   */
  private renderQuizQuestion(quizIndex: number, totalQuiz: number): void {
    const question = this._quizQuestions[quizIndex];

    const promptEl = document.getElementById('question-prompt');
    const choicesEl = document.getElementById('choices-container');
    const confirmBtn = document.getElementById('confirm-btn') as HTMLButtonElement;

    if (promptEl) {
      promptEl.textContent = `Final Quiz ${quizIndex + 1} of ${totalQuiz}: ${question.prompt}`;
    }
    if (confirmBtn) confirmBtn.disabled = true;

    if (choicesEl) {
      choicesEl.innerHTML = '';
      question.choices.forEach((choice, index) => {
        const btn = document.createElement('button');
        btn.className = 'choice-btn';
        btn.textContent = choice.text;
        btn.addEventListener('click', () => this.selectAnswer(choice, index));
        choicesEl.appendChild(btn);
      });
    }
  }

  /**
   * Scroll to the current section in the passage panel
   */
  private scrollToCurrentSection(): void {
    setTimeout(() => {
      const currentSection = document.getElementById('current-section');
      const passagePanel = document.querySelector('.passage-panel');
      
      if (currentSection && passagePanel) {
        currentSection.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'start'
        });
      }
    }, 100);
  }

  private renderPassage(section: Section): void {
    const titleEl = document.getElementById('passage-title');
    const contentEl = document.getElementById('passage-content');
    
    if (titleEl) titleEl.textContent = section.title;
    
    if (contentEl) {
      // Strip article title from first section content
      let content = section.content;
      if (section.sectionNumber === 1 && this.currentArticleTitle) {
        content = this.stripTitleFromContent(content, this.currentArticleTitle);
      }
      
      const paragraphs = content.split('\n').filter(p => p.trim());
      contentEl.innerHTML = paragraphs.map(p => `<p>${p}</p>`).join('');
    }
  }

  private stripTitleFromContent(content: string, title: string): string {
    // Remove title from beginning of content (case-insensitive)
    const titleLower = title.toLowerCase().trim();
    const contentLower = content.toLowerCase().trim();
    
    if (contentLower.startsWith(titleLower)) {
      return content.substring(title.length).trim();
    }
    return content;
  }

  private renderQuestion(question: QuizQuestion): void {
    const promptEl = document.getElementById('question-prompt');
    const choicesEl = document.getElementById('choices-container');
    const confirmBtn = document.getElementById('confirm-btn') as HTMLButtonElement;
    
    if (promptEl) promptEl.textContent = question.prompt;
    if (confirmBtn) confirmBtn.disabled = true;
    
    if (choicesEl) {
      choicesEl.innerHTML = '';
      question.choices.forEach((choice, index) => {
        const btn = document.createElement('button');
        btn.className = 'choice-btn';
        btn.textContent = choice.text;
        btn.addEventListener('click', () => this.selectAnswer(choice, index));
        choicesEl.appendChild(btn);
      });
    }

    // Show question content, hide timer
    document.getElementById('activity-timer-panel')?.classList.remove('active');
    document.getElementById('question-content')?.classList.remove('hidden');
  }

  private selectAnswer(choice: Choice, _index: number): void {
    this.selectedAnswer = choice;
    
    // Highlight selected answer
    const buttons = document.querySelectorAll('#choices-container .choice-btn');
    buttons.forEach(btn => btn.classList.remove('selected'));
    buttons[_index]?.classList.add('selected');
    
    // Enable confirm button
    const confirmBtn = document.getElementById('confirm-btn') as HTMLButtonElement;
    if (confirmBtn) confirmBtn.disabled = false;
  }

  confirmAnswer(): void {
    if (!this.selectedAnswer) return;

    const isCorrect = this.selectedAnswer.correct;
    
    // Use PowerPath 100 for scoring if available
    if (this.powerPath && this.currentPowerPathQuestion) {
      const scoreChange = this.powerPath.recordAnswer(this.currentPowerPathQuestion.id, isCorrect);
      console.log(`📊 PowerPath: ${isCorrect ? '✅' : '❌'} Score change: ${scoreChange > 0 ? '+' : ''}${scoreChange}, New score: ${this.powerPath.getStats().score}`);
    } else {
      // Fallback to legacy scoring
      if (isCorrect) this.score++;
    }

    // Track result for tile results
    if (this.isInGuidingPhase) {
      this.currentTileGuidingResults.push({ correct: isCorrect });
    } else {
      this.currentTileQuizResults.push({ correct: isCorrect });
    }

    // Disable choices
    if (this.config.feedbackSettings.disableChoicesAfterSelection) {
      const buttons = document.querySelectorAll('#choices-container .choice-btn');
      buttons.forEach(btn => {
        (btn as HTMLButtonElement).disabled = true;
      });
    }

    // Show feedback
    this.showFeedback(this.selectedAnswer);
  }

  private showFeedback(choice: Choice): void {
    const modal = document.getElementById('feedback-modal');
    const content = document.getElementById('feedback-content');
    const icon = document.getElementById('feedback-icon');
    const title = document.getElementById('feedback-title');
    const text = document.getElementById('feedback-text');

    if (!modal || !content || !icon || !title || !text) return;

    const isCorrect = choice.correct;
    const { feedbackIcons, feedbackTitles } = this.config.feedbackSettings;

    content.classList.remove('correct', 'incorrect');
    content.classList.add(isCorrect ? 'correct' : 'incorrect');
    
    icon.textContent = isCorrect ? feedbackIcons.correct : feedbackIcons.incorrect;
    title.textContent = isCorrect ? feedbackTitles.correct : feedbackTitles.incorrect;
    text.textContent = choice.feedback || (isCorrect ? 'Great job!' : 'Try to find the evidence in the text next time.');

    modal.classList.add('show');
  }

  closeFeedback(): void {
    const modal = document.getElementById('feedback-modal');
    if (modal) modal.classList.remove('show');

    this.selectedAnswer = null;

    // If PowerPath is active, use it to get next question
    if (this.powerPath) {
      this.loadNextPowerPathQuestion();
      return;
    }

    // Legacy mode: Check if we're in article-per-tile mode (one-article-per-tile)
    // This is indicated by having sectionsForArticle populated with multiple sections AND quiz questions
    const isArticlePerTileMode = this.sectionsForArticle.length > 1 || this._quizQuestions.length > 0;

    if (isArticlePerTileMode) {
      // Article-per-tile mode: advance through guiding + quiz questions
      this._currentFullGameQuestion++;
      this.loadArticleQuestion(this._currentFullGameQuestion);
    } else if (this.isInGuidingPhase) {
      // Section-per-tile mode (guiding phase)
      this.currentSectionQuestion++;
      if (this.currentSectionQuestion >= this.guidingQuestions.length) {
        // Done with guiding questions - show tile results
        this.showTileResults();
      } else {
        this.renderQuestion(this.guidingQuestions[this.currentSectionQuestion]);
      }
    } else {
      // Quiz screen mode - handled by nextQuizQuestion
      const nextBtn = document.getElementById('quiz-next-btn') as HTMLButtonElement;
      if (nextBtn) nextBtn.disabled = false;
    }
  }

  private showTileResults(): void {
    this.state = 'TILE_RESULTS';
    
    // Exit reading mode so celebration sounds can play
    soundManager.exitReadingMode();
    
    // Stop PowerPath timer if running
    this.stopPowerPathTimer();
    
    // Get stats from PowerPath if available
    let totalQuestions: number;
    let totalCorrect: number;
    let accuracy: number;
    let powerPathScore: number = 0;
    let passed: boolean;
    
    if (this.powerPath) {
      const stats = this.powerPath.getStats();
      totalQuestions = stats.questionsAnswered;
      accuracy = stats.accuracy;
      powerPathScore = stats.score;
      totalCorrect = Math.round((stats.accuracy / 100) * totalQuestions);
      
      // With PowerPath, "passed" means reaching score of 100
      passed = stats.isComplete;
      
      console.log(`🏁 PowerPath results: Score=${powerPathScore}, Questions=${totalQuestions}, Accuracy=${accuracy}%, Passed=${passed}`);
    } else {
      // Legacy mode
      const totalGuiding = this.currentTileGuidingResults.length;
      const correctGuiding = this.currentTileGuidingResults.filter(r => r.correct).length;
      const totalQuiz = this.currentTileQuizResults.length;
      const correctQuiz = this.currentTileQuizResults.filter(r => r.correct).length;
      totalQuestions = totalGuiding + totalQuiz;
      totalCorrect = correctGuiding + correctQuiz;
      accuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;
      
      const passThreshold = this.config.gameFlow.passThresholdPercent || 90;
      passed = accuracy >= passThreshold;
    }
    
    // Update UI elements
    const articleEl = document.getElementById('tile-results-article');
    if (articleEl) articleEl.textContent = this.currentArticleTitle;
    
    const correctCountEl = document.getElementById('tile-correct-count');
    if (correctCountEl) correctCountEl.textContent = `${totalCorrect} of ${totalQuestions}`;
    
    const accuracyEl = document.getElementById('tile-accuracy');
    if (accuracyEl) {
      if (this.powerPath) {
        accuracyEl.textContent = `${accuracy}% (Score: ${powerPathScore}/100)`;
      } else {
        accuracyEl.textContent = `${accuracy}%`;
      }
    }
    
    // Render result boxes
    this.renderResultBoxes('guiding-results-boxes', this.currentTileGuidingResults);
    this.renderResultBoxes('quiz-results-boxes', this.currentTileQuizResults);
    
    // Show/hide quiz section
    const quizSection = document.getElementById('quiz-results-section');
    const totalQuizCount = this.currentTileQuizResults.length;
    if (quizSection) {
      quizSection.style.display = totalQuizCount > 0 ? 'block' : 'none';
    }
    
    // Update pass/fail status
    const passFailStatus = document.getElementById('pass-fail-status');
    const passFailIcon = document.getElementById('pass-fail-icon');
    const passFailText = document.getElementById('pass-fail-text');
    const resultsContent = document.getElementById('tile-results-content');
    const resultsTitle = document.getElementById('tile-results-title');
    
    if (passFailStatus && passFailIcon && passFailText && resultsContent && resultsTitle) {
      passFailStatus.classList.remove('passed', 'failed');
      resultsContent.classList.remove('passed', 'failed');
      
      if (passed) {
        passFailStatus.classList.add('passed');
        resultsContent.classList.add('passed');
        passFailIcon.textContent = '✓';
        
        // Play celebration sound for passing!
        soundManager.play('success');
        
        if (this.powerPath) {
          passFailText.textContent = `🚀 PowerPath 100 Complete! Score: ${powerPathScore}`;
          resultsTitle.textContent = '🎉 Mission Accomplished!';
        } else {
          const passThreshold = this.config.gameFlow.passThresholdPercent || 90;
          passFailText.textContent = `You passed! (${passThreshold}% required)`;
          resultsTitle.textContent = '🎉 Great Job!';
        }
      } else {
        passFailStatus.classList.add('failed');
        resultsContent.classList.add('failed');
        passFailIcon.textContent = '✗';
        
        if (this.powerPath) {
          passFailText.textContent = `Keep going! Score: ${powerPathScore}/100. Try again to reach 100!`;
          resultsTitle.textContent = '🚀 Almost There!';
        } else {
          const passThreshold = this.config.gameFlow.passThresholdPercent || 90;
          passFailText.textContent = `Need ${passThreshold}% to unlock. Try again!`;
          resultsTitle.textContent = '📊 Keep Practicing!';
        }
      }
    }
    
    this.hideAllScreens();
    this.showScreen('tile-results-screen');
  }

  private renderResultBoxes(containerId: string, results: QuestionResult[]): void {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = '';
    results.forEach((result, index) => {
      const box = document.createElement('div');
      box.className = `result-box ${result.correct ? 'correct' : 'incorrect'}`;
      box.innerHTML = `
        <span class="box-number">${index + 1}</span>
        <span class="box-check">${result.correct ? '✓' : '✗'}</span>
      `;
      container.appendChild(box);
    });
  }

  continueTileResults(): void {
    // Calculate accuracy
    const totalGuiding = this.currentTileGuidingResults.length;
    const correctGuiding = this.currentTileGuidingResults.filter(r => r.correct).length;
    const totalQuiz = this.currentTileQuizResults.length;
    const correctQuiz = this.currentTileQuizResults.filter(r => r.correct).length;
    const totalQuestions = totalGuiding + totalQuiz;
    const totalCorrect = correctGuiding + correctQuiz;
    const accuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;
    
    const passThreshold = this.config.gameFlow.passThresholdPercent || 90;
    const passed = accuracy >= passThreshold;
    
    // Mark tile as completed
    this.tilesCompleted[this.currentTile] = true;
    
    // Get tile element
    const tileElement = document.querySelector(`#tiles-overlay [data-tile-index="${this.currentTile}"]`);
    
    if (passed && this.config.visualSettings.completedTile.removeBlur) {
      tileElement?.classList.remove('locked');
      tileElement?.classList.add('completed');
      
      if (this.config.visualSettings.completedTile.showCheckmark) {
        const checkmark = document.createElement('div');
        checkmark.className = 'completion-checkmark';
        checkmark.textContent = this.config.visualSettings.completedTile.checkmarkIcon || '✓';
        tileElement?.appendChild(checkmark);
      }
      
      console.log(`✅ Tile ${this.currentTile} PASSED with ${accuracy}% (threshold: ${passThreshold}%)`);
    } else {
      tileElement?.classList.add('attempted');
      console.log(`❌ Tile ${this.currentTile} did not pass: ${accuracy}% (threshold: ${passThreshold}%)`);
    }
    
    // Unlock next tile if linear progression (remove lock icon only, NOT the blur)
    // The next tile stays blurred but becomes clickable
    if (this.config.gameFlow.linearProgression && this.currentTile < this.activeTiles.length - 1) {
      // Remove lock icon (makes it look clickable)
      const nextLockIcon = document.querySelector(`#locks-overlay [data-tile-index="${this.currentTile + 1}"]`);
      if (nextLockIcon) nextLockIcon.classList.remove('visible');
      
      // Remove not-clickable class (changes cursor to pointer)
      // BUT keep the 'locked' class (blur stays until they pass that tile)
      const nextTile = document.querySelector(`#tiles-overlay [data-tile-index="${this.currentTile + 1}"]`);
      nextTile?.classList.remove('not-clickable');
    }
    
    this.backToBoard();
  }

  backToBoard(): void {
    // Clear timer
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    
    // Reset timer UI
    document.getElementById('activity-timer-panel')?.classList.remove('active');
    document.getElementById('question-content')?.classList.remove('hidden');
    
    // Exit reading mode (enables sounds again)
    soundManager.exitReadingMode();
    
    // Play whoosh transition sound
    soundManager.play('whoosh');
    
    this.state = 'BOARD';
    this.hideAllScreens();
  }

  private loadQuizIntro(articleIndex: number): void {
    this.state = 'QUIZ_INTRO';
    this._currentArticleIndex = articleIndex;
    
    // Get sections and quiz for this article
    const sectionsForArticle = this.storyData.sections.filter(s => 
      s.articleIndex === articleIndex
    );
    const quizForArticle = this.storyData.quizQuestions.filter(q => 
      q.articleIndex === articleIndex
    );
    
    const articleTitle = this.storyData.articles 
      ? this.storyData.articles[articleIndex].title
      : this.storyData.title;
    
    // Combine sections for full passage
    let fullPassage = '';
    sectionsForArticle.forEach((section, idx) => {
      let content = section.content;
      if (idx === 0) {
        content = this.stripTitleFromContent(content, articleTitle);
      }
      fullPassage += content + '\n\n';
    });
    
    const paragraphs = fullPassage.split('\n').filter(p => p.trim()).map(p => `<p>${p}</p>`).join('');
    const fullPassageEl = document.getElementById('full-passage-content');
    if (fullPassageEl) fullPassageEl.innerHTML = paragraphs;
    
    // Build quiz questions
    const quizContainer = document.getElementById('quiz-questions-container');
    if (quizContainer) {
      quizContainer.innerHTML = '';
      this.currentTileQuizQuestions = quizForArticle;
      
      quizForArticle.forEach((question, qIndex) => {
        const questionDiv = document.createElement('div');
        questionDiv.className = 'quiz-question';
        questionDiv.id = `quiz-question-${qIndex}`;
        
        const progressDiv = document.createElement('div');
        progressDiv.className = 'progress-indicator';
        progressDiv.textContent = `Question ${qIndex + 1} of ${quizForArticle.length}`;
        
        const promptH3 = document.createElement('h3');
        promptH3.textContent = question.prompt;
        
        const choicesDiv = document.createElement('div');
        choicesDiv.className = 'quiz-choices';
        
        question.choices.forEach((choice, cIndex) => {
          const btn = document.createElement('button');
          btn.className = 'choice-btn';
          btn.textContent = choice.text;
          btn.addEventListener('click', () => this.selectQuizAnswer(qIndex, cIndex, choice));
          choicesDiv.appendChild(btn);
        });
        
        questionDiv.appendChild(progressDiv);
        questionDiv.appendChild(promptH3);
        questionDiv.appendChild(choicesDiv);
        quizContainer.appendChild(questionDiv);
      });
    }
    
    const quizIntro = document.getElementById('quiz-intro');
    const quizNav = document.getElementById('quiz-nav');
    if (quizIntro) quizIntro.style.display = 'block';
    if (quizNav) quizNav.style.display = 'none';
    
    this.currentQuizQuestion = 0;
    this.showScreen('quiz-screen');
  }

  startQuiz(): void {
    const quizIntro = document.getElementById('quiz-intro');
    const quizNav = document.getElementById('quiz-nav');
    const nextBtn = document.getElementById('quiz-next-btn') as HTMLButtonElement;
    
    if (quizIntro) quizIntro.style.display = 'none';
    if (quizNav) quizNav.style.display = 'flex';
    if (nextBtn) nextBtn.disabled = true;
    
    this.state = 'QUIZ_QUESTION';
    this.isInGuidingPhase = false;
    this.showQuizQuestion(0);
  }

  private showQuizQuestion(index: number): void {
    const questions = document.querySelectorAll('.quiz-question');
    questions.forEach((q, i) => {
      q.classList.toggle('active', i === index);
    });
  }

  private selectQuizAnswer(questionIndex: number, choiceIndex: number, choice: Choice): void {
    const questionDiv = document.getElementById(`quiz-question-${questionIndex}`);
    if (!questionDiv) return;
    
    const buttons = questionDiv.querySelectorAll('.choice-btn');
    buttons.forEach(btn => btn.classList.remove('selected'));
    buttons[choiceIndex]?.classList.add('selected');
    
    this.selectedAnswer = choice;
    this.showFeedback(choice);
    
    // Track quiz result
    const isCorrect = choice.correct;
    if (isCorrect) this.score++;
    this.currentTileQuizResults.push({ correct: isCorrect });
  }

  nextQuizQuestion(): void {
    this.currentQuizQuestion++;
    
    const totalQuizQuestions = this.currentTileQuizQuestions.length;
    
    if (this.currentQuizQuestion < totalQuizQuestions) {
      this.showQuizQuestion(this.currentQuizQuestion);
      const nextBtn = document.getElementById('quiz-next-btn') as HTMLButtonElement;
      if (nextBtn) nextBtn.disabled = true;
      this.selectedAnswer = null;
      
      if (this.currentQuizQuestion === totalQuizQuestions - 1) {
        if (this.currentTile === this.activeTiles.length - 1) {
          nextBtn.textContent = 'Finish';
        }
      }
    } else {
      // Done with quiz tile
      this.tilesCompleted[this.currentTile] = true;
      
      if (this.currentTile === this.activeTiles.length - 1) {
        this.showResults();
      } else {
        this.showTileResults();
      }
    }
  }

  private showResults(): void {
    this.state = 'RESULTS';
    
    const scoreDisplay = document.getElementById('final-score');
    const message = document.getElementById('score-message');
    
    if (scoreDisplay) scoreDisplay.textContent = `${this.score}/${this.totalQuestions}`;
    
    // Get message based on percentage
    const percentage = (this.score / this.totalQuestions) * 100;
    const scoreMessages = this.config.scoringSettings.scoreMessages;
    const sortedMessages = [...scoreMessages].sort((a, b) => b.minPercentage - a.minPercentage);
    const messageObj = sortedMessages.find(m => percentage >= m.minPercentage);
    if (message) message.textContent = messageObj?.message || 'Great effort!';
    
    // Exit reading mode and play celebration sound
    soundManager.exitReadingMode();
    soundManager.play('success');
    
    this.hideAllScreens();
    this.showScreen('results-screen');
    
    if (this.config.confettiSettings.enabled) {
      const canvas = document.getElementById('confetti-canvas') as HTMLCanvasElement;
      if (canvas) startConfetti(canvas, this.config.confettiSettings);
    }
  }

  playAgain(): void {
    location.reload();
  }

  skipTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    
    const timerPanel = document.getElementById('activity-timer-panel');
    const questionContent = document.getElementById('question-content');
    
    if (timerPanel) timerPanel.classList.remove('active');
    if (questionContent) questionContent.classList.remove('hidden');
    
    // Show the question
    if (this.guidingQuestions.length > 0) {
      this.renderQuestion(this.guidingQuestions[this.currentSectionQuestion]);
    }
  }

  private startReadingTimer(onComplete: () => void): void {
    this.currentTimerValue = this.readingTimerDuration;
    
    const timerPanel = document.getElementById('activity-timer-panel');
    const questionContent = document.getElementById('question-content');
    const countdownEl = document.getElementById('timer-countdown');
    const continueBtn = document.getElementById('timer-continue-btn') as HTMLButtonElement;
    
    if (timerPanel) timerPanel.classList.add('active');
    if (questionContent) questionContent.classList.add('hidden');
    if (countdownEl) countdownEl.textContent = this.currentTimerValue.toString();
    if (continueBtn) {
      continueBtn.disabled = !this.readingTimerAllowSkip;
      continueBtn.style.display = this.readingTimerAllowSkip ? 'block' : 'none';
    }
    
    this.timerInterval = window.setInterval(() => {
      this.currentTimerValue--;
      if (countdownEl) countdownEl.textContent = this.currentTimerValue.toString();
      
      if (this.currentTimerValue <= 0) {
        if (this.timerInterval) {
          clearInterval(this.timerInterval);
          this.timerInterval = null;
        }
        if (timerPanel) timerPanel.classList.remove('active');
        if (questionContent) questionContent.classList.remove('hidden');
        onComplete();
      }
    }, 1000);
  }

  private showScreen(screenId: string): void {
    this.hideAllScreens();
    const screen = document.getElementById(screenId);
    if (screen) screen.classList.add('active');
    
    // Hide HOME button when showing any overlay screen (not on board)
    const homeBtn = document.getElementById('back-home-btn');
    if (homeBtn) homeBtn.style.display = 'none';
  }

  private hideAllScreens(): void {
    const screens = document.querySelectorAll('.screen');
    screens.forEach(screen => screen.classList.remove('active'));
    
    // Show HOME button when returning to board screen
    const homeBtn = document.getElementById('back-home-btn');
    if (homeBtn) homeBtn.style.display = 'flex';
  }

  // Public getters for external access
  getScore(): number {
    return this.score;
  }

  getTotalQuestions(): number {
    return this.totalQuestions;
  }

  getActiveTiles(): ActiveTile[] {
    return this.activeTiles;
  }
}

