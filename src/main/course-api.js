const axios = require('axios');
const { createClient, httpsAgent, httpAgent } = require('./request-client.js');
const { encryptQueryParams } = require('./sm2.js');
const { decodeJwtPayload, decodeStudentIdFromToken } = require('./jwt.js');
const { resolveCurrentTermId } = require('./term-resolver.js');

const BASE_URL = 'https://yhxt.swjtu.edu.cn/yethan';

// ============ 课程查询 ============

async function searchCourses(ytoken, params) {
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
  return { total: resp.data?.total ?? 0, data: resp.data?.data ?? [] };
}

async function listPreferredCourses(ytoken) {
  const client = createClient(ytoken);
  const _j = encryptQueryParams({});
  const resp = await client.get('/register/student-course/preferred-list', { params: { _j } });
  if (resp.data?.code && resp.data.code !== '00000') throw new Error(resp.data.message || resp.data.msg || '获取优选班课程列表失败');
  return resp.data?.data ?? [];
}

async function getCourseCapacity(ytoken, teachIds) {
  if (teachIds.length === 0) return [];
  const client = createClient(ytoken);
  const _j = encryptQueryParams({ teachIds: teachIds.join(',') });
  const resp = await client.get('/register/student-course-list/course-capacity', { params: { _j } });
  if (resp.data?.code && resp.data.code !== '00000') throw new Error(resp.data.message || resp.data.msg || '获取课程容量失败');
  return (resp.data?.data ?? []).map(function (d) {
    return {
      teachId: String(d.teachId),
      studentNumber: Number(d.studentNumber ?? 0),
      fullNumber: Number(d.fullNumber ?? 0),
      hasApplied: Boolean(d.hasApplied),
      hasSelected: Boolean(d.hasSelected),
    };
  });
}

// ============ 选课开放检测 ============

async function checkChooseTime(ytoken, teachId) {
  const client = createClient(ytoken);
  const _j = encryptQueryParams({ teachId });
  const resp = await client.get('/register/student-course/check-choose-time', { params: { _j }, validateStatus: function () { return true; } });
  const open = resp.data?.code === '00000' || resp.data?.status === true;
  return { open, raw: resp.data };
}

// ============ 选课操作 ============

async function selectCourse(ytoken, teachId) {
  const client = createClient(ytoken);
  const { termId } = await resolveCurrentTermId(ytoken);
  const _j = encryptQueryParams({ teachId, termId });
  const resp = await client.post('/register/course-selection/select', { _j });
  const d = resp.data || {};
  const success = d.code === '00000' || d.status === true || d.success === true || /成功/.test(d.message || d.msg || '');
  return { success, message: d.message || d.msg || (success ? '选课成功' : '选课失败'), raw: d };
}

async function applyCourse(ytoken, teachId, opts) {
  opts = opts || {};
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

async function cancelApplication(ytoken, applyId) {
  const client = createClient(ytoken);
  const _j = encryptQueryParams({});
  const resp = await client.delete('/register/student-course-apply-query/cancel/' + applyId, { data: { _j } });
  const success = resp.data?.code === '00000' || resp.data?.status === true;
  return { success, message: resp.data?.message || resp.data?.msg || (success ? '取消成功' : '取消失败'), raw: resp.data };
}

async function listMySelections(ytoken, opts) {
  opts = opts || {};
  const client = createClient(ytoken);
  const query = { pageNum: opts.pageNum ?? 1, pageSize: opts.pageSize ?? 100 };
  const _j = encryptQueryParams(query);
  const resp = await client.get('/register/student-course-list/my-courses', { params: { _j }, validateStatus: function () { return true; } });
  if (resp.data?.code && resp.data.code !== '00000') throw new Error(resp.data.message || resp.data.msg || '获取已选课程失败');
  return { total: resp.data?.total ?? 0, data: resp.data?.data ?? [] };
}

async function listMyApplications(ytoken, opts) {
  opts = opts || {};
  const client = createClient(ytoken);
  const query = { pageNum: opts.pageNum ?? 1, pageSize: opts.pageSize ?? 100 };
  const _j = encryptQueryParams(query);
  const resp = await client.get('/register/student-course-apply-query/my-applications', { params: { _j } });
  if (resp.data?.code && resp.data.code !== '00000') throw new Error(resp.data.message || resp.data.msg || '获取选课申请列表失败');
  return { total: resp.data?.total ?? 0, data: resp.data?.data ?? [] };
}

async function updateChooseScore(ytoken, applyId, termId, chooseScore) {
  const client = createClient(ytoken);
  const studentId = decodeStudentIdFromToken(ytoken);
  const _j = encryptQueryParams({ studentId, termId, applyId, chooseScore });
  const resp = await client.post('/register/student-course-apply/update-choose-score', { _j });
  const success = resp.data?.code === '00000' || resp.data?.status === true;
  return { success, message: resp.data?.message || resp.data?.msg || (success ? '更新志愿分数成功' : '更新志愿分数失败'), raw: resp.data };
}

// ============ Token 心跳 ============

async function checkTokenHeartbeat(ytoken) {
  const client = createClient(ytoken);
  const _j = encryptQueryParams({});
  const resp = await client.get('/register/student-course/preferred-list', { params: { _j }, validateStatus: function () { return true; } });
  if (resp.status === 401) return { valid: false, message: '登录状态已过期(HTTP 401)' };
  const code = resp.data?.code == null ? '' : String(resp.data.code);
  if (code === '401' || code === 'A0230' || code === 'A0422') return { valid: false, message: resp.data?.message || resp.data?.msg || '登录状态已过期,请重新登录' };
  return { valid: true, message: code && code !== '00000' ? '心跳正常(业务码 ' + code + ')' : '心跳正常' };
}

async function keepAliveByStudentInfo(ytoken) {
  const client = createClient(ytoken);
  const _j = encryptQueryParams({});
  try {
    const resp = await client.get('/register/student-course/info', { params: { _j }, validateStatus: function () { return true; } });
    if (resp.status === 401) return false;
    const code = resp.data?.code == null ? '' : String(resp.data.code);
    if (code === '401' || code === 'A0230' || code === 'A0422') return false;
    return true;
  } catch (e) {
    return true;
  }
}

// ============ 账号登录 ============

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

async function getLoginCaptcha() {
  try {
    const client = createPublicClient();
    const _j = encryptQueryParams({});
    const resp = await client.get('/code', { params: { _j } });
    const data = (resp.data && resp.data.data) || resp.data || {};
    return {
      uuid: String(data.uuid ?? ''),
      salt: String(data.salt ?? ''),
      img: String(data.img ?? data.image ?? ''),
    };
  } catch (e) {
    throw new Error('获取验证码失败: ' + (e && e.message ? e.message : String(e)));
  }
}

async function loginByPassword(params) {
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
  const body = resp.data ?? {};
  const token = body.token || body.data?.token || '';
  const success = Boolean(token);
  const message = body.message || body.msg || (success ? '登录成功' : '登录失败,请检查学号/密码/验证码');
  return { success, message, token: token || undefined };
}

module.exports = {
  decodeStudentIdFromToken,
  searchCourses,
  listPreferredCourses,
  getCourseCapacity,
  checkChooseTime,
  selectCourse,
  listMySelections,
  applyCourse,
  cancelApplication,
  listMyApplications,
  updateChooseScore,
  checkTokenHeartbeat,
  keepAliveByStudentInfo,
  getLoginCaptcha,
  loginByPassword,
};
