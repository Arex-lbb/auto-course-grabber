export type TaskStatus = 'idle' | 'monitoring' | 'submitting' | 'backoff' | 'success' | 'failed' | 'cancelled';

export interface AuthConfig {
  token: string;
  updatedAt: string;
}

export interface SavedCredentials {
  username: string;
  password: string;
}

export interface TermInfo {
  termId: string;
  label?: string;
}

export interface CourseSearchParams {
  keywords: string;
  termId: string;
  courseType?: string;
  collegeCode?: string;
  campusCode?: string;
  pageNum?: number;
  pageSize?: number;
}

export interface CourseItem {
  teachId: string;
  courseCode: string;
  courseName: string;
  creditHour?: string | number;
  staffName?: string;
  collegeAbbrev?: string;
  studentNumber?: number | null;
  fullNumber?: number | null;
  hasApplied?: boolean;
  hasSelected?: boolean;
  canApply?: boolean;
  staffNameOther?: string;
  scheduleTime?: string;
  preferredType?: string;
  courseType?: string;
  collegeName?: string;
  campusName?: string;
  termId?: string;
}

export interface CapacityInfo {
  teachId: string;
  studentNumber: number;
  fullNumber: number;
  hasApplied: boolean;
  hasSelected: boolean;
}

export interface ApplyResult {
  success: boolean;
  message: string;
  raw?: unknown;
}

export interface TaskItem {
  teachId: string;
  courseCode?: string;
  courseName: string;
  creditHour?: string | number;
  staffName?: string;
  courseType?: string;
  scheduleTime?: string;
  /** 同门课内优先级：数字越大越优先（多班择一） */
  priority: number;
  status: TaskStatus;
  attempts: number;
  backoffMs: number;
  lastMessage: string;
  studentNumber?: number | null;
  fullNumber?: number | null;
}

export interface ApplicationItem {
  applyId?: string;
  id?: string;
  teachId: string;
  courseName: string;
  creditHour?: string | number;
  staffName?: string;
  courseType?: string;
  applyTime?: string;
  isChoosed?: number;
  chooseScore?: number;
}

export interface GrabConfig {
  concurrency: number;
  maxRetries: number;
  retryIntervalMs: number;
  monitorIntervalMs: number;
  forceBypassCapacity: boolean;
  ignoreTimeConflict: boolean;
}

export interface RetryPolicy {
  maxRetries: number;
  retryIntervalMs: number;
  frequencyBackoffMaxMs: number;
}

export interface LoginCaptcha {
  uuid: string;
  salt: string;
  img: string;
}

export interface LoginParams {
  username: string;
  password: string;
  code?: string;
  uuid?: string;
  salt?: string;
  remember?: boolean;
}

export interface LoginResult {
  success: boolean;
  message: string;
  token?: string;
  auth?: AuthConfig;
}

export type TokenStatus =
  | { state: 'unknown' }
  | { state: 'valid'; expiresAt: number | null }
  | { state: 'expired'; reason: string };
