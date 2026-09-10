/** Metro/Hermes usually injects __DEV__; guard so a missing global is not a ReferenceError. */
export const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
