import { usePreventRemove } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { alert } from './alert';

// Covers Back, interactive dismissal and tab reselection. Switching tabs keeps the editor mounted;
// its normal blur handler persists its account-scoped draft.
export function useEditorNavigation(dirty: boolean, saveDraft: () => Promise<void>, discard: () => Promise<void>) {
  const [leaving, setLeaving] = useState(false);
  const bypass = useRef(false);
  const disablePrevention = usePreventRemove(dirty && !leaving, ({ repeat }) => {
    if (bypass.current) return;
    alert('Unsaved changes', 'Keep editing, save a draft for later, or discard these changes.', [
      { text: 'Keep Editing', style: 'cancel' },
      { text: 'Save Draft', onPress: () => void saveDraft().then(() => { bypass.current = true; setLeaving(true); repeat(); }) },
      { text: 'Discard Changes', style: 'destructive', onPress: () => void discard().then(() => { bypass.current = true; setLeaving(true); repeat(); }) },
    ]);
  });
  return useCallback((go: () => void) => { bypass.current = true; setLeaving(true); disablePrevention(); go(); }, [disablePrevention]);
}
