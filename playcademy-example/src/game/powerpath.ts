/**
 * PowerPath 100 Algorithm
 * 
 * Adaptive question-serving algorithm inspired by IXL's scoring system.
 * 
 * Key Features:
 * - Score-based progression from 0 to 100
 * - Adaptive difficulty selection based on current score
 * - Prioritizes unseen questions
 * - Tracks accuracy and questions answered
 * - Guiding questions always served first
 * 
 * Score Targets by Accuracy:
 * - 100% accuracy: ~11 questions to reach 100
 * - 90% accuracy: ~14 questions
 * - 80% accuracy: ~18 questions
 * - 70% accuracy: ~24 questions
 */

import type { QuizQuestion, Choice } from '../types';

// ============================================
// Types
// ============================================

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface PowerPathQuestion {
  id: string;
  prompt: string;
  choices: Choice[];
  difficulty: Difficulty;
  humanApproved?: boolean;
  metadata?: {
    dok?: number;
    difficulty?: string;
    ccss?: string;
  };
}

export interface PowerPathState {
  score: number;
  questionsAnswered: number;
  correctAnswers: number;
  accuracy: number;
  isComplete: boolean;
  currentPhase: 'guiding' | 'quiz';
  guidingQuestionsRemaining: number;
  elapsedTimeMs: number;
}

export interface QuestionHistory {
  questionId: string;
  wasCorrect: boolean;
  attemptNumber: number;
  timestamp: number;
}

export interface PowerPathStats {
  score: number;
  questionsAnswered: number;
  accuracy: number;
  timeElapsed: string;
  isComplete: boolean;
}

// ============================================
// PowerPath 100 Algorithm
// ============================================

export class PowerPath100 {
  private score: number = 0;
  private questionsAnswered: number = 0;
  private correctAnswers: number = 0;
  private currentAttempt: number = 1;
  private startTime: number;
  
  // Question tracking
  private allQuestionHistory: QuestionHistory[] = [];
  private currentAttemptHistory: QuestionHistory[] = [];
  private guidingQuestions: PowerPathQuestion[] = [];
  private quizQuestions: PowerPathQuestion[] = [];
  private currentGuidingIndex: number = 0;
  
  // Callbacks
  private onStatsUpdate?: (stats: PowerPathStats) => void;

  constructor(
    guidingQuestions: PowerPathQuestion[],
    quizQuestions: PowerPathQuestion[],
    onStatsUpdate?: (stats: PowerPathStats) => void
  ) {
    this.guidingQuestions = guidingQuestions;
    this.quizQuestions = this.normalizeQuizQuestions(quizQuestions);
    this.onStatsUpdate = onStatsUpdate;
    this.startTime = Date.now();
  }

  /**
   * Normalize quiz questions to ensure difficulty is set
   */
  private normalizeQuizQuestions(questions: PowerPathQuestion[]): PowerPathQuestion[] {
    return questions.map(q => ({
      ...q,
      difficulty: this.parseDifficulty(q.metadata?.difficulty || q.difficulty)
    }));
  }

  /**
   * Parse difficulty string to standard format
   */
  private parseDifficulty(diff: string | undefined): Difficulty {
    if (!diff) return 'medium';
    const lower = diff.toLowerCase();
    if (lower === 'easy' || lower === 'low') return 'easy';
    if (lower === 'hard' || lower === 'high' || lower === 'difficult') return 'hard';
    return 'medium';
  }

  // ============================================
  // Score Calculation
  // ============================================

  /**
   * Calculate score increment for correct answer
   * Formula: Max(4, 14 - Floor(score/10))
   */
  private calculateIncrement(): number {
    return Math.max(4, 14 - Math.floor(this.score / 10));
  }

  /**
   * Calculate score decrement for incorrect answer
   * Based on current score bracket
   */
  private calculateDecrement(): number {
    if (this.score >= 90) return -8;
    if (this.score >= 80) return -7;
    if (this.score >= 70) return -6;
    if (this.score >= 50) return -5;
    if (this.score >= 40) return -4;
    if (this.score >= 30) return -3;
    if (this.score >= 20) return -2;
    return -1;
  }

  /**
   * Get target difficulty based on current score
   */
  private getTargetDifficulty(): Difficulty {
    if (this.score >= 90) {
      // Hard only
      return 'hard';
    } else if (this.score >= 50) {
      // Medium (75%) + Hard (25%)
      return Math.random() < 0.75 ? 'medium' : 'hard';
    } else {
      // Easy only
      return 'easy';
    }
  }

  /**
   * Get fallback difficulties in order
   */
  private getFallbackDifficulties(primary: Difficulty): Difficulty[] {
    switch (primary) {
      case 'easy':
        return ['easy', 'medium', 'hard'];
      case 'medium':
        return ['medium', 'hard', 'easy'];
      case 'hard':
        return ['hard', 'medium', 'easy'];
    }
  }

