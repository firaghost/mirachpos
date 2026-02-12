import { useState } from 'react';
import { useFCM } from '@/hooks/useFCM';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Bell, BellOff, Loader2, Smartphone } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function PushNotificationSettings() {
  const { toast } = useToast();
  const {
    isSupported,
    permission,
    preferences,
    isLoading,
    requestPermission,
    updatePreferences,
  } = useFCM({});

  const [localPrefs, setLocalPrefs] = useState(preferences);

  // Sync local prefs with hook
  if (preferences && !localPrefs) {
    setLocalPrefs(preferences);
  }

  const handleEnablePush = async () => {
    const success = await requestPermission();
    if (success) {
      toast({
        title: 'Push notifications enabled',
        description: 'You will now receive push notifications on this device.',
      });
    } else {
      toast({
        title: 'Failed to enable notifications',
        description: 'Please check your browser permissions and try again.',
        variant: 'destructive',
      });
    }
  };

  const handleToggle = async (key: keyof NonNullable<typeof localPrefs>) => {
    if (!localPrefs) return;

    const updated = { ...localPrefs, [key]: !localPrefs[key] };
    setLocalPrefs(updated);

    const success = await updatePreferences({ [key]: updated[key] });
    if (success) {
      toast({
        title: 'Preferences updated',
        description: 'Your notification preferences have been saved.',
      });
    } else {
      toast({
        title: 'Failed to update',
        description: 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  if (!isSupported) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellOff className="h-5 w-5" />
            Push Notifications
          </CardTitle>
          <CardDescription>
            Push notifications are not supported on this device or browser.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (permission !== 'granted') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Push Notifications
          </CardTitle>
          <CardDescription>
            Enable push notifications to stay updated on orders, billing, and more.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleEnablePush} disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Smartphone className="mr-2 h-4 w-4" />
            Enable Push Notifications
          </Button>
          {permission === 'denied' && (
            <p className="mt-2 text-sm text-destructive">
              Notifications are blocked. Please enable them in your browser settings.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-green-500" />
          Push Notifications
        </CardTitle>
        <CardDescription>
          Manage what notifications you receive on this device.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="push-master">Push Notifications</Label>
            <p className="text-sm text-muted-foreground">
              Master toggle for all push notifications
            </p>
          </div>
          <Switch
            id="push-master"
            checked={localPrefs?.enabled ?? true}
            onCheckedChange={() => handleToggle('enabled')}
          />
        </div>

        {localPrefs?.enabled && (
          <>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="push-orders">Order Updates</Label>
                <p className="text-sm text-muted-foreground">
                  New orders, payments, and status changes
                </p>
              </div>
              <Switch
                id="push-orders"
                checked={localPrefs?.orderUpdates ?? true}
                onCheckedChange={() => handleToggle('orderUpdates')}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="push-billing">Billing Alerts</Label>
                <p className="text-sm text-muted-foreground">
                  Invoice reminders and payment confirmations
                </p>
              </div>
              <Switch
                id="push-billing"
                checked={localPrefs?.billingAlerts ?? true}
                onCheckedChange={() => handleToggle('billingAlerts')}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="push-inventory">Inventory Alerts</Label>
                <p className="text-sm text-muted-foreground">
                  Low stock and reorder notifications
                </p>
              </div>
              <Switch
                id="push-inventory"
                checked={localPrefs?.inventoryAlerts ?? true}
                onCheckedChange={() => handleToggle('inventoryAlerts')}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="push-shifts">Shift Reminders</Label>
                <p className="text-sm text-muted-foreground">
                  Clock-in reminders and shift updates
                </p>
              </div>
              <Switch
                id="push-shifts"
                checked={localPrefs?.shiftReminders ?? true}
                onCheckedChange={() => handleToggle('shiftReminders')}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="push-marketing">Marketing</Label>
                <p className="text-sm text-muted-foreground">
                  Promotions and feature announcements
                </p>
              </div>
              <Switch
                id="push-marketing"
                checked={localPrefs?.marketing ?? false}
                onCheckedChange={() => handleToggle('marketing')}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
