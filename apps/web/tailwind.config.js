import { pluginContentGlobs } from './plugin-discovery.mjs';

/**
 * Plugin directories are in `content` from the same config Vite reads.
 *
 * This is the quiet failure mode of an out-of-tree plugin: its views import
 * fine, render fine, and arrive unstyled, because Tailwind never scanned the
 * files its classes are written in and purged every one of them. Deriving the
 * globs from `foreman-plugins.json` means adding a plugin cannot forget this
 * step. The globs are absolute so it does not matter which directory the build
 * was launched from.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', ...pluginContentGlobs()],
  theme: {
    extend: {
      fontFamily: {
        sans: ["'Instrument Sans'", 'system-ui', 'sans-serif'],
        mono: ["'JetBrains Mono'", 'ui-monospace', 'monospace'],
      },
      colors: {
        // Foreman surfaces, darkest (canvas) to lightest (raised control).
        canvas: '#0d0d10',
        rail: '#111114',
        panel: '#131317',
        card: '#17171b',
        cardAlt: '#15151a',
        control: '#1a1a1f',
        controlAlt: '#1c1c22',
        raised: '#22222a',
        track: '#2a2a32',
        trackDim: '#25252c',
        // Accent + status. Each has a tint (text on dark) and dim (secondary text).
        accent: { DEFAULT: '#e8963c', tint: '#f0c48a', dim: '#c99a5c' },
        ok: { DEFAULT: '#4ec97a', tint: '#8fd1a6' },
        warn: { DEFAULT: '#e5c04a', tint: '#dfc57e', dim: '#c9a94a' },
        danger: { DEFAULT: '#e5675b', tint: '#e39c94', dim: '#c9756b' },
        info: { DEFAULT: '#5b9dff', tint: '#8fb8f0' },
        violet: { DEFAULT: '#a67ff0', tint: '#c99ae0' },
        // Text ramp, brightest to faintest.
        ink: '#e8e8ea',
        ink2: '#c8c8ce',
        ink3: '#9a9aa2',
        ink4: '#8a8a92',
        muted: '#6b6b74',
        faint: '#565660',
        ghost: '#3d3d45',
      },
      borderColor: {
        hair: 'rgba(255,255,255,.06)',
        line: 'rgba(255,255,255,.07)',
        edge: 'rgba(255,255,255,.09)',
        strong: 'rgba(255,255,255,.12)',
      },
      keyframes: {
        // Status dots on live harnesses breathe rather than blink.
        bp: { '0%,100%': { opacity: '.35' }, '50%': { opacity: '1' } },
      },
      animation: {
        bp: 'bp 2s infinite',
        'bp-fast': 'bp 1.6s infinite',
      },
    },
  },
  plugins: [],
};
