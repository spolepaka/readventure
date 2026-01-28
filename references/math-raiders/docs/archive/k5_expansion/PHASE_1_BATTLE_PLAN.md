# Phase 1 Battle Plan: K-5 Math Expansion

## Executive Summary

Phase 1 builds the **complete operations infrastructure** - all 4 operations fully working with ~775 unique facts generated. This approach:
1. Creates complete abstractions (no half-built features)
2. Enables comprehensive testing before player impact
3. Makes Phase 2 (grades) a simple filtering change
4. Follows engineering best practices (mechanism before policy)

## Current State Analysis

### Architecture Strengths
- **Clean separation**: SpacetimeDB backend with TypeScript/React frontend
- **Strong type safety**: Auto-generated TypeScript types from Rust schemas
- **Adaptive learning system**: Already tracks mastery per fact with spaced repetition
- **Performance tracking**: CQPM metrics and fact-specific response times
- **Tier system**: Currently uses mastered fact count for progression (Spark/Volt/Thunder/Mega leagues)

### Key Architectural Decision
**Universal Facts + Lazy Mastery** approach:
- Generate ~775 unique facts tagged with grades
- FactMastery records created on-demand (existing pattern)
- Problem selection unchanged: just filters different facts
- No database schema changes required

### Technical Debt & Opportunities
1. **Hardcoded multiplication**: Operation enum exists but only has `Multiply` variant
2. **Tier-based content gating**: Currently limits facts by tier, needs grade-based approach
3. **Fact normalization**: Only handles multiplication (e.g., "3x7" → "3x7")
4. **UI assumes multiplication**: ProblemDisplay component hardcodes "×" symbol
5. **Problem generation**: Tightly coupled to multiplication logic

## Phase 1 Goals

### Primary Objectives
1. **Implement all 4 operations** completely (compute, normalize, display)
2. **Generate ~775 unique facts** that cover all K-5 needs
3. **Update all UI components** to handle any operation
4. **Remove tier filtering** - serve all ~775 facts
5. **Full operations support** ready to test

### What Ships in Phase 1
- Complete operations abstraction
- All facts defined and importable
- UI ready for any operation
- All 4 operations working in game
- Ready for grade-based filtering (Phase 2)

## Implementation Strategy

### 1. Operation Abstraction Layer (4 hours)

#### A. Extend Operation Enum (Backend)
```rust
// server/src/lib.rs
#[derive(SpacetimeType, Debug, Clone, PartialEq)]
pub enum Operation {
    Add,
    Subtract,
    Multiply,
    Divide,
}

impl Operation {
    fn symbol(&self) -> &'static str {
        match self {
            Operation::Add => "+",
            Operation::Subtract => "-",
            Operation::Multiply => "×",
            Operation::Divide => "÷",
        }
    }
    
    fn compute(&self, left: u8, right: u8) -> Option<i16> {
        match self {
            Operation::Add => Some((left as i16) + (right as i16)),
            Operation::Subtract => Some((left as i16) - (right as i16)),
            Operation::Multiply => Some((left as i16) * (right as i16)),
            Operation::Divide => {
                if right != 0 && left % right == 0 {
                    Some((left / right) as i16)
                } else {
                    None  // Invalid division
                }
            }
        }
    }
}
```

#### B. Update Fact Normalization
```rust
fn normalize_fact(operation: &Operation, left: u8, right: u8) -> String {
    match operation {
        Operation::Add | Operation::Multiply => {
            // Commutative: normalize to smaller first
            let (min, max) = if left <= right { (left, right) } else { (right, left) };
            format!("{}{}{}", min, operation.symbol(), max)
        }
        Operation::Subtract | Operation::Divide => {
            // Non-commutative: preserve order
            format!("{}{}{}", left, operation.symbol(), right)
        }
    }
}
```

#### C. Problem Generation Updates
```rust
// Add operation selection to problem generation
fn generate_problem(sequence: u32, ctx: &ReducerContext, raid_player: &mut RaidPlayer) -> (u8, u8, Operation, String) {
    // Use grade to determine available operations
    let player = get_player(ctx, &raid_player.player_id)?;
    let available_ops = match player.grade {
        0 => vec![Operation::Add, Operation::Subtract],  // K: Add/Sub to 5
        1 => vec![Operation::Add],                       // G1: Add to 10
        2 => vec![Operation::Add, Operation::Subtract],  // G2: Add/Sub to 20
        3 => vec![Operation::Add, Operation::Subtract, Operation::Multiply], // G3: +/-/×
        4 => vec![Operation::Multiply, Operation::Divide], // G4: ×/÷ only
        5 => vec![Operation::Add, Operation::Subtract, Operation::Multiply, Operation::Divide], // G5: All
        _ => vec![Operation::Multiply], // Fallback
    };
    
    // Select operation based on sequence for variety
    let op_index = (sequence as usize) % available_ops.len();
    let operation = available_ops[op_index].clone();
    
    // Generate appropriate operands based on operation and grade
    let (left, right) = generate_operands_for_operation(&operation, player.grade);
    
    // Rest of existing logic...
}
```

### 2. Frontend Operation Support (2 hours)

#### A. Update Problem Display
```tsx
// client/src/components/ProblemDisplay.tsx
const getOperationSymbol = (op: Operation) => {
  switch (op.tag) {
    case "Add": return "+";
    case "Subtract": return "−";  // Use proper minus sign
    case "Multiply": return "×";
    case "Divide": return "÷";
    default: return "?";
  }
};
```

#### B. Answer Validation Updates
- Handle negative answers for subtraction
- Validate division results are whole numbers
- Update answer input to accept negative numbers

