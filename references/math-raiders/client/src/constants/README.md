# Constants Directory

## operationSymbols.ts

**CRITICAL**: These symbols MUST match the backend implementation in `server/src/lib.rs`.

### Why This Matters
- Fact keys are stored in the database using these symbols
- Mismatched symbols = mastery data won't display
- Example: Frontend "3x7" won't match backend "3×7"

### How to Verify Sync
```bash
# Find the backend symbol function:
grep -B2 -A8 "fn symbol(&self)" ../../server/src/lib.rs

# Or search for the match patterns:
grep -A4 "Operation::Multiply =>" ../../server/src/lib.rs

# Expected patterns:
# Operation::Add => "+"
# Operation::Subtract => "-"  
# Operation::Multiply => "×"
# Operation::Divide => "÷"
```

### Where These Are Used
1. `utils/factKeys.ts` - Generating fact keys for mastery lookup
2. `components/LobbyScreen.tsx` - Displaying mastery grid
3. `FactMastery` table - Database storage

### If You Need to Change These
1. Update both frontend and backend
2. Consider data migration for existing fact_mastery records
3. Test that mastery data still displays correctly
