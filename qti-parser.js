/**
 * QTI Data Parser
 * 
 * Functions to extract and parse QTI (Question and Test Interoperability) data
 * for the reading comprehension game.
 * 
 * Supports extracting individual articles, sections, questions, and converting
 * QTI format to game-ready format.
 * 
 * @version 1.0.0
 * @author Readventure Game
 * 
 * QUICK START:
 * ------------
 * // Load a story by ID (most common use)
 * const story = await loadStoryByArticleId('texts/qti_grade_3_data.json', 'article_101001');
 * 
 * // List all available articles
 * const qtiData = await loadQTIData('texts/qti_grade_3_data.json');
 * const articles = getAvailableArticles(qtiData);
 * 
 * // Extract just sections
 * const sections = extractSections(article);
 * 
 * For complete documentation, see: QTI-PARSER-GUIDE.md
 * 
 * AVAILABLE FUNCTIONS:
 * -------------------
 * - loadQTIData(filePath)                    : Load QTI JSON file
 * - findArticleById(qtiData, articleId)      : Find specific article
 * - extractSections(article)                 : Get guiding questions
 * - extractQuizQuestions(article)            : Get quiz questions
 * - extractArticleMetadata(article)          : Get article info
 * - parseQTIToStoryData(article)             : Convert to game format
 * - loadStoryByArticleId(path, id)           : One-stop load function ⭐
 * - getAvailableArticles(qtiData)            : List all articles
 * - validateArticle(article)                 : Check structure
 * - extractTextContent(stimulus)             : Extract plain text
 * - extractChoices(choices)                  : Format answer choices
 */

/**
 * Load QTI data from JSON file
 * @param {string} filePath - Path to the QTI JSON file
 * @returns {Promise<Object>} QTI data object
 */
async function loadQTIData(filePath) {
    try {
        const response = await fetch(filePath);
        if (!response.ok) {
            throw new Error(`Failed to load QTI data: ${response.status} ${response.statusText}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Error loading QTI data:', error);
        throw error;
    }
}

/**
 * Find an article by its identifier in QTI data
 * @param {Object} qtiData - Complete QTI data object
 * @param {string} articleId - Article identifier (e.g., "article_101001")
 * @returns {Object|null} Article object or null if not found
 */
function findArticleById(qtiData, articleId) {
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
 * Extract all sections (guiding questions) from an article
 * @param {Object} article - Article object from QTI data
 * @returns {Array<Object>} Array of section objects
 */
function extractSections(article) {
    const sections = [];
    
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
 * @param {Object} article - Article object from QTI data
 * @returns {Array<Object>} Array of quiz question objects
 */
function extractQuizQuestions(article) {
    const quizQuestions = [];
    
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
 * Extract text content from stimulus, handling both text and HTML formats
 * @param {Object} stimulus - Stimulus object from QTI item
 * @returns {string} Plain text content
 */
function extractTextContent(stimulus) {
    // Prefer content_text if available (cleaner)
    if (stimulus.content_text) {
        return stimulus.content_text.trim();
    }
    
    // Fall back to parsing HTML
    if (stimulus.content_html) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = stimulus.content_html;
        
        // Remove any non-text elements if needed
        const textContent = tempDiv.textContent || tempDiv.innerText || '';
        return textContent.trim();
    }
    
    return '';
}

/**
 * Extract and format choices from QTI choice items
 * @param {Array<Object>} choices - Array of choice objects from QTI
 * @returns {Array<Object>} Formatted choice objects
 */
function extractChoices(choices) {
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
 * Get article metadata
 * @param {Object} article - Article object from QTI data
 * @returns {Object} Metadata object
 */
function extractArticleMetadata(article) {
    const sections = extractSections(article);
    const quizQuestions = extractQuizQuestions(article);
    
    // Get lexile from first section if available
    const lexile = sections.length > 0 ? sections[0].lexileLevel : null;
    
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
 * @param {Object} article - Article object from QTI data
 * @returns {Object} Story data in game format
 */
function parseQTIToStoryData(article) {
    const sections = extractSections(article);
    const quizQuestions = extractQuizQuestions(article);
    
    // Convert to game format
    const storyData = {
        title: article.title,
        identifier: article.identifier,
        metadata: extractArticleMetadata(article),
        sections: sections.map(section => ({
            id: section.id,
            title: section.title,
            content: section.content,
            question: section.question,
            choices: section.choices
        })),
        quizQuestions: quizQuestions.map(question => ({
            id: question.id,
            prompt: question.prompt,
            choices: question.choices
        }))
    };
    
    return storyData;
}

/**
 * Load and parse story data from QTI file by article ID
 * @param {string} qtiFilePath - Path to QTI JSON file
 * @param {string} articleId - Article identifier
 * @returns {Promise<Object>} Parsed story data in game format
 */
async function loadStoryByArticleId(qtiFilePath, articleId) {
    try {
        const qtiData = await loadQTIData(qtiFilePath);
        const article = findArticleById(qtiData, articleId);
        
        if (!article) {
            throw new Error(`Article ${articleId} not found`);
        }
        
        return parseQTIToStoryData(article);
    } catch (error) {
        console.error('Error loading story:', error);
        throw error;
    }
}

/**
 * Get list of all available articles from QTI data
 * @param {Object} qtiData - Complete QTI data object
 * @returns {Array<Object>} Array of article info objects
 */
function getAvailableArticles(qtiData) {
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
 * @param {Object} article - Article object to validate
 * @returns {Object} Validation result with success flag and messages
 */
function validateArticle(article) {
    const result = {
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

// Export functions for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    // Node.js environment
    module.exports = {
        loadQTIData,
        findArticleById,
        extractSections,
        extractQuizQuestions,
        extractTextContent,
        extractChoices,
        extractArticleMetadata,
        parseQTIToStoryData,
        loadStoryByArticleId,
        getAvailableArticles,
        validateArticle
    };
}

