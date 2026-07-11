import axios from 'axios';
import { createClient, httpsAgent, httpAgent } from './request-client';
import { encryptQueryParams } from './sm2';
import { decodeStudentIdFromToken } from './jwt';
import { BASE_URL } from '../shared/constants';
import type { ApplyResult, CourseItem, CourseSearchParams } from '../shared/types';

// ============ 课程查询 ============

export async function searchCourses(ytoken: string, params: CourseSearchParams) {
  const client = createClient(ytoken);
  const query = {
    keywords: params.keywords,
    courseType: params.courseType ?? '',
    collegeCode: params.collegeCode ?? '',
    campusCode: params.campusCode ?? '',
    termId: params.termId,
    pageNum: params.pageNum ?? 1,
    pageSize: params.pageSize ?? 20,
  };
  const _j = encryptQueryParams(query);
  const resp = await client.get('/register/student-course-list/non-preferred-page', { params: { _j } });
  if (resp.data?.code && resp.data.code !== '00000') throw new Error(resp.data.message || resp.data.msg || '查询课程失败');
  return { total: resp.data?.total ?? 0, data: (resp.data?.data ?? []) as CourseItem[] };
}

export async function listPreferredCourses(ytoken: string) {
  const client = createClient(ytoken);
  const _j = encryptQueryParams({});
  const resp = await client.get('/register/student-course/preferred-list', { params: { _j } });
  if (resp.data?.code && resp.data.code !== '00000') throw new Error(resp.data.message || resp.data.msg || '获取优选班课程列表失败');
  return (resp.data?.data ?? []) as CourseItem[];
}

export async function getCourseCapacity(ytoken: string, teachIds: string[]) {
  if (teachIds.length === 0) return [];
  const client = createClient(ytoken);
  const _j = encryptQueryParams({ teachIds: teachIds.join(',') });
  const resp = await client.get('/register/student-course-list/course-capacity', { params: { _j } });
  if (resp.data?.code && resp.data.code !== '00000') throw new Error(resp.data.message || resp.data.msg || '获取课程容量失败');
  return (resp.data?.data ?? []).map((d: any) => ({
    teachId: String(d.teachId),
    studentNumber: Number(d.studentNumber ?? 0),
    fullNumber: Number(d.fullNumber ?? 0),
    hasApplied: Boolean(d.hasApplied),
    hasSelected: Boolean(d.hasSelected),
  }));
}

// ============ 选课操作 ============

export async function applyCourse(ytoken: string, teachId: string, opts: { chooseScore?: number; ignoreTimeConflict?: boolean } = {}): Promise<ApplyResult> {
  const client = createClient(ytoken);
  const body = {
    teachId,
    applyAction: 'add',
    chooseScore: opts.chooseScore ?? 0,
    ignoreTimeConflict: opts.ignoreTimeConflict ?? false,
  };
  const _j = encryptQueryParams(body);
  const resp = await client.post('/register/student-course/apply', { _j });
  const success = resp.data?.code === '00000' || resp.data?.status === true;
  return { success, message: resp.data?.message || resp.data?.msg || (success ? '选课申请成功' : '选课申请失败'), raw: resp.data };
}

export async function cancelApplication(ytoken: string, applyId: string): Promise<ApplyResult> {
  const client = createClient(ytoken);
  const _j = encryptQueryParams({});
  const resp = await client.delete(`/register/student-course-apply-query/cancel/${applyId}`, { data: { _j } });
  const success = resp.data?.code === '00000' || resp.data?.status === true;
  return { success, message: resp.data?.message || resp.data?.msg || (success ? '取消成功' : '取消失败'), raw: resp.data };
}

export async function listMyApplications(ytoken: string) {
  const client = createClient(ytoken);
  const _j = encryptQueryParams({});
  const resp = await client.get('/register/student-course-apply-query/my-applications', { params: { _j } });
  if (resp.data?.code && resp.data.code !== '00000') throw new Error(resp.data.message || resp.data.msg || '获取选课申请列表失败');
  return { total: resp.data?.total ?? 0, data: resp.data?.data ?? [] };
}

