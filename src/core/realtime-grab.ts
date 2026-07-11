// realtime-grab.ts - 实时抢课引擎
// 策略: 服务端时间校准 → 连接预热 → 精准卡点并发 → 快速重试

import type { ApplyResult, TaskItem } from '../shared/types';
import { isFrequencyLimitMessage, jitter, nextBackoff } from './retry-policy';

type CourseApi = {
  getCapacity: (teachIds: string[]) => Promise<Array<{ teachId: string; studentNumber: number; fullNumber: number; hasApplied: boolean; hasSelected: boolean }>>;
  apply: (teachId: string, opts?: { chooseScore?: number; ignoreTimeConflict?: boolean }) => Promise<ApplyResult>;
  syncServerTime: () => Promise<{ offset: number; samples: number; serverTime: number }>;
  /** 探测服务器是否已开放选课（轻量只读请求），返回 true 表示已开放 */
  probeServerOpen?: () => Promise<boolean>;
};

export interface RealtimeGrabOpts {
  targetTime: string;        // "HH:MM" or "HH:MM:SS"
  concurrency: number;       // 并发数
  fireAheadMs: number;       // 提前量(ms) - 在目标时间之前多久发请求
  maxRounds: number;         // 最大重试轮数
  roundIntervalMs: number;   // 轮间间隔(ms)
  ignoreTimeConflict: boolean;
  /** 服务器开放探测间隔(ms)，0 表示不探测。默认 3000 */
  serverPollIntervalMs?: number;
  onUpdateTask: (teachId: string, patch: Partial<TaskItem>) => void;
  onLog: (msg: string) => void;
  cancelled: () => boolean;
}

