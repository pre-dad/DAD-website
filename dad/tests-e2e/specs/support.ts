export const ORIGIN = 'http://127.0.0.1:8080';

export const unique = (tag: string) => `${tag}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
