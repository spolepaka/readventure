/**
 * Game Configuration Types
 */

export interface GridSize {
  rows: number;
  columns: number;
  description?: string;
}

export interface GridAlignment {
  width: string;
  height: string;
  top: string;
  left: string;
  gap: string;
  description?: string;
}

export interface ContentGranularity {
  mode: 'one-section-per-tile' | 'one-article-per-tile' | 'one-question-per-tile' | 'all-questions-one-tile' | 'full-text-per-tile' | 'custom';
  description?: string;
  modes?: Record<string, string>;
  numberOfSectionTiles: number;
  numberOfQuizTiles: number;
  showFullPassageBeforeQuiz: boolean;
}

export interface TileLayout {
  gridSize: GridSize;
  tilePathPattern: 'linear-horizontal' | 'linear-vertical' | 'snake' | 'spiral';
  description?: string;
  availablePatterns?: Record<string, string>;
  gridAlignment: GridAlignment;
}

export interface GameFlow {
  linearProgression: boolean;
  description?: string;
  allowSkipTiles: boolean;
  requireCorrectAnswerToProgress: boolean;
  showScoreDuringGame: boolean;
  firstTileUnlockedOnStart: boolean;
  enableBackButton: boolean;
  passThresholdPercent: number;
  passThresholdDescription?: string;
}

export interface LockedTileSettings {
  blurAmount: string;
  brightness: number;
  backgroundColor: string;
  showLockIcon: boolean;
  lockIcon: string;
  lockIconSize: string;
  lockIconColor: string;
}

export interface CompletedTileSettings {
  removeBlur: boolean;
  showCheckmark: boolean;
  checkmarkIcon?: string;
}

export interface HoverEffect {
  enabled: boolean;
  scale: number;
  transitionDuration: string;
}

export interface TileStyle {
  borderRadius: string;
  cursor: string;
  cursorLocked: string;
}

export interface VisualSettings {
  lockedTile: LockedTileSettings;
  completedTile: CompletedTileSettings;
  hoverEffect: HoverEffect;
  tileStyle: TileStyle;
}

export interface ScoreMessage {
  minPercentage: number;
  message: string;
}

export interface ScoringSettings {
  totalQuestionsCalculation: 'auto' | number;
  description?: string;
  scoreMessages: ScoreMessage[];
  showPercentageScore: boolean;
  showNumericScore: boolean;
}

export interface FeedbackIcons {
  correct: string;
  incorrect: string;
}

export interface FeedbackTitles {
  correct: string;
  incorrect: string;
}

export interface FeedbackSettings {
  showFeedbackModal: boolean;
  modalAnimation: string;
  feedbackIcons: FeedbackIcons;
  feedbackTitles: FeedbackTitles;
  disableChoicesAfterSelection: boolean;
  highlightSelectedAnswer: boolean;
}

export interface ReadingTimerSettings {
  enabled: boolean;
  durationSeconds: number;
  allowSkip: boolean;
  onlyForGuidingQuestions: boolean;
  description?: string;
}

export interface ParticleSize {
  min: number;
  max: number;
}

export interface ConfettiSettings {
  enabled: boolean;
  particleCount: number;
  duration: number;
  colors: string[];
  particleSize: ParticleSize;
}

export interface Assets {
  boardImage: string;
  boardImageAlt?: string;
}

export interface ThemeColors {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
  correctColor: string;
  incorrectColor: string;
  infoColor: string;
  quizColor: string;
}

export interface UISettings {
  theme: ThemeColors;
  fontFamily: string;
  buttonStyle: string;
  borderStyle: string;
}

export interface AccessibilitySettings {
  keyboardNavigation: boolean;
  screenReaderSupport: boolean;
  highContrastMode: boolean;
  focusIndicators: boolean;
  description?: string;
}

export interface DebugSettings {
  showGridBorders: boolean;
  showTileIndices: boolean;
  logStateChanges: boolean;
  testMode: boolean;
  testModeHotkey: string;
}

export interface DataSource {
  type: 'external' | 'internal';
  description?: string;
  qtiDataPath: string;
  startingArticleId: string;
  autoLoadMode: 'fill-grid' | 'manual';
  description_autoLoadMode?: string;
  maxArticles: number;
  description_maxArticles?: string;
  articleSequence?: string[];
}

