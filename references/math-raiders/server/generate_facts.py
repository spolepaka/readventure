#!/usr/bin/env python3
"""
Generate math facts for K-5 based on Alpha School curriculum.
Outputs both Rust and TypeScript files.
"""

from dataclasses import dataclass
from typing import List, Set, Tuple
import json

@dataclass
class MathFact:
    left: int
    right: int
    operation: str  # '+', '-', '×', '÷'
    grades: List[int]  # 0=K, 1=1st, 2=2nd, etc.
    tracks: List[str]  # Track IDs this fact belongs to (e.g., ["TRACK11", "TRACK7"])
    
    def to_key(self) -> str:
        """Generate fact key for FactMastery table"""
        # For commutative operations, normalize to smaller first
        if self.operation in ['+', '×']:
            l, r = min(self.left, self.right), max(self.left, self.right)
            return f"{l}{self.operation}{r}"
        else:
            return f"{self.left}{self.operation}{self.right}"

def generate_kindergarten_facts() -> List[MathFact]:
    """Kindergarten: Addition Within 10 (same as G1, shares TRACK12)"""
    facts = []
    
    # TRACK12 - Addition Within 10 (Sums up to 10)
    # Same content as Grade 1 - K and G1 share this track
    for a in range(11):  # 0-10
        for b in range(11):  # 0-10
            if a + b <= 10:
                facts.append(MathFact(a, b, '+', [0], ['TRACK12']))
    
    return facts

def generate_grade1_facts() -> List[MathFact]:
    """Grade 1: Addition within 10 only"""
    facts = []
    
    # TRACK12 - Addition Within 10 (Sums up to 10)
    for a in range(11):  # 0-10
        for b in range(11):  # 0-10
            if a + b <= 10:
                facts.append(MathFact(a, b, '+', [1], ['TRACK12']))
    
    return facts

def generate_grade2_facts() -> List[MathFact]:
    """Grade 2: Single-digit addition + subtraction from 20"""
    facts = []
    
    # TRACK9 - Addition (Single-Digit Addends)
    for a in range(10):  # 0-9
        for b in range(10):  # 0-9
            facts.append(MathFact(a, b, '+', [2], ['TRACK9']))
    
    # TRACK10 - Subtraction (Single-Digit Subtrahends)
    # Includes facts like 15-7 where minuend can be > 9
    for a in range(21):  # 0-20
        for b in range(min(a + 1, 10)):  # 0-9, but not more than a
            facts.append(MathFact(a, b, '-', [2], ['TRACK10']))
    
    return facts

def generate_grade3_facts() -> List[MathFact]:
    """Grade 3: Add/sub within 20 + multiplication up to 10×10"""
    facts = []
    
    # TRACK6 - Addition (Sums up to 20)
    for a in range(21):  # 0-20
        for b in range(21 - a):  # 0 to (20-a) so sum <= 20
            facts.append(MathFact(a, b, '+', [3], ['TRACK6']))
    
    # TRACK8 - Subtraction (Minuends and Subtrahends up to 20)
    for a in range(21):  # 0-20
        for b in range(a + 1):  # 0 to a
            facts.append(MathFact(a, b, '-', [3], ['TRACK8']))
    
    # TRACK11 - Multiplication (Single-digit factors, includes 0×)
    for a in range(10):  # 0-9
        for b in range(10):  # 0-9
            facts.append(MathFact(a, b, '×', [3], ['TRACK11']))
    
    return facts

def generate_grade4_facts() -> List[MathFact]:
    """Grade 4: Multiplication up to 12×12 + related division"""
    facts = []
    
    # TRACK7 - Multiplication (Factors up to 12)
    # All 169 multiplication facts (0-12 × 0-12)
    for a in range(13):  # 0-12
        for b in range(13):  # 0-12
            facts.append(MathFact(a, b, '×', [4], ['TRACK7']))
    
    # TRACK5 - Division (Quotients up to 12)
    # All division facts that give whole number results
    for a in range(1, 13):  # 1-12 (exclude 0÷b)
        for b in range(1, 13):  # 1-12 (no divide by zero)
            # Only include a÷b if it gives a whole number result
            if a * b <= 144:  # product = a * b
                facts.append(MathFact(a * b, b, '÷', [4], ['TRACK5']))
    
    return facts

