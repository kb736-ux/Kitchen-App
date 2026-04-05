// Debug helpers for React Native development

export const log = (message, data = null) => {
  if (__DEV__) {
    console.log(`🐛 DEBUG: ${message}`, data);
  }
};

export const logError = (error, context = '') => {
  if (__DEV__) {
    console.error(`❌ ERROR ${context}:`, error);
  }
};

export const logPerformance = (label, fn) => {
  if (__DEV__) {
    const start = Date.now();
    const result = fn();
    const end = Date.now();
    console.log(`⏱️ PERFORMANCE ${label}: ${end - start}ms`);
    return result;
  }
  return fn();
};

// Component state debugger
export const useDebugState = (stateName, state) => {
  if (__DEV__) {
    console.log(`🔍 STATE ${stateName}:`, state);
  }
};