  // ============================================
  // Question Selection
  // ============================================

  /**
   * Get IDs of questions answered in ALL attempts
   */
  private getGloballySeenQuestionIds(): Set<string> {
    return new Set(this.allQuestionHistory.map(h => h.questionId));
  }

  /**
   * Get IDs of questions answered in CURRENT attempt
   */
  private getCurrentAttemptSeenIds(): Set<string> {
    return new Set(this.currentAttemptHistory.map(h => h.questionId));
  }

  /**
   * Filter questions by difficulty
   */
  private filterByDifficulty(questions: PowerPathQuestion[], difficulty: Difficulty): PowerPathQuestion[] {
    return questions.filter(q => q.difficulty === difficulty);
  }

  /**
   * Filter out seen questions
   */
  private filterUnseenQuestions(questions: PowerPathQuestion[], seenIds: Set<string>): PowerPathQuestion[] {
    return questions.filter(q => !seenIds.has(q.id));
  }

  /**
   * Prioritize human-approved questions
   */
  private prioritizeHumanApproved(questions: PowerPathQuestion[]): PowerPathQuestion[] {
    const humanApproved = questions.filter(q => q.humanApproved === true);
    const notApproved = questions.filter(q => q.humanApproved !== true);
    
    // Shuffle each group
    this.shuffleArray(humanApproved);
    this.shuffleArray(notApproved);
    
    // Return human-approved first, then others
    return [...humanApproved, ...notApproved];
  }

  /**
   * Fisher-Yates shuffle
   */
  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  /**
   * Select next quiz question using PowerPath algorithm
   */
  private selectQuizQuestion(): PowerPathQuestion | null {
    const targetDifficulty = this.getTargetDifficulty();
    const fallbackOrder = this.getFallbackDifficulties(targetDifficulty);
    
    // Step 1: Try to find unseen question (across ALL attempts)
    const globallySeenIds = this.getGloballySeenQuestionIds();
    
    for (const difficulty of fallbackOrder) {
      const filtered = this.filterByDifficulty(this.quizQuestions, difficulty);
      const unseen = this.filterUnseenQuestions(filtered, globallySeenIds);
      
      if (unseen.length > 0) {
        const prioritized = this.prioritizeHumanApproved(unseen);
        return prioritized[0];
      }
    }
    
    // Step 2: Fallback to unseen in CURRENT attempt only
    const currentSeenIds = this.getCurrentAttemptSeenIds();
    
    for (const difficulty of fallbackOrder) {
      const filtered = this.filterByDifficulty(this.quizQuestions, difficulty);
      const unseen = this.filterUnseenQuestions(filtered, currentSeenIds);
      
      if (unseen.length > 0) {
        const prioritized = this.prioritizeHumanApproved(unseen);
        return prioritized[0];
      }
    }
    
    // Step 3: Fallback to ANY question from the pool
    for (const difficulty of fallbackOrder) {
      const filtered = this.filterByDifficulty(this.quizQuestions, difficulty);
      
      if (filtered.length > 0) {
        const prioritized = this.prioritizeHumanApproved(filtered);
        return prioritized[0];
      }
    }
    
    // Final fallback: random from all questions
    if (this.quizQuestions.length > 0) {
      const shuffled = [...this.quizQuestions];
      this.shuffleArray(shuffled);
      return shuffled[0];
    }
    
    return null;
  }

  // ============================================
  // Public API
  // ============================================

  /**
   * Get current state
   */
  getState(): PowerPathState {
    return {
      score: this.score,
      questionsAnswered: this.questionsAnswered,
      correctAnswers: this.correctAnswers,
      accuracy: this.questionsAnswered > 0 
        ? Math.round((this.correctAnswers / this.questionsAnswered) * 100) 
        : 0,
      isComplete: this.score >= 100,
      currentPhase: this.currentGuidingIndex < this.guidingQuestions.length ? 'guiding' : 'quiz',
      guidingQuestionsRemaining: Math.max(0, this.guidingQuestions.length - this.currentGuidingIndex),
      elapsedTimeMs: Date.now() - this.startTime
    };
  }