def generate_grade5_facts() -> List[MathFact]:
    """Grade 5: All operations within curriculum bounds"""
    facts = []
    
    # TRACK6 - Addition (Sums up to 20)
    for a in range(21):  # 0-20
        for b in range(21 - a):  # 0 to (20-a) so sum <= 20
            facts.append(MathFact(a, b, '+', [5], ['TRACK6']))
    
    # TRACK8 - Subtraction (Minuends and Subtrahends up to 20)
    for a in range(21):  # 0-20
        for b in range(a + 1):  # 0 to a
            facts.append(MathFact(a, b, '-', [5], ['TRACK8']))
    
    # TRACK7 - Multiplication (Factors up to 12)
    for a in range(13):  # 0-12
        for b in range(13):  # 0-12
            facts.append(MathFact(a, b, '×', [5], ['TRACK7']))
    
    # TRACK5 - Division (Quotients up to 12)
    for a in range(1, 13):  # 1-12 (exclude 0÷b)
        for b in range(1, 13):  # 1-12 (no divide by zero)
            # Only include a÷b if it gives a whole number result
            if a * b <= 144:  # product = a * b
                facts.append(MathFact(a * b, b, '÷', [5], ['TRACK5']))
    
    return facts

def deduplicate_facts(all_facts: List[MathFact]) -> List[MathFact]:
    """Merge duplicate facts and combine their grade and track lists"""
    fact_map = {}
    
    for fact in all_facts:
        key = fact.to_key()
        if key in fact_map:
            # Merge grade lists
            existing_grades = set(fact_map[key].grades)
            new_grades = set(fact.grades)
            fact_map[key].grades = sorted(list(existing_grades | new_grades))
            
            # Merge track lists
            existing_tracks = set(fact_map[key].tracks)
            new_tracks = set(fact.tracks)
            fact_map[key].tracks = sorted(list(existing_tracks | new_tracks))
        else:
            fact_map[key] = fact
    
    return list(fact_map.values())

def generate_rust_file(facts: List[MathFact]) -> str:
    """Generate Rust source file with fact data"""
    rust_code = """// THIS FILE IS AUTOMATICALLY GENERATED BY generate_facts.py
// DO NOT EDIT MANUALLY

use crate::Operation;

pub struct MathFact {
    pub left: u8,
    pub right: u8,
    pub operation: Operation,
    pub grades: &'static [u8],
    pub tracks: &'static [&'static str],
}

impl MathFact {
    pub fn to_key(&self) -> String {
        match self.operation {
            Operation::Add | Operation::Multiply => {
                // Commutative: normalize to smaller first
                let (min, max) = if self.left <= self.right { 
                    (self.left, self.right) 
                } else { 
                    (self.right, self.left) 
                };
                format!("{}{}{}", min, self.operation.symbol(), max)
            }
            Operation::Subtract | Operation::Divide => {
                // Non-commutative: keep order
                format!("{}{}{}", self.left, self.operation.symbol(), self.right)
            }
        }
    }
}

pub const ALL_FACTS: &[MathFact] = &[
"""
    
    for fact in facts:
        op_enum = {
            '+': 'Operation::Add',
            '-': 'Operation::Subtract',
            '×': 'Operation::Multiply',
            '÷': 'Operation::Divide'
        }[fact.operation]
        
        grades_str = ', '.join(str(g) for g in fact.grades)
        tracks_str = ', '.join(f'"{ t}"' for t in fact.tracks)
        rust_code += f"    MathFact {{ left: {fact.left}, right: {fact.right}, operation: {op_enum}, grades: &[{grades_str}], tracks: &[{tracks_str}] }},\n"
    
    rust_code += """];

pub fn get_facts_for_grade(grade: u8) -> Vec<&'static MathFact> {
    ALL_FACTS.iter()
        .filter(|f| f.grades.contains(&grade))
        .collect()
}

pub fn get_facts_for_grade_and_track(grade: u8, track: &str) -> Vec<&'static MathFact> {
    ALL_FACTS.iter()
        .filter(|f| f.grades.contains(&grade) && f.tracks.contains(&track))
        .collect()
}


pub fn parse_fact_key(fact_key: &str) -> Option<(u8, u8, Operation)> {
    // Handle empty strings
    if fact_key.is_empty() {
        return None;
    }
    
    // Try each operation symbol
    if let Some(pos) = fact_key.find('+') {
        let left = fact_key[..pos].parse().ok()?;
        let right = fact_key[pos+'+'.len_utf8()..].parse().ok()?;
        return Some((left, right, Operation::Add));
    }
    if let Some(pos) = fact_key.find('-') {
        let left = fact_key[..pos].parse().ok()?;
        let right = fact_key[pos+'-'.len_utf8()..].parse().ok()?;
        return Some((left, right, Operation::Subtract));
    }
    if let Some(pos) = fact_key.find('×') {
        let left = fact_key[..pos].parse().ok()?;
        let right = fact_key[pos+'×'.len_utf8()..].parse().ok()?;
        return Some((left, right, Operation::Multiply));
    }
    if let Some(pos) = fact_key.find('÷') {
        let left = fact_key[..pos].parse().ok()?;
        let right = fact_key[pos+'÷'.len_utf8()..].parse().ok()?;
        return Some((left, right, Operation::Divide));
    }
    
    // Legacy support for 'x' as multiply
    if let Some(pos) = fact_key.find('x') {
        let left = fact_key[..pos].parse().ok()?;
        let right = fact_key[pos+'x'.len_utf8()..].parse().ok()?;
        return Some((left, right, Operation::Multiply));
    }
    
    None
}
"""
    
    return rust_code

