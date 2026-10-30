import 'react-native-get-random-values';
import { Buffer } from 'buffer';

const g: any = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {});

// Ensure global Buffer is available
if (typeof g.Buffer === 'undefined') {
  try {
    g.Buffer = Buffer;
  } catch {}
}

// Ensure global process has all required properties safely without crashing in Node.js
if (typeof g.process === 'undefined') {
  g.process = {};
}
const proc = g.process;

try {
  if (typeof proc.browser === 'undefined') {
    proc.browser = true;
  }
} catch {}

try {
  if (!proc.version) {
    proc.version = 'v18.0.0';
  }
} catch {}

try {
  if (!proc.versions) {
    proc.versions = { node: '18.0.0' };
  }
} catch {}

try {
  if (!proc.env) {
    proc.env = {};
  }
} catch {}

try {
  if (!proc.nextTick) {
    proc.nextTick = (fn: Function, ...args: any[]) => setTimeout(() => fn(...args), 0);
  }
} catch {}

// Polyfill window, addEventListener, removeEventListener, dispatchEvent, and location for React Native
if (typeof g.window === 'undefined') {
  try {
    g.window = g;
  } catch {}
}

const win = g.window;
if (win) {
  try {
    if (!win.addEventListener) {
      win.addEventListener = (_event: string, _callback: any, _options?: any) => {};
    }
    if (!win.removeEventListener) {
      win.removeEventListener = (_event: string, _callback: any, _options?: any) => {};
    }
    if (!win.dispatchEvent) {
      win.dispatchEvent = () => true;
    }
    if (!win.location) {
      win.location = {
        protocol: 'https:',
        host: 'vesta.web.telegram.org',
        hostname: 'vesta.web.telegram.org',
        href: 'https://vesta.web.telegram.org/',
        port: '443',
      };
    }
  } catch {}
}

if (typeof window !== 'undefined') {
  try {
    if (!window.addEventListener) {
      (window as any).addEventListener = (_event: string, _callback: any, _options?: any) => {};
    }
    if (!window.removeEventListener) {
      (window as any).removeEventListener = (_event: string, _callback: any, _options?: any) => {};
    }
    if (!window.dispatchEvent) {
      (window as any).dispatchEvent = () => true;
    }
    if (!window.location) {
      (window as any).location = {
        protocol: 'https:',
        host: 'vesta.web.telegram.org',
        hostname: 'vesta.web.telegram.org',
        href: 'https://vesta.web.telegram.org/',
        port: '443',
      };
    }
  } catch {}
}
