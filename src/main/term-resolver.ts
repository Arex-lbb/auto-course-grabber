import { createClient } from './request-client';
import { encryptQueryParams } from './sm2';
import type { TermInfo } from '../shared/types';

export async function resolveCurrentTermId(ytoken: string): Promise<TermInfo> {
  const client = createClient(ytoken);
  try {
    const _j = encryptQueryParams({});
    const resp = await client.get('/course-choose-overview/getParameters', { params: { _j } });
    const data = resp.data?.data ?? resp.data ?? {};
    const termId = String(data.termId ?? data.currentTermId ?? data.termCode ?? '');
    if (!termId) throw new Error('未能解析当前学期 ID');
    return { termId, label: data.termName ? String(data.termName) : undefined };
  } catch {
    return { termId: '124' };
  }
}
