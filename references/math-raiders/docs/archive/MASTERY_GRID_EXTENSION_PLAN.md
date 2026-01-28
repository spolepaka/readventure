# Mastery Grid Extension Implementation Plan

## Overview

Transform the multiplication-only mastery grid into a multi-operation mastery tracker that adapts to each grade level.

**Total Implementation Time: ~5.5-6.5 hours**

## Plan Status: ✅ READY FOR IMPLEMENTATION

This plan has been thoroughly reviewed against the existing codebase and includes:
- All architectural decisions finalized
- Edge cases identified and solutions provided  
- Line-by-line code references
- Testing strategy for each phase
- Performance considerations addressed

## Core Philosophy (Nystrom's "Make It Right First")

### 1. Model the Domain Correctly
```typescript
// Start with data structures that make invalid states impossible
type MathOperation = 'add' | 'subtract' | 'multiply' | 'divide';

interface OperationConfig {
  symbol: string;
  commutative: boolean;
  isValidFact: (left: number, right: number) => boolean;
}

// This data structure drives EVERYTHING
const OPERATIONS: Record<MathOperation, OperationConfig> = {
  add: {
    symbol: '+',
    commutative: true,
    isValidFact: () => true,
  },
  subtract: {
    symbol: '-',
    commutative: false,
    isValidFact: (left, right) => left >= right, // No negatives
  },
  multiply: {
    symbol: '×',
    commutative: true,
    isValidFact: () => true,
  },
  divide: {
    symbol: '÷',
    commutative: false,
    isValidFact: (left, right) => right !== 0 && left % right === 0,
  },
};
```

### 2. One Component, Many Uses
```typescript
// Not MultiplicationGrid, AdditionGrid, etc.
// Just one MasteryGrid that handles all operations
<MasteryGrid 
  operation={selectedOperation}
  grade={currentPlayer.grade}
  factMasteries={factMasteries}
/>
```

### 3. Adaptive Grid Sizing with Overflow
```typescript
// Different max sizes per operation
const MAX_GRID_SIZE = {
  multiply: 12,   // All multiplication facts fit in 12×12
  divide: 12,     // All division facts fit in 12×12
  add: 15,        // Most addition facts fit in 15×15
  subtract: 15    // Most subtraction facts fit in 15×15
} as const;

// For facts beyond grid range (e.g., 16+4=20), show overflow indicator
interface GridWithOverflow {
  visibleFacts: MathFact[];  // Facts shown in grid
  overflowFacts: MathFact[]; // Facts beyond grid range
  showOverflowIndicator: boolean;
}
```

## Key Design Decisions

### Grid Sizing Strategy
- **Multiplication/Division**: 12×12 max (covers all facts 0-12)
- **Addition/Subtraction**: 15×15 max (covers most facts)
- **Overflow**: Facts beyond grid range (e.g., 16+4) shown via "+X more facts" button
- **Rationale**: Fits on Chromebooks, maintains visual consistency, follows progressive disclosure

## Implementation Phases

### Phase 0: Fix Current Code & Prepare (45 min)
**Goal**: Make existing multiplication grid use correct fact keys and prepare for multi-operation

1. Update line 431 in LobbyScreen.tsx:
   ```tsx
   // OLD: const factKey = `${Math.min(row, col)}x${Math.max(row, col)}`;
   // NEW: const factKey = generateFactKey(row, col, 'multiply');
   ```

2. Import required data:
   ```tsx
   import { ALL_FACTS } from '../data/mathFacts';
   import { OPERATION_SYMBOLS } from '../constants/operationSymbols';
   ```

3. Note current implementation details:
   - Grid starts at 1, not 0 (line 386: `[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]`)
   - Need to handle 0 row/column for addition and division
   - Title "Multiplication Facts" is hardcoded (line 407)
   - Column headers show "×1, ×2" etc (lines 416-417)

**Verification**: 
- Multiplication grid shows mastery levels with new fact key format
- Tooltips work
- No console errors
- Mastery data still displays correctly

