import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../store/gameStore';

interface RoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedTrack?: string;  // Track selected by player
}

const LOADING_MESSAGES = [
  { message: 'Connecting to room...', delay: 0 },
  { message: 'Checking room code...', delay: 800 },
  { message: 'Almost there...', delay: 1800 }
];

/**
 * Join Room Modal - handles entering a 4-letter room code to join a private room.
 * Room creation happens via MasteryTrialsModal → MatchmakingScreen flow.
 */
export default function RoomModal({ isOpen, onClose, selectedTrack }: RoomModalProps) {
  const [roomCode, setRoomCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [loadingMessage, setLoadingMessage] = useState('Connecting to room...');
  const loadingTimersRef = useRef<NodeJS.Timeout[]>([]);
  // Use selectors to prevent re-renders
  const joinPrivateRoom = useGameStore(state => state.joinPrivateRoom);
  const currentRaid = useGameStore(state => state.currentRaid);
  
  // Focus input when modal opens (without scrolling)
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus({ preventScroll: true });
    }
  }, [isOpen]);
  
  // Helper to clean up all timers
  const cleanupTimers = () => {
    if (checkIntervalRef.current) {
      clearInterval(checkIntervalRef.current);
      checkIntervalRef.current = null;
    }
    loadingTimersRef.current.forEach(timer => clearTimeout(timer));
    loadingTimersRef.current = [];
  };
  
  // Clear state and any pending intervals when modal closes
  useEffect(() => {
    if (!isOpen) {
      setRoomCode('');
      setError('');
      setIsLoading(false);
      setLoadingMessage('Connecting to room...');
      cleanupTimers();
    }
  }, [isOpen]);

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => cleanupTimers();
  }, []);
  
  // Handle ESC key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isLoading) {
        onClose();
      }
    };
    
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, isLoading, onClose]);

  const handleJoin = async () => {
    if (roomCode.length !== 4) {
      setError('Room codes are 4 letters!');
      return;
    }
    
    setIsLoading(true);
    setError('');
    setLoadingMessage('Connecting to room...');
    
    // Set up progressive loading messages
    LOADING_MESSAGES.forEach(({ message, delay }) => {
      const timer = setTimeout(() => setLoadingMessage(message), delay);
      loadingTimersRef.current.push(timer);
    });
    
    // Store current raid state to detect if join succeeded
    const beforeRaid = currentRaid;
    
    try {
      joinPrivateRoom(roomCode.toUpperCase(), selectedTrack);
      
      // Wait a bit to see if we successfully join (transition happens via subscription)
      // SpacetimeDB reducers are fire-and-forget, so we poll for state change
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        const { currentRaid: newRaid } = useGameStore.getState();
        
        // Success: we joined a raid
        if (newRaid && newRaid !== beforeRaid) {
          cleanupTimers();
          setIsLoading(false);
          // Modal will close automatically via gamePhase change
        }
        
        // Timeout after 5 seconds - room doesn't exist or is full (generous for school WiFi)
        if (attempts >= 50) { // 50 * 100ms = 5 seconds
          cleanupTimers();
          setError("Room doesn't exist or is full! Check the code.");
          setIsLoading(false);
        }
      }, 100);
      
      checkIntervalRef.current = interval;
      
    } catch (err) {
      cleanupTimers();
      setError('Connection failed! Try again.');
      setIsLoading(false);
    }
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/80 backdrop-blur-md"
          onClick={onClose}
        />

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          className="relative bg-gray-900/95 border-2 border-white/20 rounded-xl p-8 w-full max-w-md shadow-2xl backdrop-blur-xl"
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors p-1 hover:bg-white/10 rounded-lg"
            disabled={isLoading}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <h2 className="text-3xl font-bold text-white mb-2 font-game">Join Private Room</h2>
          <p className="text-white/70 mb-6">
            Enter the 4-letter code from your friend
          </p>

          <div className="space-y-4">
            <input
              type="text"
              value={roomCode}
              onChange={(e) => {
                setRoomCode(e.target.value.toUpperCase().slice(0, 4));
                setError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && roomCode.length === 4 && !isLoading) {
                  handleJoin();
                }
              }}
              ref={inputRef}
              placeholder="ABCD"
              className="w-full px-4 py-3 bg-black/30 border-2 border-white/20 rounded-lg text-white text-center text-3xl font-bold ui-mono tracking-widest placeholder-white/30 focus:outline-none focus:border-white/40 focus:bg-black/40 transition-all"
              maxLength={4}
              disabled={isLoading}
              spellCheck={false}
              autoComplete="off"
            />

            {error && (
              <p className="text-red-400 text-sm text-center">{error}</p>
            )}

            <button
              type="button"
              onClick={handleJoin}
              disabled={isLoading || roomCode.length !== 4}
              className="w-full ui-button-primary px-8 py-3 text-xl disabled:opacity-50"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin">⚡</span>
                  {loadingMessage}
                </span>
              ) : (
                'Join Room'
              )}
            </button>
          </div>
        </motion.div>
      </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
