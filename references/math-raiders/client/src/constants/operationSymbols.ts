/**
 * Operation symbols that MUST match server/src/lib.rs Operation::symbol()
 * 
 * CRITICAL: These symbols are used in fact keys stored in the database.
 * Changing these will break existing mastery data!
 * 
 * Backend source: Look for `impl Operation` and `fn symbol(&self)` in server/src/lib.rs
 * 
 * To verify these match the backend:
 * grep -B2 -A8 "fn symbol(&self)" ../server/src/lib.rs
 * 
 * Or search for this exact backend pattern:
 * Operation::Multiply => "×",
 */
export const OPERATION_SYMBOLS = {
  Add: '+',
  Subtract: '-',
  Multiply: '×',  // Unicode multiplication sign (U+00D7), NOT lowercase 'x'
  Divide: '÷',    // Unicode division sign (U+00F7), NOT forward slash
} as const;

// Type helper for operation strings
export type OperationType = keyof typeof OPERATION_SYMBOLS;

/**
 * Example fact keys that these symbols generate:
 * - Addition: "3+5" (normalized to smaller+larger)
 * - Subtraction: "8-3" (order matters)
 * - Multiplication: "4×7" (normalized to smaller×larger) 
 * - Division: "12÷3" (order matters)
 */
