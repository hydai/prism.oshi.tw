'use client';

import { useEffect, useState } from 'react';
import { CheckCircle } from 'lucide-react';

interface ToastProps {
  message: string;
  show: boolean;
  onHide: () => void;
}

export default function Toast({ message, show, onHide }: ToastProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (show) {
      setIsVisible(true);
      const timer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(onHide, 300); // Wait for fade out
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [show, onHide]);

  if (!show && !isVisible) return null;

  return (
    <div
      data-testid="toast"
      className={`fixed top-8 left-1/2 -translate-x-1/2 z-[200] transition-all duration-300 ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'
      }`}
    >
      <div className="bg-white/95 backdrop-blur-xl border border-white/60 shadow-2xl shadow-pink-500/20 rounded-full px-6 py-3 flex items-center gap-3">
        <div className="w-6 h-6 rounded-full bg-gradient-to-r from-pink-400 to-blue-400 flex items-center justify-center flex-shrink-0">
          <CheckCircle className="w-4 h-4 text-white" />
        </div>
        <span className="text-slate-800 font-bold text-sm">{message}</span>
      </div>
    </div>
  );
}
