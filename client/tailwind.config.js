import colors from 'tailwindcss/colors';

const palette = (name, shades) => Object.fromEntries(Object.entries(shades).map(([shade, hex]) => {
  const rgb = hex.slice(1).match(/.{2}/g).map((channel) => parseInt(channel, 16)).join(' ');
  return [shade, `rgb(var(--palette-${name}-${shade}, ${rgb}) / <alpha-value>)`];
}));

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        slate: palette('slate', colors.slate),
        navy: palette('navy', {
          950: '#050d1a',
          900: '#0a1628',
          800: '#0f2035',
          750: '#152840',
          700: '#1a3050',
          600: '#1e3a5f',
          500: '#2a4a7a',
          400: '#3a5d94',
          300: '#5278b0',
        }),
        gold: palette('gold', {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
        }),
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 4px 24px rgba(0, 0, 0, 0.5)',
        glow: '0 0 24px rgba(245, 158, 11, 0.25)',
        'glow-sm': '0 0 12px rgba(245, 158, 11, 0.2)',
        'inner-glow': 'inset 0 1px 0 rgba(255,255,255,0.05)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-card': 'linear-gradient(135deg, #0f2035 0%, #0a1628 100%)',
        'gradient-gold': 'linear-gradient(135deg, rgb(var(--palette-gold-400, 251 191 36)) 0%, rgb(var(--palette-gold-500, 245 158 11)) 100%)',
        'gradient-hero': 'linear-gradient(135deg, #0a1628 0%, #1a3050 50%, #0a1628 100%)',
      },
      animation: {
        'slide-up': 'slideUp 0.25s ease-out',
        'slide-down': 'slideDown 0.25s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
        'scale-in': 'scaleIn 0.15s ease-out',
        'spin-slow': 'spin 2s linear infinite',
        'pulse-gold': 'pulseGold 2s ease-in-out infinite',
      },
      keyframes: {
        slideUp: {
          '0%': { transform: 'translateY(12px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-12px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        pulseGold: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
      },
    },
  },
  plugins: [],
};