### Phase 1: Add Operation State + UI Buttons (1 hour)
**Goal**: Add operation selection state AND visible buttons (combining original Phase 1 + Phase 4.1)

#### Step 1: Add Required Imports
At the top of LobbyScreen.tsx, add:
```typescript
import { ALL_FACTS } from '../data/mathFacts';
import { OPERATION_SYMBOLS } from '../constants/operationSymbols';
```

#### Step 2: Add Type Definition
After imports, add:
```typescript
type MathOperation = 'add' | 'subtract' | 'multiply' | 'divide';
```

#### Step 3: Add State and Logic
After other state declarations (around line 50-60), add:
```typescript
// Determine available operations based on grade
const availableOperations = useMemo(() => {
  const ops = new Set<string>();
  ALL_FACTS
    .filter(f => f.grades.includes(currentPlayer?.grade || 3))
    .forEach(f => {
      // Convert tag to lowercase for our state
      const opName = f.operation.tag.toLowerCase() as MathOperation;
      ops.add(opName);
    });
  return Array.from(ops).sort() as MathOperation[];
}, [currentPlayer?.grade]);

// Operation selection state with smart defaults
const [selectedOperation, setSelectedOperation] = useState<MathOperation>(() => {
  const playerId = currentPlayer?.id;
  if (playerId) {
    const stored = localStorage.getItem(`mastery-op-${playerId}`) as MathOperation;
    if (stored && availableOperations.includes(stored)) return stored;
  }
  
  // Smart defaults based on grade
  const grade = currentPlayer?.grade || 3;
  if (grade <= 2) return 'add';
  if (grade === 3) return 'multiply';
  if (grade === 4) return 'divide';
  return 'multiply';
});

// Update localStorage when selection changes
useEffect(() => {
  if (currentPlayer?.id) {
    localStorage.setItem(`mastery-op-${currentPlayer.id}`, selectedOperation);
  }
}, [selectedOperation, currentPlayer?.id]);
```

#### Step 4: Add Operation Selector UI
Inside the mastery grid section, after the `showMasteryGrid && (` check (around line 375), add buttons BEFORE the grid:
```typescript
{showMasteryGrid && (
  <motion.div
    initial={false}
    animate={{ /* existing animation */ }}
    className="overflow-visible"
  >
    <div className="mt-3 p-4 bg-gray-800/50 rounded-lg overflow-visible relative">
      {/* NEW: Operation selector buttons */}
      <div className="flex gap-1 mb-4 justify-center">
        {availableOperations.map(op => (
          <button
            key={op}
            onClick={() => setSelectedOperation(op)}
            className={cn(
              "px-3 py-1 rounded text-lg font-bold transition-colors",
              selectedOperation === op
                ? "bg-purple-600 text-white"
                : "bg-gray-700 text-gray-400 hover:bg-gray-600"
            )}
          >
            {OPERATION_SYMBOLS[op.charAt(0).toUpperCase() + op.slice(1)]}
          </button>
        ))}
      </div>
      
      {/* Existing Mastery Grid content continues here... */}
      <div className="pt-8 pb-8">
        {/* ... existing grid code ... */}
```

