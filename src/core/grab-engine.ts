import type { ApplyResult, TaskItem } from '../shared/types';
import { DEFAULT_TASK_JITTER_MS } from '../shared/constants';
import { isFrequencyLimitMessage, jitter, nextBackoff } from './retry-policy';

type CourseApi = {
  getCapacity: (teachIds: string[]) => Promise<Array<{ teachId: string; studentNumber: number; fullNumber: number; hasApplied: boolean; hasSelected: boolean }>>;
  apply: (teachId: string, opts?: { chooseScore?: number; ignoreTimeConflict?: boolean }) => Promise<ApplyResult>;
};

// ==================== 单任务抢课（原有逻辑，保留兼容） ====================

export async function runTask(task: TaskItem, api: CourseApi, opts: {
  maxRetries: number;
  retryIntervalMs: number;
  monitorIntervalMs: number;
  concurrency: number;
  forceBypassCapacity: boolean;
  ignoreTimeConflict: boolean;
  maxMonitorRounds?: number; // 容量满监控上限，超限后自动回退（用于同课择一）
  onUpdate: (patch: Partial<TaskItem>) => void;
  onLog?: (msg: string) => void;
  cancelled: () => boolean;
  taskIndex: number;
}) {
  let submitAttempt = 0;
  let backoffMs = opts.retryIntervalMs;
  let monitorCount = 0;

  while (submitAttempt <= opts.maxRetries) {
    if (opts.cancelled()) {
      safeUpdate(opts.onUpdate, { status: 'cancelled', lastMessage: '已取消' });
      return { status: 'cancelled' as const, message: '已取消' };
    }

    // 容量监控（不消耗提交轮次配额）
    if (!opts.forceBypassCapacity) {
      safeUpdate(opts.onUpdate, { status: 'monitoring', attempts: submitAttempt, lastMessage: '检查容量中...' });
      try {
        const [capacity] = await api.getCapacity([task.teachId]);
        if (capacity) {
          safeUpdate(opts.onUpdate, { studentNumber: capacity.studentNumber, fullNumber: capacity.fullNumber });
          if (capacity.hasSelected) {
            safeUpdate(opts.onUpdate, { status: 'success', lastMessage: '已经选中该课程' });
            return { status: 'success' as const, message: '已经选中该课程' };
          }
          if (capacity.fullNumber > 0 && capacity.studentNumber >= capacity.fullNumber) {
            monitorCount++;
            if (opts.maxMonitorRounds && monitorCount >= opts.maxMonitorRounds) {
              const msg = `容量已满 (${capacity.studentNumber}/${capacity.fullNumber}), 已监控 ${monitorCount} 轮，回退`;
              safeUpdate(opts.onUpdate, { status: 'failed', lastMessage: msg });
              opts.onLog?.(`[${task.courseName}] ⚠️ ${msg}`);
              return { status: 'failed' as const, message: msg };
            }
            const msg = `容量已满 (${capacity.studentNumber}/${capacity.fullNumber}), 第${monitorCount}轮监控`;
            safeUpdate(opts.onUpdate, { lastMessage: msg });
            opts.onLog?.(`[${task.courseName}] ${msg}`);
            await sleep(jitter(opts.monitorIntervalMs, 250));
            continue; // 不消耗提交轮次
          }
          // 容量有空位，重置监控计数
          monitorCount = 0;
        }
      } catch (e: any) {
        opts.onLog?.(`[${task.courseName}] 容量查询失败: ${e.message}`);
      }
    }

    // 提交
    safeUpdate(opts.onUpdate, { status: 'submitting', lastMessage: `提交申请中... (并发=${opts.concurrency})` });
    opts.onLog?.(`[${task.courseName}] 第${submitAttempt + 1}轮: 发送 ${opts.concurrency} 个并发请求`);

    if (opts.taskIndex > 0) await sleep(jitter(120, DEFAULT_TASK_JITTER_MS));

    const promises = Array.from({ length: opts.concurrency }, () =>
      api.apply(task.teachId, { ignoreTimeConflict: opts.ignoreTimeConflict })
    );
    const results = await Promise.all(promises);

    const success = results.find(r => r.success);
    if (success) {
      safeUpdate(opts.onUpdate, { status: 'success', lastMessage: success.message });
      opts.onLog?.(`[${task.courseName}] ✅ ${success.message}`);
      return { status: 'success' as const, message: success.message };
    }

    const freqResult = results.find(r => isFrequencyLimitMessage(r.message));
    if (freqResult) {
      const msg = `操作频繁, ${Math.ceil(backoffMs / 1000)}s 冷却`;
      safeUpdate(opts.onUpdate, { status: 'backoff', lastMessage: msg });
      opts.onLog?.(`[${task.courseName}] ⚠️ ${msg}`);
      await sleep(jitter(backoffMs, 300));
      backoffMs = nextBackoff(backoffMs);
      submitAttempt++;
      continue;
    }

    const firstErr = results[0];
    safeUpdate(opts.onUpdate, { lastMessage: firstErr.message });
    opts.onLog?.(`[${task.courseName}] ❌ ${firstErr.message}`);
    submitAttempt++;
    await sleep(jitter(opts.retryIntervalMs, 250));
  }

  safeUpdate(opts.onUpdate, { status: 'failed', lastMessage: `已重试 ${submitAttempt} 轮` });
  return { status: 'failed' as const, message: `已重试 ${submitAttempt} 轮仍未成功` };
}