### 3. Fact Generation Script (4 hours)

#### A. Universal Fact Pool Design
```rust
// Generated file: server/src/math_facts.rs
pub struct MathFact {
    pub left: u8,
    pub right: u8,
    pub operation: Operation,
    pub answer: i16,
    pub grades: Vec<u8>,  // Which grades use this fact
}

// Universal fact pool - each fact exists ONCE
pub const ALL_FACTS: &[MathFact] = &[
    MathFact { left: 0, right: 0, op: Add, answer: 0, grades: vec![0,1,2,3,5] },
    MathFact { left: 0, right: 1, op: Add, answer: 1, grades: vec![0,1,2,3,5] },
    // ... ~775 unique facts total
];

// Grade filtering happens at runtime
pub fn get_facts_for_grade(grade: u8) -> Vec<&MathFact> {
    ALL_FACTS.iter()
        .filter(|f| f.grades.contains(&grade))
        .collect()
}
```

#### B. Script generates from single source
```python
# generate_facts.py creates both:
# - server/src/math_facts.rs (Rust)
# - client/src/data/mathFacts.ts (TypeScript)
# Ensures perfect consistency
```

### 4. Testing & Validation (2 hours)

#### A. Unit Tests
```rust
#[cfg(test)]
mod tests {
    #[test]
    fn test_operation_compute() {
        assert_eq!(Operation::Add.compute(3, 5), Some(8));
        assert_eq!(Operation::Subtract.compute(10, 7), Some(3));
        assert_eq!(Operation::Divide.compute(12, 3), Some(4));
        assert_eq!(Operation::Divide.compute(13, 3), None); // Not whole
    }
    
    #[test]
    fn test_fact_normalization() {
        assert_eq!(normalize_fact(&Operation::Add, 5, 3), "3+5");
        assert_eq!(normalize_fact(&Operation::Subtract, 5, 3), "5-3");
    }
}
```

#### B. Manual Testing Checklist
- [ ] Each operation displays correctly
- [ ] Answers calculate properly
- [ ] Negative answers work for subtraction
- [ ] Division only shows whole number problems
- [ ] Fact mastery tracks per operation
- [ ] CQPM calculations remain accurate

## Migration Strategy

### Database Considerations
1. Existing `fact_key` format changes from "3x7" to "3×7", "3+7", etc.
2. Migration approach:
   - Keep existing multiplication facts as-is initially
   - New facts use new format
   - Add migration in Phase 2 if needed

### Backwards Compatibility
- Existing raids continue working
- Performance history preserved
- Tier filtering removed (all facts available)

## Success Metrics

### Technical Success
- [ ] All 4 operations working end-to-end
- [ ] No performance regression
- [ ] Clean, extensible operation abstraction
- [ ] Type safety maintained throughout

### Code Quality Metrics
- [ ] Zero new linter warnings
- [ ] Test coverage for new operations
- [ ] Clear documentation for operation extension
- [ ] Consistent patterns across operations

## Risk Mitigation

### Identified Risks
1. **Fact key format change**: May affect existing mastery records
   - *Mitigation*: Keep multiplication format unchanged initially
   
2. **Answer validation complexity**: Negative numbers, division edge cases
   - *Mitigation*: Comprehensive test suite, gradual rollout

3. **UI assumptions**: Many places assume multiplication
   - *Mitigation*: Systematic search and update

4. **Performance impact**: More operations = more complexity
   - *Mitigation*: Profile before/after, optimize hot paths

## Future Extensibility

This phase sets up for:
1. **Grade picker UI**: Operations already grade-aware
2. **Custom problem sets**: Teachers could select operations
3. **Adaptive operation selection**: Based on weakest skills
4. **Cross-operation relationships**: "Fact families" (3+4=7, 7-3=4)

## Implementation Checklist (16 hours)

### Sub-phase 1A: Backend Operations (4 hours)
- [ ] Extend Operation enum with all variants
- [ ] Implement compute() method 
- [ ] Update normalize_fact for all operations
- [ ] Write unit tests for all operations
- [ ] **Test Point:** `cargo test operations` passes

### Sub-phase 1B: Frontend Operations (3 hours)
- [ ] Update TypeScript types (may auto-generate)
- [ ] Fix ProblemDisplay for all operations
- [ ] Update answer validation (negatives, etc)
- [ ] Create test harness with mock problems
- [ ] **Test Point:** UI displays all operations correctly

### Sub-phase 1C: Fact Generation (5 hours)
- [ ] Write Python/TypeScript generation script
- [ ] Generate ~775 unique facts 
- [ ] Tag facts with grades that use them
- [ ] Output Rust and TypeScript files
- [ ] **Test Point:** Fact counts match spec exactly

### Sub-phase 1D: Integration (4 hours)
- [ ] Import generated facts into server
- [ ] Remove tier filtering in problem generation
- [ ] Full integration test
- [ ] Performance validation
- [ ] **Test Point:** All 4 operations working in game

## Conclusion

Starting with operations provides the most value with least risk. It:
1. Tests our abstraction skills early
2. Provides immediate content variety
3. Sets up clean patterns for grades
4. Can ship independently

The grade picker becomes much simpler to implement once operations are properly abstracted, as it's mostly UI work on top of a solid foundation.

## Next Steps

After Phase 1 ships successfully:
1. **Phase 2**: Grade System - Add picker, switch to grade filtering, DELETE all tier code
2. **Phase 3**: Metrics & Ranks - Bronze/Silver/Gold/Diamond/Legendary replace old tiers
3. **Phase 4**: Polish & Integration - Critical hits, XP, enhanced UI

Each phase delivers value independently while building toward the full K-5 vision.