**Verification**:
- Operation buttons appear above the grid
- Buttons show based on grade (K: +/-, Grade 3: +/-/×, Grade 5: all)
- Purple highlight on selected operation
- Clicking changes selection
- LocalStorage persists across refresh
- Console shows no errors
- Grid still shows multiplication (that's Phase 2)

### Phase 2: Extract Grid Component (2 hours)
**Goal**: Pull grid logic into reusable component

#### Phase 2.1: Create Component Structure (30 min)
**Goal**: Set up the new component file with proper imports

```typescript
// New file: client/src/components/MasteryGrid.tsx
import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../lib/utils';
import { generateFactKey } from '../utils/factKeys';
import { OPERATION_SYMBOLS } from '../constants/operationSymbols';
import { ALL_FACTS } from '../data/mathFacts';
import type { FactMastery } from '../spacetime/fact_mastery_type';

type MathOperation = 'add' | 'subtract' | 'multiply' | 'divide';

interface MasteryGridProps {
  operation: MathOperation;
  factMasteries: FactMastery[];
  grade: number;
}

export function MasteryGrid({ 
  operation, 
  factMasteries,
  grade
}: MasteryGridProps) {
  return <div>Grid placeholder</div>;
}
```

**Verification**:
- File created at correct path
- All imports resolve
- Component exports properly

#### Phase 2.2: Move Grid Logic (45 min)
**Goal**: Cut and paste the grid rendering code

1. **Cut from LobbyScreen.tsx** (lines 376-484):
   - The entire grid rendering block inside the return statement
   - The masteryMap building logic
   - The numbers array definition

2. **Paste into MasteryGrid component**:
   ```typescript
   export function MasteryGrid({ operation, factMasteries, grade }: MasteryGridProps) {
     // Build mastery lookup map (from line 378-381)
     const masteryMap: Record<string, typeof factMasteries[0]> = {};
     factMasteries.forEach(fm => {
       masteryMap[fm.factKey] = fm;
     });
     
     // Grid dimensions (from line 386)
     const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
     
     // Paste the entire return block from lines 400-483
     return (
       <div className="max-w-lg mx-auto">
         {/* Grid content here */}
       </div>
     );
   }
   ```

**Verification**:
- Grid code removed from LobbyScreen
- Grid code renders in MasteryGrid
- No TypeScript errors

#### Phase 2.3: Wire Up Props & Integration (30 min)
**Goal**: Connect the new component to LobbyScreen

1. **In LobbyScreen.tsx**, add import:
   ```typescript
   import { MasteryGrid } from './MasteryGrid';
   ```

2. **Replace the cut grid code** with:
   ```typescript
   <MasteryGrid 
     operation="multiply"  // Hardcoded for now
     factMasteries={factMasteries}
     grade={currentPlayer.grade}
   />
   ```

3. **Test that multiplication still works exactly the same**

**Verification**:
- Multiplication grid displays
- Tooltips work
- Mastery levels show correctly
- No visual changes

#### Phase 2.4: Make Grid Dynamic (15 min)
**Goal**: Replace hardcoded values with dynamic ones

1. **Update grid title** (line ~407 in component):
   ```typescript
   // OLD: <h4 className="text-sm font-bold text-white">Multiplication Facts</h4>
   // NEW: 
   const operationName = operation.charAt(0).toUpperCase() + operation.slice(1);
   <h4 className="text-sm font-bold text-white">{operationName} Facts</h4>
   ```

2. **Update column headers** (line ~417):
   ```typescript
   // OLD: ×{n}
   // NEW:
   const opSymbol = OPERATION_SYMBOLS[operation.charAt(0).toUpperCase() + operation.slice(1)];
   {opSymbol}{n}
   ```

3. **Update row headers** (line ~426):
   ```typescript
   // OLD: {row}×
   // NEW: {row}{opSymbol}
   ```

4. **Update fact key generation** (line ~431):
   ```typescript
   // OLD: const factKey = `${Math.min(row, col)}x${Math.max(row, col)}`;
   // NEW: const factKey = generateFactKey(row, col, operation);
   ```

**Verification**:
- Title changes when operation prop changes
- Headers show correct symbols
- Fact keys use proper format

### Phase 3: Add Division Logic (1 hour)
**Goal**: Handle invalid division cells and operation-specific logic

```typescript
// In MasteryGrid component, update cell rendering logic
const renderCell = (row: number, col: number) => {
  // Check if this is a valid fact for the operation
  const isValidFact = () => {
    switch (operation) {
      case 'divide':
        return col !== 0 && row % col === 0;
      case 'subtract':
        return row >= col; // No negative results for K-5
      default:
        return true; // Add and multiply are always valid
    }
  };
  
  if (!isValidFact()) {
    // Render disabled cell
    return (
      <div
        key={`${row}-${col}`}
        className="aspect-square flex items-center justify-center
                   rounded text-xs font-bold bg-gray-700 opacity-30 
                   cursor-not-allowed"
        aria-disabled="true"
        title={operation === 'divide' ? "No whole number result" : "Negative result"}
      >
        {/* Empty or show a subtle × */}
      </div>
    );
  }
  
  // Normal cell rendering with mastery levels
  const factKey = generateFactKey(row, col, operation);
  const mastery = masteryMap[factKey];
  const level = mastery?.masteryLevel || 0;
  
  // Calculate the result for display
  const result = operation === 'add' ? row + col :
                 operation === 'subtract' ? row - col :
                 operation === 'multiply' ? row * col :
                 operation === 'divide' ? row / col : 0;
  
  return (
    <div
      key={`${row}-${col}`}
      // ... existing cell styling and tooltips
    >
      {Math.floor(result)}
    </div>
  );
};
```

**Key Changes**:
- Division by zero shows disabled
- Non-whole division results show disabled
- Subtraction with negative results shows disabled
- Cell displays correct result based on operation

**Verification**:
- Division grid shows with proper disabled cells
- 0÷n shows as 0 (valid)
- n÷0 shows as disabled
- 7÷3 shows as disabled (no whole result)
- Subtraction doesn't show negative results

### Phase 4: Add All Operations with Overflow (1 hour) 
**Goal**: Enable all four operations with overflow handling

#### Phase 4.1: Connect Operations to Grid (30 min)
**Goal**: Make the grid respond to operation selection

1. **Update MasteryGrid usage in LobbyScreen**:
   ```typescript
   // OLD:
   <MasteryGrid 
     operation="multiply"
     factMasteries={factMasteries}
     grade={currentPlayer.grade}
   />
   
   // NEW:
   <MasteryGrid 
     operation={selectedOperation}
     factMasteries={factMasteries}
     grade={currentPlayer.grade}
   />
   ```

2. **Update MasteryGrid for adaptive sizing**:
   ```typescript
   // At top of MasteryGrid component:
   const MAX_GRID_SIZE = {
     multiply: 12,
     divide: 12,
     add: 15,
     subtract: 15
   } as const;
   
   const maxSize = MAX_GRID_SIZE[operation];
   
   // Update numbers array:
   const includeZero = operation !== 'multiply';
   const numbers = includeZero 
     ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].slice(0, maxSize + 1)
     : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].slice(0, maxSize);
   ```

3. **Update grid CSS for variable size**:
   ```typescript
   // Change grid-cols-13 to use style prop for dynamic columns:
   <div 
     className="grid gap-1 text-[10px] w-full"
     style={{
       gridTemplateColumns: `repeat(${includeZero ? maxSize + 2 : maxSize + 1}, minmax(0, 1fr))`
     }}
   >
   ```

**Verification**:
- Addition shows 0-15 grid
- Multiplication shows 1-12 grid
- Each operation displays correctly

#### Phase 4.3: Add Overflow Handling (30 min)
**Goal**: Show indicator for facts beyond grid range

1. **Calculate overflow in MasteryGrid**:
   ```typescript
   // Add after maxSize calculation:
   const allFacts = ALL_FACTS.filter(f => 
     f.operation.tag.toLowerCase() === operation && 
     f.grades.includes(grade)
   );
   
   const overflowCount = allFacts.filter(f => 
     f.left > maxSize || f.right > maxSize
   ).length;
   ```

2. **Add overflow state and modal**:
   ```typescript
   const [showOverflowModal, setShowOverflowModal] = useState(false);
   ```

3. **Update MasteryGrid return to include overflow**:
   ```typescript
   return (
     <>
       <div className="max-w-lg mx-auto">
         {/* Existing grid rendering */}
       </div>
       
       {/* Overflow indicator */}
       {overflowCount > 0 && (
         <div className="mt-4 text-center">
           <button 
             onClick={() => setShowOverflowModal(true)}
             className="text-gray-400 hover:text-white transition-colors text-sm"
           >
             +{overflowCount} more facts ({maxSize + 1}-20) →
           </button>
         </div>
       )}
       
       {/* Simple overflow modal */}
       {showOverflowModal && (
         <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
              onClick={() => setShowOverflowModal(false)}>
           <div className="bg-gray-800 p-6 rounded-lg max-w-md">
             <h3 className="text-white font-bold mb-4">Extended Facts</h3>
             <p className="text-gray-300">
               Facts like 16+4=20 are tracked but not shown in the main grid.
             </p>
             <button className="mt-4 px-4 py-2 bg-purple-600 text-white rounded">
               Close
             </button>
           </div>
         </div>
       )}
     </>
   );
   ```

**Verification**:
- Grade 5 addition shows "+X more facts" button
- Clicking shows modal
- Modal explains overflow facts
- Grid remains clean and focused

### Phase 5: Polish & Edge Cases (1 hour)
**Goal**: Handle all edge cases gracefully

1. Empty states (no facts for operation/grade)
2. Loading states
3. Error boundaries
4. Accessibility (ARIA labels)
5. Mobile responsiveness

## Testing Strategy

### Grade-by-Grade Testing
Test each grade in order of complexity:

1. **Grade 3** (most complex - has all operations)
   - Verify all 4 operations appear
   - Check grid ranges are correct
   - Confirm mastery data displays

2. **Kindergarten** (edge case - limited operations)
   - Only [+] [-] buttons show
   - Grid shows 0-5 range
   - No multiplication/division

3. **Grade 1** (edge case - single operation)
   - Only [+] button shows
   - Grid shows 0-10 range

4. **Grade 5** (edge case - large ranges)
   - Verify 12×12 cap works
   - Check all operations

### Visual Regression Testing
1. Screenshot current multiplication grid
2. After each phase, compare visually
3. Ensure no unintended changes

## Success Criteria

- [ ] All grades see appropriate operations
- [ ] Fact keys match backend format (×, ÷, +, -)
- [ ] Division cells show disabled state clearly
- [ ] Grid sizes adapt per operation (12 for ×/÷, 15 for +/-)
- [ ] Overflow facts (16-20) are accessible via indicator
- [ ] Performance unchanged from current
- [ ] No duplicate code between operations
- [ ] LocalStorage persistence works
- [ ] Existing mastery data displays correctly

## Nystrom's Final Wisdom

> "The best code is code that doesn't surprise you. Make the grid work the same way for every operation. The only thing that changes is the data."

Keep it simple:
1. One grid component
2. Configuration drives behavior
3. Let the data tell you what to display
4. Don't optimize until you measure

## Critical Implementation Notes

### Watch Out For:

1. **Fact Key Format**
   - Backend uses Unicode: `3×7`, `8÷2`
   - Current frontend uses: `3x7`
   - MUST use generateFactKey() everywhere

2. **Operation Tag Format**
   - ALL_FACTS uses: `operation.tag = 'Add'` (capitalized)
   - Our state uses: `'add'` (lowercase)
   - Need consistent conversion

3. **Grid Starting Point**
   - Current grid: [1, 2, 3...12]
   - Need to add 0 for other operations
   - Grid layout shifts by 1 column
   - Update grid-cols-13 to grid-cols-14 when including 0

4. **Performance Considerations**
   - Grade 5 could render 15×15 = 225 cells
   - Consider React.memo for cell components
   - Overflow facts need efficient filtering

### Testing Edge Cases:

1. **Kindergarten** - Only sees + and -, grid goes 0-5
2. **Grade 1** - Only sees +, no subtraction
3. **Grade 3** - First time seeing ×, should default to it
4. **Division by zero** - Must show as disabled
5. **Grade transitions** - Operation selection should persist

## Code Complete Checklist

- [ ] Fix line 431 to use generateFactKey
- [ ] Import ALL_FACTS and OPERATION_SYMBOLS
- [ ] Remove all console.logs
- [ ] Add error boundaries
- [ ] Update component documentation
- [ ] Test on actual Chromebook
- [ ] Verify with real student account
- [ ] Check all grade transitions
- [ ] Verify mastery data displays correctly
- [ ] Test overflow indicator for Grade 5 addition
