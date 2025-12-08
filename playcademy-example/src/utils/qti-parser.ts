/**
 * QTI Data Parser
 * 
 * Functions to extract and parse QTI (Question and Test Interoperability) data
 * for the reading comprehension game.
 */

import type {
  QTIData,
  QTIAssessment,
  QTIChoice,
  QTIStimulus,
  Section,
  QuizQuestion,
  Choice,
  ArticleMetadata,
  StoryData,
  ArticleInfo,
  ValidationResult,
} from '../types';

/**
 * Load QTI data from JSON file
 */
export async function loadQTIData(filePath: string): Promise<QTIData> {
  const response = await fetch(filePath);
  if (!response.ok) {
    throw new Error(`Failed to load QTI data: ${response.status} ${response.statusText}`);
  }
  return await response.json();
}

/**
 * Find an article by its identifier in QTI data
 */
export function findArticleById(qtiData: QTIData, articleId: string): QTIAssessment | null {
  if (!qtiData || !qtiData.assessments) {
    console.error('Invalid QTI data structure');
    return null;
  }
  
  const article = qtiData.assessments.find(
    assessment => assessment.identifier === articleId
  );
  
  if (!article) {
    console.warn(`Article ${articleId} not found in QTI data`);
    return null;
  }
  
  return article;
}

/**
 * Extract text content from stimulus, handling both text and HTML formats
 */
export function extractTextContent(stimulus: QTIStimulus): string {
  // Prefer content_text if available (cleaner)
  if (stimulus.content_text) {
    return stimulus.content_text.trim();
  }
  
  // Fall back to parsing HTML
  if (stimulus.content_html) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = stimulus.content_html;
    
    const textContent = tempDiv.textContent || tempDiv.innerText || '';
    return textContent.trim();
  }
  
  return '';
}

/**
 * Extract and format choices from QTI choice items
 */
export function extractChoices(choices: QTIChoice[]): Choice[] {
  if (!Array.isArray(choices)) {
    return [];
  }
  
  return choices.map(choice => ({
    id: choice.identifier,
    text: choice.text,
    feedback: choice.feedback || '',
    correct: choice.is_correct || false
  }));
}

/**
 * Extract all sections (guiding questions) from an article
 */
export function extractSections(article: QTIAssessment): Section[] {
  const sections: Section[] = [];
  
  if (!article.test_parts || !Array.isArray(article.test_parts)) {
    console.warn('Article has no test_parts');
    return sections;
  }
  
  article.test_parts.forEach(testPart => {
    if (!testPart.sections || !Array.isArray(testPart.sections)) {
      return;
    }
    
    testPart.sections.forEach(section => {
      // Only process "Guiding Questions" sections
      if (section.title === 'Guiding Questions' && 
          section.items && 
          section.items.length > 0) {
        
        const item = section.items[0]; // First item in the section
        const stimulus = item.stimulus;
        
        if (stimulus) {
          sections.push({
            id: section.sequence,
            identifier: section.identifier,
            title: stimulus.title,
            sectionNumber: stimulus.metadata?.section_number,
            lexileLevel: stimulus.metadata?.lexile_level,
            content: extractTextContent(stimulus),
            contentHtml: stimulus.content_html,
            question: item.prompt,
            choices: extractChoices(item.choices),
            metadata: {
              itemId: item.identifier,
              dok: item.metadata?.DOK,
              difficulty: item.metadata?.difficulty,
              ccss: item.metadata?.CCSS
            }
          });
        }
      }
    });
  });
  
  return sections;
}

/**
 * Extract quiz questions from an article
 */
export function extractQuizQuestions(article: QTIAssessment): QuizQuestion[] {
  const quizQuestions: QuizQuestion[] = [];
  
  if (!article.test_parts || !Array.isArray(article.test_parts)) {
    console.warn('Article has no test_parts');
    return quizQuestions;
  }
  
  article.test_parts.forEach(testPart => {
    if (!testPart.sections || !Array.isArray(testPart.sections)) {
      return;
    }
    
    testPart.sections.forEach(section => {
      // Only process "Quiz" sections
      if (section.title === 'Quiz' && 
          section.items && 
          section.items.length > 0) {
        
        section.items.forEach(item => {
          quizQuestions.push({
            id: item.identifier,
            prompt: item.prompt,
            choices: extractChoices(item.choices),
            metadata: {
              itemId: item.identifier,
              dok: item.metadata?.DOK,
              difficulty: item.metadata?.difficulty,
              ccss: item.metadata?.CCSS
            }
          });
        });
      }
    });
  });
  
  return quizQuestions;
}

/**
 * Get article metadata
 */
export function extractArticleMetadata(article: QTIAssessment): ArticleMetadata {
  const sections = extractSections(article);
  const quizQuestions = extractQuizQuestions(article);
  
  // Get lexile from first section if available
  const lexile = sections.length > 0 ? sections[0].lexileLevel : undefined;
  
  return {
    identifier: article.identifier,
    title: article.title,
    qtiVersion: article.qtiVersion,
    totalSections: sections.length,
    totalQuizQuestions: quizQuestions.length,
    totalQuestions: sections.length + quizQuestions.length,
    lexileLevel: lexile
  };
}

/**
 * Convert QTI article to game-ready story data format
 */
export function parseQTIToStoryData(article: QTIAssessment): StoryData {
  const sections = extractSections(article);
  const quizQuestions = extractQuizQuestions(article);
  
  // Convert to game format
  const storyData: StoryData = {
    title: article.title,
    identifier: article.identifier,
    metadata: extractArticleMetadata(article),
    sections: sections.map(section => ({
      id: section.id,
      identifier: section.identifier,
      title: section.title,
      content: section.content,
      question: section.question,
      choices: section.choices,
      metadata: section.metadata,
      sectionNumber: section.sectionNumber,
      lexileLevel: section.lexileLevel,
      contentHtml: section.contentHtml
    })),
    quizQuestions: quizQuestions.map(question => ({
      id: question.id,
      prompt: question.prompt,
      choices: question.choices,
      metadata: question.metadata
    }))
  };
  
  return storyData;
}

/**
 * Load and parse story data from QTI file by article ID
 */
export async function loadStoryByArticleId(qtiFilePath: string, articleId: string): Promise<StoryData> {
  const qtiData = await loadQTIData(qtiFilePath);
  const article = findArticleById(qtiData, articleId);
  
  if (!article) {
    throw new Error(`Article ${articleId} not found`);
  }
  
  return parseQTIToStoryData(article);
}

/**
 * Get list of all available articles from QTI data
 */
export function getAvailableArticles(qtiData: QTIData): ArticleInfo[] {
  if (!qtiData || !qtiData.assessments) {
    return [];
  }
  
  return qtiData.assessments.map(article => ({
    identifier: article.identifier,
    title: article.title,
    qtiVersion: article.qtiVersion
  }));
}

/**
 * Validate QTI article structure
 */
export function validateArticle(article: QTIAssessment | null): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: []
  };
  
  if (!article) {
    result.valid = false;
    result.errors.push('Article is null or undefined');
    return result;
  }
  
  if (!article.identifier) {
    result.errors.push('Article missing identifier');
    result.valid = false;
  }
  
  if (!article.title) {
    result.warnings.push('Article missing title');
  }
  
  const sections = extractSections(article);
  if (sections.length === 0) {
    result.errors.push('Article has no sections');
    result.valid = false;
  }
  
  const quizQuestions = extractQuizQuestions(article);
  if (quizQuestions.length === 0) {
    result.warnings.push('Article has no quiz questions');
  }
  
  return result;
}




