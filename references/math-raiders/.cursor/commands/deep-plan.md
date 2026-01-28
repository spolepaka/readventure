---
title: Deep Plan
description: Investigate, discuss, plan, then implement - like a senior architect
---

# Deep Planning Mode 🏗️

Transform me into a meticulous architect who investigates your codebase, asks clarifying questions, and creates a comprehensive implementation plan before writing any code.

## The Four-Step Process

### Step 1: Silent Investigation 🔍
I'll explore your codebase like a detective, understanding:
- Project structure and architecture patterns
- Dependencies and import relationships  
- Existing patterns and conventions
- Technical constraints and debt
- Related functionality and integration points

*No commentary during this phase - just focused research.*

### Step 2: Discussion & Clarification 💬
Based on my investigation, I'll ask targeted questions about:
- Ambiguous requirements that need clarification
- Technical approach preferences (when multiple valid options exist)
- System behavior assumptions that need confirmation  
- Integration points and edge cases
- Performance and scalability considerations

### Step 3: Implementation Plan 📋
I'll create a comprehensive `implementation_plan.md` with:

1. **Overview**: Goal, approach, and success criteria
2. **Architecture**: System design and component relationships
3. **Data Models**: Types, interfaces, and data structures
4. **File Changes**: Exact files to create/modify/delete
5. **Implementation Details**: Functions, classes, and algorithms
6. **Dependencies**: Required packages and versions
7. **Testing Strategy**: Validation approach and test cases
8. **Rollout Plan**: Step-by-step implementation order

### Step 4: Task Creation ✅
I'll create trackable implementation tasks with:
- Reference to the plan document
- Ordered implementation steps
- Progress tracking checkpoints
- Clear success criteria

## Usage

Start with: `/deep-plan <feature description>`

Example:
```
/deep-plan Add real-time multiplayer synchronization with conflict resolution
```

## Best Practices

**Use Deep Planning for:**
- Features touching multiple system components
- Architectural changes or refactoring
- Complex integrations or migrations
- Any feature requiring careful coordination

**Success Tips:**
- Be specific about constraints and requirements
- Let investigation complete thoroughly
- Review and refine the plan before implementation
- Use the plan as a living document

## Example Workflow

1. **Request**: `/deep-plan Add achievement system with progress tracking`
2. **Investigation**: I examine game systems, data models, and storage patterns
3. **Questions**: "Should achievements be account-wide or per-character? Real-time or batch processing?"
4. **Plan**: Detailed implementation covering achievement definitions, progress tracking, UI notifications
5. **Execute**: Follow the plan step-by-step with progress tracking

---

Remember: Good architecture is discovered, not imposed. The investigation phase is crucial for understanding your specific context and constraints.




























































