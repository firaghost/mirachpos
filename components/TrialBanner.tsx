import React, { useEffect, useState } from 'react';
import { AlertTriangle, Clock } from 'lucide-react';
import { readSession } from '../session';

interface TrialInfo {
  isTrial: boolean;
  trialEndsAt: string | null;
  daysRemaining: number | null;
}

export function TrialBanner() {
  const [trialInfo, setTrialInfo] = useState<TrialInfo | null>(null);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    const checkTrialStatus = () => {
      const session = readSession<any>();
      if (!session?.subscription) return;

      const { subscription } = session;
      
      // Check if user is on trial
      if (subscription.isTrial || subscription.plan === 'trial') {
        const trialEndsAt = subscription.trialEndsAt || subscription.trial_end;
        
        if (trialEndsAt) {
          const endDate = new Date(trialEndsAt);
          const now = new Date();
          const diffTime = endDate.getTime() - now.getTime();
          const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

          setTrialInfo({
            isTrial: true,
            trialEndsAt,
            daysRemaining
          });

          // Show banner if 3 days or less remaining
          setShowBanner(daysRemaining <= 3);
        }
      }
    };

    checkTrialStatus();

    // Listen for session changes
    const handleSessionChange = () => checkTrialStatus();
    window.addEventListener('mirachpos-session-changed', handleSessionChange);

    return () => {
      window.removeEventListener('mirachpos-session-changed', handleSessionChange);
    };
  }, []);

  if (!showBanner || !trialInfo) return null;

  const { daysRemaining } = trialInfo;

  // Determine severity based on days remaining
  const isExpired = daysRemaining !== null && daysRemaining <= 0;
  const isUrgent = daysRemaining !== null && daysRemaining <= 1;
  const isWarning = daysRemaining !== null && daysRemaining <= 3;

  let bgColor = 'bg-amber-500';
  let icon = <Clock className="w-5 h-5" />;
  let message = `Your trial ends in ${daysRemaining} days`;

  if (isExpired) {
    bgColor = 'bg-red-600';
    icon = <AlertTriangle className="w-5 h-5" />;
    message = 'Your trial has expired';
  } else if (isUrgent) {
    bgColor = 'bg-red-500';
    icon = <AlertTriangle className="w-5 h-5" />;
    message = daysRemaining === 0 
      ? 'Your trial ends today'
      : `Your trial ends in ${daysRemaining} day`;
  } else if (isWarning) {
    bgColor = 'bg-amber-500';
    message = `Your trial ends in ${daysRemaining} days`;
  }

  return (
    <div className={`${bgColor} text-white px-4 py-3 shadow-lg`}>
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          {icon}
          <div>
            <span className="font-semibold">{message}</span>
            <span className="ml-2 text-white/90">
              {isExpired 
                ? 'Please subscribe to continue using MirachPOS.'
                : 'Upgrade now to keep your access.'
              }
            </span>
          </div>
        </div>
        <a
          href="/#/owner/billing"
          className="inline-flex items-center px-4 py-2 bg-white text-gray-900 rounded-lg font-medium hover:bg-gray-100 transition-colors"
          onClick={(e) => {
            // For hash-based routing
            e.preventDefault();
            window.location.hash = '/owner/billing';
          }}
        >
          {isExpired ? 'Subscribe Now' : 'Upgrade'}
        </a>
      </div>
    </div>
  );
}