export async function runRealtimeGrab(
  tasks: TaskItem[],
  api: CourseApi,
  opts: RealtimeGrabOpts
) {
  if (tasks.length === 0) return;

  // 1. 同步服务器时间
  opts.onLog('🕐 正在同步服务器时间...');
  let offset = 0;
  try {
    const sync = await api.syncServerTime();
    offset = sync.offset;
    opts.onLog(`🕐 时间同步完成: 偏移 ${offset > 0 ? '+' : ''}${offset}ms (${sync.samples}/3 样本)`);
  } catch {
    opts.onLog('⚠️ 时间同步失败, 使用本地时间');
  }

  // 2. 解析目标时间
  const now = Date.now();
  const serverNow = now + offset;
  const { targetMs } = parseTargetTime(opts.targetTime, serverNow);
  if (targetMs <= serverNow) {
    opts.onLog('⚠️ 目标时间已过, 立即开始抢课');
  }

  // 3. 计算等待时间 (带提前量)
  let effectiveFireTime = targetMs - opts.fireAheadMs;
  let waitMs = effectiveFireTime - serverNow;
  if (waitMs < 0) waitMs = 0;

  opts.onLog(`🎯 目标时间: ${opts.targetTime}, 提前 ${opts.fireAheadMs}ms 开火`);
  const pollInterval = opts.serverPollIntervalMs ?? 3000;
  if (waitMs > 0) {
    opts.onLog(`⏳ 等待 ${(waitMs / 1000).toFixed(1)}s 后开火...`);

    // 4. 等待期间周期性探测服务器是否已提前开放
    if (pollInterval > 0 && api.probeServerOpen && waitMs > pollInterval) {
      opts.onLog(`🔍 服务器开放探测: 每 ${(pollInterval / 1000).toFixed(1)}s 检测一次`);
      const pollStart = Date.now();
      while (true) {
        if (opts.cancelled()) return;
        const elapsed = Date.now() - pollStart;
        const timeUntilFire = effectiveFireTime - (Date.now() + offset);
        if (timeUntilFire <= pollInterval) break; // 快开火了，停止探测

        await sleep(pollInterval);

        if (opts.cancelled()) return;

        // 探测服务器
        try {
          const isOpen = await api.probeServerOpen();
          if (isOpen) {
            opts.onLog('🔔 检测到服务器已提前开放，立即开火！');
            effectiveFireTime = Date.now() + offset; // 将开火时间设为现在
            break; // 跳出探测循环，立即开火
          }
        } catch { /* probe failed, continue waiting */ }
      }
    } else {
      // 5. 连接预热 (无探测模式)
      await sleep(Math.max(0, waitMs - 2000));
    }

    if (opts.cancelled()) return;

    // 预热连接（非探测模式下已在上方 sleep 等待，这里只需预热最后几秒）
    if (pollInterval > 0 && api.probeServerOpen && waitMs > pollInterval) {
      // 探测模式下：探测循环已处理等待，只需预热 + 精确等待最后剩余时间
    } else {
      // 非探测模式：预热连接
      if (waitMs > 3000) {
        opts.onLog('🔥 预热连接...');
        try { await api.syncServerTime(); } catch {}
        opts.onLog('🔥 连接预热完成');
      }
    }

    // 精确等待剩余时间
    const remaining = effectiveFireTime - (Date.now() + offset);
    if (remaining > 0) {
      await preciseSleep(remaining);
    }
  }

  if (opts.cancelled()) return;

  // 开火前并行容量检查，跳过已选中的课程
  const filtered: TaskItem[] = [];
  const capResults = await Promise.all(
    tasks.map(async (t) => {
      try {
        const [cap] = await api.getCapacity([t.teachId]);
        return { task: t, cap };
      } catch { return { task: t, cap: null }; }
    })
  );
  for (const { task: t, cap } of capResults) {
    if (cap?.hasSelected) {
      opts.onUpdateTask(t.teachId, { status: 'success', lastMessage: '已经选中该课程' });
      continue;
    }
    filtered.push(t);
  }
  if (filtered.length === 0) {
    opts.onLog('🏁 全部课程已选中，无需抢课');
    return;
  }

  // 5. 开火: 多轮并发
  const succeededIds = new Set<string>();
  for (let round = 0; round < opts.maxRounds; round++) {
    if (opts.cancelled()) return;

    // 过滤掉已成功的任务，只对未成功的继续开火
    const active = filtered.filter(t => !succeededIds.has(t.teachId));
    if (active.length === 0) {
      opts.onLog('🏁 全部课程抢课成功!');
      return;
    }

    const roundStart = Date.now();
    opts.onLog(`🚀 第 ${round + 1}/${opts.maxRounds} 轮: ${active.length}门 × ${opts.concurrency}并发`);

    // 并发发送所有请求（仅对未成功的任务）
    const results = await Promise.all(
      active.flatMap(task =>
        Array.from({ length: opts.concurrency }, () =>
          api.apply(task.teachId, { ignoreTimeConflict: opts.ignoreTimeConflict }).catch((e: any) => ({ success: false, message: e?.message || '网络错误' }))
        )
      )
    );

    const roundElapsed = Date.now() - roundStart;

    // 检查结果
    const perTask = new Map<string, ApplyResult[]>();
    for (let i = 0; i < results.length; i++) {
      const taskIdx = Math.floor(i / opts.concurrency);
      const task = active[taskIdx];
      if (!task) continue;
      const arr = perTask.get(task.teachId) || [];
      arr.push(results[i]);
      perTask.set(task.teachId, arr);
    }

    for (const task of active) {
      const rs = perTask.get(task.teachId) || [];
      const success = rs.find(r => r.success);
      if (success) {
        succeededIds.add(task.teachId);
        opts.onUpdateTask(task.teachId, { status: 'success', attempts: round + 1, lastMessage: success.message });
        opts.onLog(`✅ ${task.courseName}: ${success.message}`);
      } else {
        const first = rs[0] || { message: '无响应' };
        opts.onUpdateTask(task.teachId, { attempts: round + 1, lastMessage: `第${round + 1}轮: ${first.message}` });
      }
    }

    // 检查限流
    const allResults = results.filter(r => !r.success);
    if (allResults.some(r => isFrequencyLimitMessage(r.message))) {
      const backoff = Math.min(opts.roundIntervalMs * Math.pow(2, round), 30000);
      opts.onLog(`⏸ 检测到限流, ${(backoff / 1000).toFixed(1)}s 后重试`);
      await sleep(backoff);
    } else if (round < opts.maxRounds - 1) {
      opts.onLog(`⏳ ${opts.roundIntervalMs}ms 后下一轮... (耗时 ${roundElapsed}ms)`);
      await sleep(opts.roundIntervalMs);
    }
  }

  opts.onLog('🏁 抢课结束');
}

function parseTargetTime(target: string, serverNow: number): { targetMs: number } {
  const parts = target.split(':').map(Number);
  const h = parts[0] || 0, m = parts[1] || 0, s = parts[2] || 0;

  const nowDate = new Date(serverNow);
  // 如果目标时间已过, 假设是明天的同一时间
  let targetDate = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), h, m, s, 0);
  if (targetDate.getTime() <= serverNow) {
    targetDate.setDate(targetDate.getDate() + 1);
  }
  return { targetMs: targetDate.getTime() };
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, Math.max(0, ms)));
}

async function preciseSleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  // Use setTimeout for most of the wait, then busy-loop the last 50ms
  if (ms > 50) {
    await sleep(ms - 50);
  }
  const deadline = performance.now() + Math.min(ms, 50);
  while (performance.now() < deadline) { /* spin */ }
}
