const axios = require('axios');
const https = require('https');
const http = require('http');

const BASE_URL = 'https://yhxt.swjtu.edu.cn/yethan';
const STUDY_ORIGIN = 'https://yhxt.swjtu.edu.cn';
const STUDY_REFERER = 'https://yhxt.swjtu.edu.cn/study/';

// 模块级连接池 — 所有 axios 实例共享，实现 HTTP Keep-Alive 连接复用
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
});

const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
});

const RETRYABLE_CODES = [
  'ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET',
  'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN',
  'ERR_NETWORK', 'ERR_CANCELED',
];
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 200;

function isRetryable(err) {
  if (!err) return false;
  const code = err.code;
  if (code && RETRYABLE_CODES.includes(code)) return true;
  if (err.message && /timeout|network error|ECONN|ETIMEDOUT|ERR_NETWORK/i.test(err.message)) return true;
  if (err.response && err.response.status >= 500 && err.response.status < 600) return true;
  return false;
}

function createClient(ytoken) {
  const instance = axios.create({
    baseURL: BASE_URL,
    timeout: 10000,
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

  instance.interceptors.response.use(
    function (response) { return response; },
    async function (error) {
      var config = error.config;
      config.__retryCount = config.__retryCount || 0;

      if (config.__retryCount < MAX_RETRIES && isRetryable(error)) {
        config.__retryCount++;
        var delay = RETRY_BASE_DELAY_MS * Math.pow(2, config.__retryCount - 1) + Math.floor(Math.random() * 150);
        await new Promise(function (resolve) { setTimeout(resolve, delay); });
        return instance(config);
      }

      return Promise.reject(error);
    }
  );

  return instance;
}

module.exports = { createClient, httpsAgent, httpAgent };
