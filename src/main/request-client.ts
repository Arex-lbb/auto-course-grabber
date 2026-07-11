import axios, { type AxiosError } from 'axios';
import https from 'https';
import http from 'http';
import { BASE_URL, STUDY_ORIGIN, STUDY_REFERER } from '../shared/constants';

// 模块级连接池 — 所有 axios 实例共享，实现 HTTP Keep-Alive 连接复用
// 避免每次请求重新 TCP+TLS 握手，在网络拥堵时大幅降低握手失败率
export const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,       // 空闲连接保留 30s
  maxSockets: 50,              // 最大并发连接数（足够应对多课程多并发）
  maxFreeSockets: 10,          // 最多保留 10 个空闲连接
  timeout: 60000,              // 连接空闲 60s 后自动关闭
});

export const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
});

// 可重试的错误码 — 网络层瞬态故障值得重试
const RETRYABLE_CODES = [
  'ECONNABORTED',   // axios 超时取消
  'ETIMEDOUT',      // TCP 连接超时
  'ECONNRESET',     // 连接被重置（服务器过载时常见）
  'ECONNREFUSED',   // 连接被拒绝
  'ENOTFOUND',      // DNS 解析失败（可能是瞬时）
  'EAI_AGAIN',      // DNS 临时故障
  'ERR_NETWORK',    // axios 网络错误
  'ERR_CANCELED',   // 请求被取消
];

const MAX_RETRIES = 2;           // 最多额外重试 2 次（共 3 次尝试）
const RETRY_BASE_DELAY_MS = 200; // 基础延迟，首次重试 200ms，二次 400ms

function isRetryable(err: AxiosError): boolean {
  if (!err) return false;
  // 匹配已知错误码
  const code = (err as any).code;
  if (code && RETRYABLE_CODES.includes(code)) return true;
  // 兜底：消息中含超时/网络关键词
  if (err.message && /timeout|network error|ECONN|ETIMEDOUT|ERR_NETWORK/i.test(err.message)) return true;
  // 服务端 5xx（503 Service Unavailable 等）
  if (err.response && err.response.status >= 500 && err.response.status < 600) return true;
  return false;
}

export function createClient(ytoken: string) {
  const instance = axios.create({
    baseURL: BASE_URL,
    timeout: 10000,   // 从 15s 降到 10s，因为有重试兜底
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Referer: STUDY_REFERER,
      Origin: STUDY_ORIGIN,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      ytoken,
    },
    httpsAgent,
    httpAgent,
  });

  // 响应拦截器：超时/网络错误自动重试（带指数退避 + jitter）
  instance.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error.config as any;
      config.__retryCount = config.__retryCount || 0;

      if (config.__retryCount < MAX_RETRIES && isRetryable(error)) {
        config.__retryCount++;
        // 指数退避: 200ms → 400ms，加 0-150ms 随机抖动防止惊群
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, config.__retryCount - 1) + Math.floor(Math.random() * 150);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return instance(config);
      }

      return Promise.reject(error);
    },
  );

  return instance;
}