def generate_typescript_file(facts: List[MathFact]) -> str:
    """Generate TypeScript source file with fact data"""
    ts_code = """// THIS FILE IS AUTOMATICALLY GENERATED BY generate_facts.py
// DO NOT EDIT MANUALLY

import Operation from '../spacetime/operation_type';
import type { Infer } from 'spacetimedb';

type OperationVariant = Infer<typeof Operation>;

export interface MathFact {
  left: number;
  right: number;
  operation: OperationVariant;
  grades: number[];
  tracks: string[];
}

export const ALL_FACTS: MathFact[] = [
"""
    
    for fact in facts:
        op_ts = {
            '+': 'Operation.Add',
            '-': 'Operation.Subtract',
            '×': 'Operation.Multiply',
            '÷': 'Operation.Divide'
        }[fact.operation]
        
        grades_str = ', '.join(str(g) for g in fact.grades)
        tracks_str = ', '.join(f"'{t}'" for t in fact.tracks)
        ts_code += f"  {{ left: {fact.left}, right: {fact.right}, operation: {op_ts}, grades: [{grades_str}], tracks: [{tracks_str}] }},\n"
    
    ts_code += """];

export function getFactsForGrade(grade: number): MathFact[] {
  return ALL_FACTS.filter(f => f.grades.includes(grade));
}

export function getFactsForGradeAndTrack(grade: number, track: string): MathFact[] {
  return ALL_FACTS.filter(f => f.grades.includes(grade) && f.tracks.includes(track));
}

export function getFactKey(fact: MathFact): string {
  const op = fact.operation;
  if (op.tag === 'Add' || op.tag === 'Multiply') {
    // Commutative: normalize to smaller first
    const min = Math.min(fact.left, fact.right);
    const max = Math.max(fact.left, fact.right);
    const symbol = op.tag === 'Add' ? '+' : '×';
    return `${min}${symbol}${max}`;
  } else {
    // Non-commutative: keep order
    const symbol = op.tag === 'Subtract' ? '-' : '÷';
    return `${fact.left}${symbol}${fact.right}`;
  }
}
"""
    
    return ts_code

