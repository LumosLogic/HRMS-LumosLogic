import React from 'react';
import { Clock } from 'lucide-react';

/**
 * Inactivity warning modal.
 * Rendered via ReactDOM.createPortal inside AuthProvider — do not import
 * useAuth here; all props are passed directly from the context.
 */
export function InactivityWarningModal({ secondsLeft, onStayLoggedIn }) {
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const timeDisplay = `${mins}:${String(secs).padStart(2, '0')}`;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      aria-modal="true"
      role="dialog"
      aria-labelledby="inactivity-title"
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-8 text-center">

        <div className="w-14 h-14 bg-[#fff7ed] rounded-full flex items-center justify-center mx-auto mb-5">
          <Clock size={26} className="text-[#c2410c]" />
        </div>

        <h2
          id="inactivity-title"
          className="text-xl font-black text-[#151c27] mb-2"
        >
          Session Expiring Soon
        </h2>

        <p className="text-sm text-[#777587] mb-5 leading-relaxed">
          Your session will expire due to inactivity.
        </p>

        <div className="text-4xl font-black text-[#3525cd] mb-5 tabular-nums tracking-tight">
          {timeDisplay}
        </div>

        <p className="text-xs text-[#aaa9b8] mb-7 leading-relaxed">
          Click below to stay logged in, or you will be signed out automatically.
        </p>

        <button
          onClick={onStayLoggedIn}
          className="w-full py-3 px-6 bg-[#3525cd] hover:bg-[#2a1db0] active:scale-[0.98] text-white font-bold rounded-xl transition-all text-sm shadow-sm"
        >
          Stay Logged In
        </button>

      </div>
    </div>
  );
}