function safeUpdate(updater: (patch: Partial<TaskItem>) => void, patch: Partial<TaskItem>) {
  try { updater(patch); } catch { /* ignore stale state updates */ }
}

// ==================== 并行队列（原有） ====================

export async function runTaskQueue(tasks: TaskItem[], api: CourseApi, opts: {
  maxRetries: number;
  retryIntervalMs: number;
  monitorIntervalMs: number;
  concurrency: number;
  forceBypassCapacity: boolean;
  ignoreTimeConflict: boolean;
  onUpdateTask: (teachId: string, patch: Partial<TaskItem>) => void;
  onLog?: (msg: string) => void;
  cancelled: () => boolean;
}) {
  await Promise.all(tasks.map(async (task, index) => {
    safeUpdate(() => opts.onUpdateTask(task.teachId, { status: 'monitoring', attempts: 0, lastMessage: '' }), {});
    const result = await runTask(task, api, {
      maxRetries: opts.maxRetries,
      retryIntervalMs: opts.retryIntervalMs,
      monitorIntervalMs: opts.monitorIntervalMs,
      concurrency: opts.concurrency,
      forceBypassCapacity: opts.forceBypassCapacity,
      ignoreTimeConflict: opts.ignoreTimeConflict,
      onUpdate: (patch) => opts.onUpdateTask(task.teachId, patch),
      onLog: opts.onLog,
      cancelled: opts.cancelled,
      taskIndex: index,
    });
    opts.onUpdateTask(task.teachId, { status: result.status, lastMessage: result.message });
  }));
}

// ==================== 同课多班择一（新增） ====================

/**
 * 并行抢课 + 同课多班择一：
 * - 不同课程(courseCode)之间并行
 * - 同一门课的多个教学班按优先级顺序尝试
 * - 抢到任意一个班后，同门课其余班标记「已跳过」
 * - 当前班明确失败(容量满等)或超时后，自动回退到下一优先级班
 */
export async function runGroupedTaskQueue(tasks: TaskItem[], api: CourseApi, opts: {
  maxRetries: number;
  retryIntervalMs: number;
  monitorIntervalMs: number;
  concurrency: number;
  forceBypassCapacity: boolean;
  ignoreTimeConflict: boolean;
  onUpdateTask: (teachId: string, patch: Partial<TaskItem>) => void;
  onLog?: (msg: string) => void;
  cancelled: () => boolean;
}) {
  // 按 courseCode 分组
  const groups = new Map<string, TaskItem[]>();
  for (const task of tasks) {
    const key = task.courseCode || task.teachId; // 无 courseCode 时以 teachId 为一组
    const arr = groups.get(key) || [];
    arr.push(task);
    groups.set(key, arr);
  }

  await Promise.all(
    [...groups.values()].map(async (groupTasks) => {
      // 组内按优先级从高到低排序
      const ordered = [...groupTasks].sort(
        (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.teachId.localeCompare(b.teachId)
      );

      let secured = false;

      for (let gi = 0; gi < ordered.length; gi++) {
        if (opts.cancelled()) return;

        const task = ordered[gi];
        if (secured) {
          opts.onUpdateTask(task.teachId, { status: 'cancelled' as const, lastMessage: '同门课已选上其他教学班,已跳过' });
          continue;
        }

        safeUpdate(() => opts.onUpdateTask(task.teachId, { status: 'monitoring', attempts: 0, lastMessage: '' }), {});
        const result = await runTask(task, api, {
          maxRetries: opts.maxRetries,
          retryIntervalMs: opts.retryIntervalMs,
          monitorIntervalMs: opts.monitorIntervalMs,
          concurrency: opts.concurrency,
          forceBypassCapacity: opts.forceBypassCapacity,
          ignoreTimeConflict: opts.ignoreTimeConflict,
          onUpdate: (patch) => opts.onUpdateTask(task.teachId, patch),
          onLog: opts.onLog,
          cancelled: opts.cancelled,
          taskIndex: gi, // 组内索引用于 jitter
          maxMonitorRounds: 2, // 容量满监控2轮后自动回退到下一优先级班
        });

        if (result.status === 'success') {
          secured = true;
        }
        // 失败继续回退到同组下一个班
      }
    })
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