def main():
    """Generate all facts and output files"""
    print("Generating math facts for K-5...")
    
    # Generate facts for each grade
    all_facts = []
    
    print("Generating Kindergarten facts...")
    k_facts = generate_kindergarten_facts()
    all_facts.extend(k_facts)
    print(f"  Generated {len(k_facts)} facts")
    
    print("Generating Grade 1 facts...")
    g1_facts = generate_grade1_facts()
    all_facts.extend(g1_facts)
    print(f"  Generated {len(g1_facts)} facts")
    
    print("Generating Grade 2 facts...")
    g2_facts = generate_grade2_facts()
    all_facts.extend(g2_facts)
    print(f"  Generated {len(g2_facts)} facts")
    
    print("Generating Grade 3 facts...")
    g3_facts = generate_grade3_facts()
    all_facts.extend(g3_facts)
    print(f"  Generated {len(g3_facts)} facts")
    
    print("Generating Grade 4 facts...")
    g4_facts = generate_grade4_facts()
    all_facts.extend(g4_facts)
    print(f"  Generated {len(g4_facts)} facts")
    
    print("Generating Grade 5 facts...")
    g5_facts = generate_grade5_facts()
    all_facts.extend(g5_facts)
    print(f"  Generated {len(g5_facts)} facts")
    
    print(f"\nTotal facts before deduplication: {len(all_facts)}")
    
    # Deduplicate and merge grade lists
    unique_facts = deduplicate_facts(all_facts)
    print(f"Total unique facts: {len(unique_facts)}")
    
    # VERIFICATION: Check that all facts are truly unique
    print("\n=== VERIFYING UNIQUENESS ===")
    fact_keys = [f.to_key() for f in unique_facts]
    fact_set = set(fact_keys)
    print(f"Total fact keys: {len(fact_keys)}")
    print(f"Unique fact keys: {len(fact_set)}")
    if len(fact_keys) == len(fact_set):
        print("✅ VERIFIED: All facts are unique!")
    else:
        print("❌ ERROR: Found duplicate facts!")
        # Find and print duplicates
        from collections import Counter
        counts = Counter(fact_keys)
        for key, count in counts.items():
            if count > 1:
                print(f"  Duplicate: {key} appears {count} times")
    
    # Show some example unique facts
    print("\nExample unique facts:")
    examples = [
        ("3+5", "Only stored as 3+5, not 5+3"),
        ("7×4", "Only stored as 4×7 (smaller first)"),
        ("10-3", "Stored as 10-3 (subtraction not commutative)"),
        ("12÷3", "Stored as 12÷3 (division not commutative)")
    ]
    for fact_key, explanation in examples:
        matching = [f for f in unique_facts if f.to_key() == fact_key or 
                   (f.operation in ['+', '×'] and f"{f.right}{f.operation}{f.left}" == fact_key)]
        if matching:
            f = matching[0]
            # Compute answer for display
            answer = {
                '+': f.left + f.right,
                '-': f.left - f.right,
                '×': f.left * f.right,
                '÷': f.left // f.right if f.right != 0 else 0
            }[f.operation]
            print(f"  {f.to_key()} = {answer} - {explanation}")
    
    # Sort facts for consistent output
    unique_facts.sort(key=lambda f: (
        ['+', '-', '×', '÷'].index(f.operation),
        f.left,
        f.right
    ))
    
    # Count by operation
    op_counts = {}
    for fact in unique_facts:
        op_counts[fact.operation] = op_counts.get(fact.operation, 0) + 1
    
    print("\nFacts by operation:")
    for op, count in sorted(op_counts.items()):
        print(f"  {op}: {count}")
    
    # Additional verification: Show that we don't have both 3+5 and 5+3
    print("\n=== COMMUTATIVE VERIFICATION ===")
    print("Checking that we don't store both orders of commutative operations...")
    
    # Check addition
    add_facts = [f for f in unique_facts if f.operation == '+']
    found_duplicate = False
    for fact in add_facts:
        reverse_key = f"{fact.right}+{fact.left}"
        if fact.left != fact.right:  # Skip symmetric facts like 5+5
            reverse_exists = any(f.to_key() == reverse_key for f in add_facts)
            if reverse_exists:
                print(f"❌ Found both {fact.to_key()} and {reverse_key}")
                found_duplicate = True
    
    if not found_duplicate:
        print("✅ Addition: No reversed duplicates found (e.g., only 3+5, not 5+3)")
    
    # Check multiplication
    mult_facts = [f for f in unique_facts if f.operation == '×']
    found_duplicate = False
    for fact in mult_facts:
        reverse_key = f"{fact.right}×{fact.left}"
        if fact.left != fact.right:  # Skip symmetric facts like 5×5
            reverse_exists = any(f.to_key() == reverse_key for f in mult_facts)
            if reverse_exists:
                print(f"❌ Found both {fact.to_key()} and {reverse_key}")
                found_duplicate = True
    
    if not found_duplicate:
        print("✅ Multiplication: No reversed duplicates found (e.g., only 3×7, not 7×3)")
    
    # Generate output files
    print("\nGenerating Rust file...")
    rust_code = generate_rust_file(unique_facts)
    with open('src/math_facts.rs', 'w') as f:
        f.write(rust_code)
    print("  Wrote src/math_facts.rs")
    
    print("Generating TypeScript file...")
    ts_code = generate_typescript_file(unique_facts)
    with open('../client/src/data/mathFacts.ts', 'w') as f:
        f.write(ts_code)
    print("  Wrote ../client/src/data/mathFacts.ts")
    
    print("\nDone! Generated {} unique facts.".format(len(unique_facts)))

if __name__ == "__main__":
    main()
