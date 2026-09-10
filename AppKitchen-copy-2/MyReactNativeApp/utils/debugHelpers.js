import { isDev } from '../constants/dev';

export const log = (message, data = null) => {
  if (isDev) {
    console.log(`🐛 DEBUG: ${message}`, data);
  }
};

export const logError = (error, context = '') => {
  if (isDev) {
    console.error(`❌ ERROR ${context}:`, error);
  }
};

export const logPerformance = (label, fn) => {
  if (isDev) {
    const start = Date.now();
    const result = fn();
    const end = Date.now();
    console.log(`⏱️ PERFORMANCE ${label}: ${end - start}ms`);
    return result;
  }
  return fn();
};

export const useDebugState = (stateName, state) => {
  if (isDev) {
    console.log(`🔍 STATE ${stateName}:`, state);
  }
};
