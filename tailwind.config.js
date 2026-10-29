/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}'
  ],
  theme: {
    extend: {
      colors: {
        abyss: '#05050A',
        surface: '#0C0D16',
        aether: '#18D8FF',
        neonviolet: '#A94DFF',
        cyan: {
          50: '#F1FBFF',
          100: '#D8F5FF',
          200: '#B3EAFF',
          300: '#78DAFF',
          400: '#25C3FF',
          500: '#377DFF',
          600: '#5156FF',
          700: '#693DE6',
          800: '#512EB5',
          900: '#38227F',
          950: '#211346'
        }
      },
      boxShadow: {
        glow: '0 1px 2px rgba(0, 0, 0, 0.5), 0 0 12px rgba(81, 86, 255, 0.18), 0 0 20px rgba(0, 217, 255, 0.08)',
        'glow-sm': '0 0 8px rgba(81, 86, 255, 0.18)'
      }
    }
  },
  plugins: []
};
