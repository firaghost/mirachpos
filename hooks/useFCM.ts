/**
 * React Hook for Firebase Cloud Messaging
 * 
 * Provides:
 * - Token registration
 * - Permission handling
 * - Foreground message handling
 * - Preference management
 */

import { useEffect, useState, useCallback } from 'react';
import { getToken, onMessage } from 'firebase/messaging';
import { getFCMMessaging, isFCMAvailable } from '@/lib/firebase';
import { apiFetch } from '@/api';

interface FCMPreferences {
  enabled: boolean;
  orderUpdates: boolean;
  billingAlerts: boolean;
  inventoryAlerts: boolean;
  shiftReminders: boolean;
  marketing: boolean;
}

interface UseFCMOptions {
}

export const useFCM = (options: UseFCMOptions) => {
  void options;
  const env = ((import.meta as any)?.env || {}) as Record<string, any>;

  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [token, setToken] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<FCMPreferences | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check FCM support
  useEffect(() => {
    const checkSupport = async () => {
      const supported = await isFCMAvailable();
      setIsSupported(supported);
      if (supported) {
        setPermission(Notification.permission);
      }
    };
    checkSupport();
  }, []);

  // Request permission and get token
  const requestPermission = useCallback(async () => {
    if (!isSupported) {
      setError('Push notifications not supported');
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await Notification.requestPermission();
      setPermission(result);

      if (result === 'granted') {
        const messaging = await getFCMMessaging();
        if (!messaging) {
          setError('FCM initialization failed');
          return false;
        }

        // Get FCM token
        const currentToken = await getToken(messaging, {
          vapidKey: env.VITE_FIREBASE_VAPID_KEY,
          serviceWorkerRegistration: await navigator.serviceWorker.ready,
        });

        if (currentToken) {
          setToken(currentToken);
          // Register with backend
          await registerTokenWithBackend(currentToken);
          return true;
        } else {
          setError('No registration token available');
          return false;
        }
      } else {
        setError('Permission denied');
        return false;
      }
    } catch (err) {
      setError('Failed to request permission');
      console.error('[FCM] Permission error:', err);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported]);

  // Register token with backend
  const registerTokenWithBackend = async (fcmToken: string) => {
    try {
      const deviceType = getDeviceType();
      const deviceName = navigator.userAgent.slice(0, 128);

      const response = await apiFetch('/api/auth/fcm-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: fcmToken,
          deviceType,
          deviceName,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to register token');
      }

      return await response.json();
    } catch (err) {
      console.error('[FCM] Backend registration failed:', err);
      throw err;
    }
  };

  // Unregister token (logout)
  const unregisterToken = useCallback(async () => {
    if (!token) return;

    try {
      const response = await apiFetch('/api/auth/fcm-token', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      setToken(null);
      return await response.json();
    } catch (err) {
      console.error('[FCM] Unregister failed:', err);
    }
  }, [token]);

  // Fetch preferences
  const fetchPreferences = useCallback(async () => {
    try {
      const response = await apiFetch('/api/auth/fcm-preferences');

      if (response.ok) {
        const data = await response.json();
        setPreferences(data.preferences);
      }
    } catch (err) {
      console.error('[FCM] Fetch preferences failed:', err);
    }
  }, []);

  // Update preferences
  const updatePreferences = useCallback(
    async (newPrefs: Partial<FCMPreferences>) => {
      try {
        const updated = { ...preferences, ...newPrefs };

        const response = await apiFetch('/api/auth/fcm-preferences', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ preferences: updated }),
        });

        if (response.ok) {
          setPreferences(updated);
          return true;
        }
        return false;
      } catch (err) {
        console.error('[FCM] Update preferences failed:', err);
        return false;
      }
    },
    [preferences]
  );

  // Handle foreground messages
  useEffect(() => {
    if (!isSupported || permission !== 'granted') return;

    let unsubscribe: (() => void) | undefined;

    const setupForegroundHandler = async () => {
      const messaging = await getFCMMessaging();
      if (!messaging) return;

      unsubscribe = onMessage(messaging, (payload) => {
        console.log('[FCM] Foreground message:', payload);

        // Show in-app notification toast
        if (payload.notification) {
          const event = new CustomEvent('fcm-message', {
            detail: payload,
          });
          window.dispatchEvent(event);
        }
      });
    };

    setupForegroundHandler();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [isSupported, permission]);

  // Load preferences on mount
  useEffect(() => {
    if (isSupported) {
      fetchPreferences();
    }
  }, [isSupported, fetchPreferences]);

  return {
    isSupported,
    permission,
    token,
    preferences,
    isLoading,
    error,
    requestPermission,
    unregisterToken,
    updatePreferences,
    refreshPreferences: fetchPreferences,
  };
};

// Get device type
function getDeviceType(): string {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  return 'web';
}
