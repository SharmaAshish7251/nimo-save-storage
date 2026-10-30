import 'react-native-get-random-values';
import { Buffer } from 'buffer';

const g: any = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {});

// Ensure global Buffer is available
if (typeof g.Buffer === 'undefined') {
  g.Buffer = Buffer;
}

// Ensure global process has all required properties
if (typeof g.process === 'undefined') {
  g.process = {};
}
const proc = g.process;
proc.browser = true;
proc.version = proc.version || 'v18.0.0';
proc.versions = proc.versions || { node: '18.0.0' };
if (!proc.env) {
  proc.env = {};
}
if (!proc.nextTick) {
  proc.nextTick = (fn: Function, ...args: any[]) => setTimeout(() => fn(...args), 0);
}

g.process = proc;

// Polyfill window, addEventListener, removeEventListener, dispatchEvent, and location for React Native
if (typeof g.window === 'undefined') {
  g.window = g;
}
const win = g.window;
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
  } catch {
    // Ignore read-only errors
  }
}