export async function updateChooseScore(ytoken: string, applyId: string, termId: number, chooseScore: number): Promise<ApplyResult> {
  const client = createClient(ytoken);
  const studentId = decodeStudentIdFromToken(ytoken);
  const _j = encryptQueryParams({ studentId, termId, applyId, chooseScore });
  const resp = await client.post('/register/student-course-apply/update-choose-score', { _j });
  const success = resp.data?.code === '00000' || resp.data?.status === true;
  return { success, message: resp.data?.message || resp.data?.msg || (success ? '更新志愿分数成功' : '更新志愿分数失败'), raw: resp.data };
}

// ============ Token 心跳 ============

export async function checkTokenHeartbeat(ytoken: string) {
  const client = createClient(ytoken);
  const _j = encryptQueryParams({});
  const resp = await client.get('/register/student-course/preferred-list', { params: { _j }, validateStatus: () => true });
  if (resp.status === 401) return { valid: false, message: '登录状态已过期(HTTP 401)' };
  const code = resp.data?.code == null ? '' : String(resp.data.code);
  if (code === '401' || code === 'A0230' || code === 'A0422') return { valid: false, message: resp.data?.message || resp.data?.msg || '登录状态已过期,请重新登录' };
  return { valid: true, message: code && code !== '00000' ? `心跳正常(业务码 ${code})` : '心跳正常' };
}

export async function keepAliveByStudentInfo(ytoken: string): Promise<boolean> {
  const client = createClient(ytoken);
  const _j = encryptQueryParams({});
  try {
    const resp = await client.get('/register/student-course/info', { params: { _j }, validateStatus: () => true });
    if (resp.status === 401) return false;
    const code = resp.data?.code == null ? '' : String(resp.data.code);
    if (code === '401' || code === 'A0230' || code === 'A0422') return false;
    return true;
  } catch {
    return true; // 网络异常不武断判失效
  }
}

// ============ 账号登录（验证码 + 密码） ============

function createPublicClient() {
  return axios.create({
    baseURL: BASE_URL,
    timeout: 10000,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Referer: 'https://yhxt.swjtu.edu.cn/study/',
      Origin: 'https://yhxt.swjtu.edu.cn',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
    httpsAgent,
    httpAgent,
  });
}

export async function getLoginCaptcha() {
  try {
    const client = createPublicClient();
    const _j = encryptQueryParams({});
    const resp = await client.get('/code', { params: { _j } });
    const data = (resp.data && (resp.data.data as Record<string, unknown>)) || resp.data || {};
    return {
      uuid: String((data as any).uuid ?? ''),
      salt: String((data as any).salt ?? ''),
      img: String((data as any).img ?? (data as any).image ?? ''),
    };
  } catch (e) {
    throw new Error(`获取验证码失败: ${(e as Error)?.message || e}`);
  }
}

export async function loginByPassword(params: { username: string; password: string; code?: string; uuid?: string; salt?: string }) {
  const client = createPublicClient();
  const useCaptcha = Boolean(params.code);
  const data = {
    username: params.username,
    password: params.password,
    code: params.code ?? '',
    uuid: params.uuid ?? '',
    salt: params.salt ?? '',
    from: 'web',
  };
  const payload = useCaptcha ? { params: { code: data.code, uuid: data.uuid }, data } : data;
  const _j = encryptQueryParams(payload);
  const resp = await client.post('/login', { _j }, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
  const body = (resp.data ?? {}) as any;
  const token = body.token || body.data?.token || '';
  const success = Boolean(token);
  const message = body.message || body.msg || (success ? '登录成功' : '登录失败,请检查学号/密码/验证码');
  return { success, message, token: token || undefined };
}