export interface GameConfig {
  gameVersion: string;
  gameName: string;
  currentTheme: string;
  contentGranularity: ContentGranularity;
  tileLayout: TileLayout;
  gameFlow: GameFlow;
  visualSettings: VisualSettings;
  scoringSettings: ScoringSettings;
  feedbackSettings: FeedbackSettings;
  readingTimerSettings: ReadingTimerSettings;
  confettiSettings: ConfettiSettings;
  assets: Assets;
  ui: UISettings;
  accessibility: AccessibilitySettings;
  debug: DebugSettings;
  dataSource: DataSource;
}

/**
 * QTI Data Types
 */

export interface Choice {
  id: string;
  identifier?: string;
  text: string;
  feedback: string;
  correct: boolean;
}

export interface SectionMetadata {
  itemId: string;
  dok?: number;
  difficulty?: string;
  ccss?: string;
}

export interface Section {
  id: number;
  identifier: string;
  title: string;
  sectionNumber?: number;
  lexileLevel?: number;
  content: string;
  contentHtml?: string;
  question: string;
  choices: Choice[];
  metadata: SectionMetadata;
  articleIndex?: number;
  articleTitle?: string;
}

export interface QuizQuestion {
  id: string;
  prompt: string;
  choices: Choice[];
  metadata?: SectionMetadata;
  articleIndex?: number;
  articleTitle?: string;
}

export interface ArticleMetadata {
  identifier: string;
  title: string;
  qtiVersion: string;
  totalSections: number;
  totalQuizQuestions: number;
  totalQuestions: number;
  lexileLevel?: number;
}

export interface Article {
  title: string;
  identifier: string;
  metadata: ArticleMetadata;
  sections: Section[];
  quizQuestions: QuizQuestion[];
}

export interface StoryData {
  title: string;
  identifier?: string;
  metadata?: ArticleMetadata;
  articles?: Article[];
  sections: Section[];
  quizQuestions: QuizQuestion[];
}

export interface ArticleInfo {
  identifier: string;
  title: string;
  qtiVersion: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Game State Types
 */

export type GameState = 'BOARD' | 'READING' | 'QUIZ_INTRO' | 'QUIZ_QUESTION' | 'RESULTS' | 'TILE_RESULTS';

export interface TilePosition {
  row: number;
  col: number;
  gridIndex: number;
}

export interface ActiveTile extends TilePosition {
  type: 'section' | 'quiz';
  sectionIndex: number | null;
  articleIndex: number;
  label: string;
}

export interface TileProgress {
  state: GameState;
  currentFullGameQuestion?: number;
  currentSectionQuestion?: number;
  guidingQuestions?: QuizQuestion[];
  quizQuestions?: QuizQuestion[];
  sectionsForArticle?: Section[];
  currentArticleTitle?: string;
  currentArticleIndex?: number;
  isInGuidingPhase?: boolean;
  score?: number;
}

export interface QuestionResult {
  correct: boolean;
}

/**
 * QTI Raw Data Types (from JSON file)
 */

export interface QTIChoice {
  identifier: string;
  text: string;
  feedback?: string;
  is_correct?: boolean;
}

export interface QTIStimulusMetadata {
  lexile_level?: number;
  course?: string;
  module?: string;
  section_number?: number;
}

export interface QTIStimulus {
  identifier: string;
  title: string;
  metadata?: QTIStimulusMetadata;
  content_html?: string;
  content_text?: string;
}

export interface QTIItemMetadata {
  DOK?: number;
  difficulty?: string;
  CCSS?: string;
}

export interface QTIItem {
  identifier: string;
  title?: string;
  type?: string;
  metadata?: QTIItemMetadata;
  stimulus?: QTIStimulus;
  prompt: string;
  choices: QTIChoice[];
  correct_answers?: string[];
}

export interface QTISection {
  identifier: string;
  title: string;
  sequence: number;
  items: QTIItem[];
}

export interface QTITestPart {
  identifier: string;
  navigationMode?: string;
  submissionMode?: string;
  sections: QTISection[];
}

export interface QTIAssessment {
  identifier: string;
  title: string;
  qtiVersion: string;
  metadata?: Record<string, unknown>;
  test_parts: QTITestPart[];
}

export interface QTIData {
  metadata?: {
    total_tests?: number;
    extraction_date?: string;
    api_base_url?: string;
    grade_filter?: number;
  };
  assessments: QTIAssessment[];
}




