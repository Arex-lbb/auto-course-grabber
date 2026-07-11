"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeJwtPayload = decodeJwtPayload;
exports.decodeStudentIdFromToken = decodeStudentIdFromToken;
function decodeJwtPayload(token) {
    const parts = token.split('.');
    if (parts.length < 2) throw new Error('token 格式不正确');
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(normalized, 'base64').toString('utf-8'));
}
function decodeStudentIdFromToken(token) {
    const payload = decodeJwtPayload(token);
    if (!payload.sub) throw new Error('token 中缺少学号(sub)字段');
    return payload.sub;
}
