import { DEFAULT_FREQUENCY_BACKOFF_MAX_MS, DEFAULT_RETRY_INTERVAL_MS } from '../shared/constants';

export function isFrequencyLimitMessage(message: string) {
  return /操作频繁|稍后再试|请求过于频繁|频繁/.test(String(message || ''));
}

export function nextBackoff(current: number) {
  return Math.min(Math.max(current, DEFAULT_RETRY_INTERVAL_MS) * 2, DEFAULT_FREQUENCY_BACKOFF_MAX_MS);
}

export function jitter(ms: number, spread = 250) {
  return ms + Math.floor(Math.random() * spread);
}
