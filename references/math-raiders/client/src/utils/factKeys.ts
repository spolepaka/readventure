/**
 * Utilities for generating fact keys that match the backend format
 * 
 * These fact keys are stored in the database and MUST match the backend format exactly.
 * See constants/operationSymbols.ts for the symbol definitions.
 */

import Operation from '../spacetime/operation_type';
import type { Infer } from 'spacetimedb';
import { OPERATION_SYMBOLS, OperationType } from '../constants/operationSymbols';

/**
 * Get the symbol for an operation that matches backend
 */
type OperationVariant = Infer<typeof Operation>;

export function getOperationSymbol(operation: OperationVariant | string): string {
  if (typeof operation === 'string') {
    // Handle string inputs - convert to standard format
    const normalized = operation.charAt(0).toUpperCase() + operation.slice(1).toLowerCase();
    
    // Handle variations
    switch (normalized) {
      case 'Add':
      case 'Addition':
        return OPERATION_SYMBOLS.Add;
      case 'Subtract':
      case 'Subtraction':
        return OPERATION_SYMBOLS.Subtract;
      case 'Multiply':
      case 'Multiplication':
        return OPERATION_SYMBOLS.Multiply;
      case 'Divide':
      case 'Division':
        return OPERATION_SYMBOLS.Divide;
      default:
        return OPERATION_SYMBOLS.Multiply; // Default
    }
  } else {
    // Handle Operation enum - use centralized symbols
    return OPERATION_SYMBOLS[operation.tag as OperationType] || OPERATION_SYMBOLS.Multiply;
  }
}

/**
 * Generate a fact key that matches the backend format
 * For commutative operations (+ and ×), smaller number goes first
 */
export function generateFactKey(
  left: number, 
  right: number, 
  operation: OperationVariant | string
): string {
  const symbol = getOperationSymbol(operation);
  
  // Commutative operations: normalize to smaller first
  if (symbol === OPERATION_SYMBOLS.Add || symbol === OPERATION_SYMBOLS.Multiply) {
    const min = Math.min(left, right);
    const max = Math.max(left, right);
    return `${min}${symbol}${max}`;
  }
  
  // Non-commutative: keep order
  return `${left}${symbol}${right}`;
}

/**
 * Parse a fact key into its components
 */
export function parseFactKey(factKey: string): {
  left: number;
  right: number;
  operation: string;
} | null {
  // Try each operation symbol from our constants
  for (const symbol of Object.values(OPERATION_SYMBOLS)) {
    const index = factKey.indexOf(symbol);
    if (index > 0) {
      const left = parseInt(factKey.slice(0, index));
      const right = parseInt(factKey.slice(index + 1));
      
      if (!isNaN(left) && !isNaN(right)) {
        return { left, right, operation: symbol };
      }
    }
  }
  
  // Legacy support for 'x' as multiply (backend also supports this)
  const xIndex = factKey.indexOf('x');
  if (xIndex > 0) {
    const left = parseInt(factKey.slice(0, xIndex));
    const right = parseInt(factKey.slice(xIndex + 1));
    
    if (!isNaN(left) && !isNaN(right)) {
      return { left, right, operation: OPERATION_SYMBOLS.Multiply };
    }
  }
  
  return null;
}
