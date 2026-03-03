'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface BottomSheetProps {
  show: boolean;
  onClose: () => void;
  title: string;
  titleIcon?: React.ReactNode;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  desktopWidth?: number;
  testId?: string;
}

export default function BottomSheet({
  show,
  onClose,
  title,
  titleIcon,
  headerRight,
  children,
  desktopWidth = 500,
  testId,
}: BottomSheetProps) {
  const [mounted, setMounted] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef<number | null>(null);
  const currentTranslateY = useRef(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!show) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [show, onClose]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
    currentTranslateY.current = 0;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (dragStartY.current === null || !sheetRef.current) return;
    const deltaY = e.touches[0].clientY - dragStartY.current;
    // Only allow dragging downward
    if (deltaY > 0) {
      currentTranslateY.current = deltaY;
      sheetRef.current.style.transform = `translateY(${deltaY}px)`;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!sheetRef.current) return;
    // If dragged more than 100px down, dismiss
    if (currentTranslateY.current > 100) {
      onClose();
    }
    // Reset position
    sheetRef.current.style.transform = '';
    dragStartY.current = null;
    currentTranslateY.current = 0;
  }, [onClose]);

  if (!mounted || !show) return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        onClick={onClose}
        data-testid={testId ? `${testId}-backdrop` : undefined}
      />

      {/* Mobile: Bottom Sheet */}
      <div
        ref={sheetRef}
        className="lg:hidden fixed bottom-0 left-0 right-0 z-50 flex flex-col"
        style={{
          maxHeight: '85vh',
          borderRadius: '20px 20px 0 0',
          background: 'rgba(30, 30, 40, 0.95)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderBottom: 'none',
          touchAction: 'none',
        }}
        data-testid={testId ? `${testId}-mobile` : undefined}
      >
        {/* Drag handle pill */}
        <div
          className="flex justify-center pt-3 pb-1"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div
            style={{
              width: '36px',
              height: '4px',
              borderRadius: '2px',
              background: 'rgba(255,255,255,0.3)',
            }}
          />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            {titleIcon}
            <h2 className="text-white font-medium">{title}</h2>
          </div>
          <div className="flex items-center gap-2">
            {headerRight}
            <button
              onClick={onClose}
              className="text-white/80 hover:text-white transition-colors p-1"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto" style={{ touchAction: 'pan-y' }}>
          {children}
        </div>
      </div>

      {/* Desktop: Side Panel */}
      <div
        className="hidden lg:flex fixed right-0 top-0 h-full z-50 flex-col"
        style={{
          width: `${desktopWidth}px`,
          background: 'rgba(30, 30, 40, 0.95)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderLeft: '1px solid rgba(255,255,255,0.1)',
        }}
        onClick={(e) => e.stopPropagation()}
        data-testid={testId}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            {titleIcon}
            <h2 className="text-white font-medium">{title}</h2>
          </div>
          <div className="flex items-center gap-2">
            {headerRight}
            <button
              onClick={onClose}
              className="text-white/80 hover:text-white transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </>,
    document.body
  );
}
