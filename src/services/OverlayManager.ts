import {NativeEventEmitter, NativeModules} from 'react-native';
import {useEffect, useState, useCallback} from 'react';

type OverlayManagerModule = {
  startMonitoring: () => void;
  stopMonitoring: () => void;
  toggleRecording: () => void;
  setOverlayState?: (payload: {
    state: string;
    duration?: string;
    level?: number;
    stateLabel?: string;
  }) => void;
  getLogFilePath?: () => Promise<string>;
  openLogFolder?: () => Promise<boolean>;
  appendLog?: (message: string) => void;
  checkPermissions?: () => Promise<PermissionStatus>;
  requestAccessibilityPermission?: () => Promise<boolean>;
  requestInputMonitoringPermission?: () => Promise<boolean>;
  requestMicrophonePermission?: () => Promise<boolean>;
};

export interface PermissionStatus {
  accessibility: boolean;
  inputMonitoring: boolean;
  microphone: boolean;
  microphoneStatus: string;
}

const LOG_PREFIX = '[OverlayManager JS]';
const nativeOverlayManager = NativeModules.OverlayManager;
const OverlayManager = nativeOverlayManager as OverlayManagerModule | undefined;
const emitter = OverlayManager ? new NativeEventEmitter(nativeOverlayManager) : null;

if (!OverlayManager) {
  const nativeModuleNames = Object.keys(NativeModules)
    .filter(name => name.toLowerCase().includes('overlay'))
    .join(', ');
  console.warn(`${LOG_PREFIX} native module missing. Overlay-like modules: ${nativeModuleNames || 'none'}`);
} else {
  console.log(`${LOG_PREFIX} native module found; fn monitor can be started.`);
  OverlayManager.appendLog?.('native module found in JS.');
}

export interface OverlayState {
  state: string;
  duration: string;
  level: number;
  label?: string;
}

export function useRecording() {
  const [isRecording, setIsRecording] = useState(false);

  useEffect(() => {
    console.log(`${LOG_PREFIX} useRecording mounted.`);
    OverlayManager?.appendLog?.('useRecording mounted.');

    if (!emitter) {
      console.warn(`${LOG_PREFIX} skipped startMonitoring because native emitter is unavailable.`);
      return;
    }

    const sub = emitter.addListener(
      'onRecordingStateChange',
      (event: {isRecording: boolean}) => {
        console.log(`${LOG_PREFIX} onRecordingStateChange`, event);
        OverlayManager?.appendLog?.(`onRecordingStateChange isRecording=${event.isRecording}`);
        setIsRecording(event.isRecording);
      },
    );

    try {
      console.log(`${LOG_PREFIX} calling native startMonitoring.`);
      OverlayManager?.appendLog?.('calling native startMonitoring.');
      OverlayManager?.startMonitoring();
    } catch (e) {
      console.error(`${LOG_PREFIX} startMonitoring failed`, e);
    }

    return () => {
      console.log(`${LOG_PREFIX} useRecording unmounted; stopping native monitor.`);
      OverlayManager?.appendLog?.('useRecording unmounted; stopping native monitor.');
      sub.remove();
      try {
        OverlayManager?.stopMonitoring();
      } catch (e) {
        console.error(`${LOG_PREFIX} stopMonitoring failed`, e);
      }
    };
  }, []);

  const toggleRecording = useCallback(() => {
    if (OverlayManager) {
      console.log(`${LOG_PREFIX} calling native toggleRecording.`);
      OverlayManager.appendLog?.('calling native toggleRecording.');
      OverlayManager.toggleRecording();
    } else {
      console.warn(`${LOG_PREFIX} cannot toggle; native module is missing.`);
    }
  }, []);

  const updateOverlay = useCallback((state: OverlayState) => {
    if (OverlayManager?.setOverlayState) {
      OverlayManager.appendLog?.(
        `updating overlay state=${state.state} duration=${state.duration || ''} level=${state.level}`,
      );
      OverlayManager.setOverlayState({
        state: state.state,
        duration: state.duration,
        level: state.level,
        stateLabel: state.label,
      });
    }
  }, []);

  return {isRecording, toggleRecording, updateOverlay};
}

export async function getLogFilePath(): Promise<string> {
  if (!OverlayManager?.getLogFilePath) {
    throw new Error('OverlayManager log path API is unavailable.');
  }
  return OverlayManager.getLogFilePath();
}

export async function openLogFolder(): Promise<boolean> {
  if (!OverlayManager?.openLogFolder) {
    throw new Error('OverlayManager open log folder API is unavailable.');
  }
  return OverlayManager.openLogFolder();
}

export function usePermissionStatus(pollIntervalMs = 2000): {
  status: PermissionStatus | null;
  refresh: () => void;
  requestAccessibility: () => Promise<boolean>;
  requestInputMonitoring: () => Promise<boolean>;
  requestMicrophone: () => Promise<boolean>;
} {
  const [status, setStatus] = useState<PermissionStatus | null>(null);

  const refresh = useCallback(() => {
    OverlayManager?.checkPermissions?.()
      .then(setStatus)
      .catch(e => console.warn(`${LOG_PREFIX} checkPermissions failed`, e));
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, pollIntervalMs);
    return () => clearInterval(id);
  }, [refresh, pollIntervalMs]);

  const requestAccessibility = useCallback(async () => {
    const ok = (await OverlayManager?.requestAccessibilityPermission?.()) ?? false;
    refresh();
    return ok;
  }, [refresh]);

  const requestInputMonitoring = useCallback(async () => {
    const ok =
      (await OverlayManager?.requestInputMonitoringPermission?.()) ?? false;
    refresh();
    return ok;
  }, [refresh]);

  const requestMicrophone = useCallback(async () => {
    const ok = (await OverlayManager?.requestMicrophonePermission?.()) ?? false;
    refresh();
    return ok;
  }, [refresh]);

  return {
    status,
    refresh,
    requestAccessibility,
    requestInputMonitoring,
    requestMicrophone,
  };
}
