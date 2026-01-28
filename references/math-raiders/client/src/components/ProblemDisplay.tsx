import { memo } from 'react';
import { motion } from 'framer-motion';
import Operation from '../spacetime/operation_type';
import type { Infer } from 'spacetimedb';

type OperationVariant = Infer<typeof Operation>;

interface ProblemDisplayProps {
  leftOperand: number;
  rightOperand: number;
  operation: OperationVariant;
}

// Get operation symbol
const getOperationSymbol = (op: OperationVariant) => {
  switch (op.tag) {
    case 'Add':
      return '+';
    case 'Subtract':
      return '−';  // Using proper minus sign
    case 'Multiply':
      return '×';
    case 'Divide':
      return '÷';
    default:
      return '×';
  }
};

// Memoized problem display - only re-renders when problem changes
export const ProblemDisplay = memo(function ProblemDisplay({ 
  leftOperand, 
  rightOperand, 
  operation 
}: ProblemDisplayProps) {
  return (
    <div className="text-7xl font-black text-white flex items-center justify-center gap-2">
      <motion.span
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ 
          delay: 0,
          duration: 0.05,
          ease: "easeOut"
        }}
        className="drop-shadow-[0_4px_8px_rgba(0,0,0,0.3)] tabular-nums"
      >
        {leftOperand}
      </motion.span>
      <motion.span
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.012, duration: 0.05, ease: "easeOut" }}
        className="text-6xl text-yellow-400 drop-shadow-[0_0_20px_rgba(250,204,21,0.4)] mx-2"
      >
        {getOperationSymbol(operation)}
      </motion.span>
      <motion.span
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ 
          delay: 0.024,
          duration: 0.05,
          ease: "easeOut"
        }}
        className="drop-shadow-[0_4px_8px_rgba(0,0,0,0.3)] tabular-nums"
      >
        {rightOperand}
      </motion.span>
      <motion.span
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.032, duration: 0.05, ease: "easeOut" }}
        className="text-6xl text-emerald-400 drop-shadow-[0_0_20px_rgba(52,211,153,0.4)] ml-2"
      >
        =
      </motion.span>
      <motion.span
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.04, duration: 0.05, ease: "easeOut" }}
        className="text-6xl text-emerald-400 drop-shadow-[0_0_20px_rgba(52,211,153,0.4)] ml-3"
      >
        ?
      </motion.span>
    </div>
  );
});































