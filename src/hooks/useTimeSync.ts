import { useEffect } from 'react';
import { useAppStore } from '../store/appStore';

export function useTimeSync() {
  const updateTime = useAppStore((state) => state.updateTime);

  useEffect(() => {
    updateTime(); // Initial update
    const interval = setInterval(() => {
      updateTime();
    }, 1000);

    return () => clearInterval(interval);
  }, [updateTime]);
}
