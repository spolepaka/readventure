#!/usr/bin/env bun
/**
 * Count totalLessons for each grade (matching AlphaMath structure)
 * Counts commutative facts twice: 5×6 and 6×5 = 2 lessons
 */

import { getFactsForGrade } from '../../client/src/data/mathFacts';

console.log('Counting totalLessons per grade (AlphaMath format):\n');

for (let grade = 0; grade <= 5; grade++) {
  const facts = getFactsForGrade(grade);
  
  let totalLessons = 0;
  
  for (const fact of facts) {
    const isCommutative = fact.operation.tag === 'Add' || fact.operation.tag === 'Multiply';
    const isSymmetric = fact.left === fact.right;
    
    if (isCommutative && !isSymmetric) {
      totalLessons += 2;  // 5×6 and 6×5 count separately
    } else {
      totalLessons += 1;  // 5×5 or divide/subtract
    }
  }
  
  const gradeLabel = grade === 0 ? 'K' : grade;
  console.log(`Grade ${gradeLabel}: ${totalLessons} totalLessons (${facts.length} unique facts)`);
}














