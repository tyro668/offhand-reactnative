import {NativeModules} from 'react-native';

export const SHERPA_IDLE_RELEASE_SETTING_KEY = 'sherpaIdleReleaseMinutes';
export const DEFAULT_SHERPA_IDLE_RELEASE_MINUTES = 3;

type SherpaTranscriberModule = {
  setIdleReleaseTimeoutMs?: (timeoutMs: number) => Promise<boolean>;
};

const SherpaTranscriber = NativeModules.SherpaTranscriber as
  | SherpaTranscriberModule
  | undefined;

export function parseSherpaIdleReleaseMinutes(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SHERPA_IDLE_RELEASE_MINUTES;
  }
  return Math.round(parsed);
}

export function sherpaIdleReleaseMinutesToMs(minutes: number): number {
  return Math.max(1, parseSherpaIdleReleaseMinutes(minutes)) * 60 * 1000;
}

export async function configureSherpaIdleReleaseMinutes(minutes: number): Promise<void> {
  if (!SherpaTranscriber?.setIdleReleaseTimeoutMs) {
    return;
  }
  await SherpaTranscriber.setIdleReleaseTimeoutMs(
    sherpaIdleReleaseMinutesToMs(minutes),
  );
}
