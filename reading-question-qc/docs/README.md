# Reading Question QC - Documentation

This folder contains comprehensive documentation for the Reading Question Generation and Quality Control system.

## 📚 Documentation Index

### Core System Documentation

| Document | Description |
|----------|-------------|
| [GENERATION-SYSTEM-COMPLETE.md](./GENERATION-SYSTEM-COMPLETE.md) | **Complete guide to question generation** - Architecture, all prompts, example matching, recreation guide |
| [QC-SYSTEM-COMPLETE.md](./QC-SYSTEM-COMPLETE.md) | **Complete guide to quality control** - All QC checks, exact prompts, scoring system, recreation guide |
| [BULK-GENERATOR-DEEP-DIVE.md](./BULK-GENERATOR-DEEP-DIVE.md) | **Technical deep dive** - Full code walkthrough, parallel processing, retry logic, recreation checklist |

### Operations & Improvements

| Document | Description |
|----------|-------------|
| [IMPROVEMENTS-AND-FIXES.md](./IMPROVEMENTS-AND-FIXES.md) | **Learnings & fixes** - Rate limiting solutions, bug fixes, operational improvements |

### Reference Documentation

| Document | Description |
|----------|-------------|
| [SYSTEM-OVERVIEW.md](./SYSTEM-OVERVIEW.md) | High-level architecture and component relationships |
| [API-REFERENCE.md](./API-REFERENCE.md) | Detailed API documentation for all classes and methods |
| [WORKFLOW-GUIDE.md](./WORKFLOW-GUIDE.md) | Step-by-step data flow and input processing |
| [USER-GUIDE.md](./USER-GUIDE.md) | Getting started and usage instructions |
| [EDUCATION-STANDARDS.md](./EDUCATION-STANDARDS.md) | CCSS standards and DOK levels reference |

## 🚀 Quick Start

1. **Understand the system**: Start with [SYSTEM-OVERVIEW.md](./SYSTEM-OVERVIEW.md)
2. **Generate questions**: Follow [GENERATION-SYSTEM-COMPLETE.md](./GENERATION-SYSTEM-COMPLETE.md)
3. **Run quality control**: Follow [QC-SYSTEM-COMPLETE.md](./QC-SYSTEM-COMPLETE.md)

## 📂 Related Files (Parent Directory)

| File | Purpose |
|------|---------|
| `question_generator.py` | Single-batch question generation script |
| `bulk_question_generator.py` | Parallel processing with integrated QC |
| `ck_gen - prompts.json` | All generation prompt templates |
| `ck_gen - examples.csv` | Template questions for pattern matching |
| `ck_gen - ccss.csv` | CCSS standards definitions |
| `ck_gen - questions.csv` | Input CSV (passages + metadata) |
| `qc_pipeline/` | Standalone QC pipeline module |

## 🔑 Key Concepts

- **Question Types**: MCQ (Multiple Choice), SR (Short Response), MP (Multipart)
- **DOK Levels**: 1 (Recall), 2 (Skill/Concept), 3 (Strategic Thinking), 4 (Extended Thinking)
- **CCSS Standards**: RL (Literature), RI (Informational Text)
- **QC Checks**: 14 automated quality checks using Claude and OpenAI APIs
