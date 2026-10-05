import { useCallback, useRef, useState } from 'react';
import { errorMessage } from '../api/dataApi';
import { useToast } from '../components/ui/Toast';

/**
 * Runs a server save. Success callbacks run only after the server confirmed the write; a failure
 * shows a Turkish error and leaves the form as it was, so nothing pretends to be saved.
 * Repeated clicks while a save is in flight are ignored.
 */
export function useSaveAction() {
  const showToast = useToast();
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  const run = useCallback(
    async (action: () => Promise<unknown>, onSuccess?: () => void): Promise<boolean> => {
      if (busy.current) return false;
      busy.current = true;
      setSaving(true);
      try {
        await action();
        onSuccess?.();
        return true;
      } catch (e) {
        showToast({ tone: 'error', title: 'Kaydedilemedi', description: errorMessage(e) });
        return false;
      } finally {
        busy.current = false;
        setSaving(false);
      }
    },
    [showToast],
  );

  return { saving, run };
}