  /**
   * Get stats for display
   */
  getStats(): PowerPathStats {
    const state = this.getState();
    return {
      score: state.score,
      questionsAnswered: state.questionsAnswered,
      accuracy: state.accuracy,
      timeElapsed: this.formatTime(state.elapsedTimeMs),
      isComplete: state.isComplete
    };
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
   * Get next question
   * Returns guiding question if any remain, otherwise quiz question
   */
  getNextQuestion(): PowerPathQuestion | null {
    // Check if complete
    if (this.score >= 100) {
      return null;
    }
    
    // Phase 1: Guiding questions (always first)
    if (this.currentGuidingIndex < this.guidingQuestions.length) {
      return this.guidingQuestions[this.currentGuidingIndex];
    }
    
    // Phase 2: Quiz questions (PowerPath algorithm)
    return this.selectQuizQuestion();
  }

  /**
   * Record answer and update score
   * @returns The score change (positive or negative)
   */
  recordAnswer(questionId: string, wasCorrect: boolean): number {
    this.questionsAnswered++;
    
    const isGuidingQuestion = this.currentGuidingIndex < this.guidingQuestions.length &&
      this.guidingQuestions[this.currentGuidingIndex]?.id === questionId;
    
    // Record history
    const historyEntry: QuestionHistory = {
      questionId,
      wasCorrect,
      attemptNumber: this.currentAttempt,
      timestamp: Date.now()
    };
    
    this.allQuestionHistory.push(historyEntry);
    this.currentAttemptHistory.push(historyEntry);
    
    // Advance guiding index if this was a guiding question
    if (isGuidingQuestion) {
      this.currentGuidingIndex++;
    }
    
    // Calculate score change
    let scoreChange = 0;
    
    if (wasCorrect) {
      this.correctAnswers++;
      scoreChange = this.calculateIncrement();
      this.score = Math.min(100, this.score + scoreChange);
    } else {
      scoreChange = this.calculateDecrement();
      this.score = Math.max(0, this.score + scoreChange);
    }
    
    // Notify stats update
    if (this.onStatsUpdate) {
      this.onStatsUpdate(this.getStats());
    }
    
    return scoreChange;
  }

  /**
   * Check if PowerPath is complete (score >= 100)
   */
  isComplete(): boolean {
    return this.score >= 100;
  }

  /**
   * Get current phase
   */
  getCurrentPhase(): 'guiding' | 'quiz' {
    return this.currentGuidingIndex < this.guidingQuestions.length ? 'guiding' : 'quiz';
  }

  /**
   * Reset for a new attempt (keeps history across attempts)
   */
  resetAttempt(): void {
    this.score = 0;
    this.questionsAnswered = 0;
    this.correctAnswers = 0;
    this.currentGuidingIndex = 0;
    this.currentAttemptHistory = [];
    this.currentAttempt++;
    this.startTime = Date.now();
    
    if (this.onStatsUpdate) {
      this.onStatsUpdate(this.getStats());
    }
  }

  /**
   * Full reset (clears all history)
   */
  fullReset(): void {
    this.score = 0;
    this.questionsAnswered = 0;
    this.correctAnswers = 0;
    this.currentGuidingIndex = 0;
    this.allQuestionHistory = [];
    this.currentAttemptHistory = [];
    this.currentAttempt = 1;
    this.startTime = Date.now();
    
    if (this.onStatsUpdate) {
      this.onStatsUpdate(this.getStats());
    }
  }

  /**
   * Get question counts by difficulty
   */
  getQuestionCounts(): { easy: number; medium: number; hard: number; total: number } {
    return {
      easy: this.quizQuestions.filter(q => q.difficulty === 'easy').length,
      medium: this.quizQuestions.filter(q => q.difficulty === 'medium').length,
      hard: this.quizQuestions.filter(q => q.difficulty === 'hard').length,
      total: this.quizQuestions.length
    };
  }

  /**
   * Get expected questions for target accuracy
   * (Informational only)
   */
  static getExpectedQuestions(accuracyPercent: number): number {
    const accuracyData: Record<number, number> = {
      100: 11,
      99: 11.2,
      95: 12.2,
      90: 13.5,
      80: 17.1,
      70: 23.9,
      60: 35.3,
      50: 71.2
    };
    
    // Find closest accuracy
    const accuracies = Object.keys(accuracyData).map(Number).sort((a, b) => b - a);
    for (const acc of accuracies) {
      if (accuracyPercent >= acc) {
        return accuracyData[acc];
      }
    }
    
    return 100; // Very low accuracy
  }
}

// ============================================
// Helper: Convert from game format
// ============================================

/**
 * Convert game's QuizQuestion format to PowerPath format
 */
export function convertToPowerPathQuestion(question: QuizQuestion): PowerPathQuestion {
  const difficulty = question.metadata?.difficulty?.toLowerCase() || 'medium';
  
  let normalizedDifficulty: Difficulty = 'medium';
  if (difficulty === 'easy' || difficulty === 'low') {
    normalizedDifficulty = 'easy';
  } else if (difficulty === 'hard' || difficulty === 'high' || difficulty === 'difficult') {
    normalizedDifficulty = 'hard';
  }
  
  return {
    id: question.id,
    prompt: question.prompt,
    choices: question.choices,
    difficulty: normalizedDifficulty,
    humanApproved: (question.metadata as any)?.humanApproved,
    metadata: question.metadata
  };
}

/**
 * Convert array of game questions to PowerPath format
 */
export function convertQuestionsToPowerPath(questions: QuizQuestion[]): PowerPathQuestion[] {
  return questions.map(convertToPowerPathQuestion);
}

