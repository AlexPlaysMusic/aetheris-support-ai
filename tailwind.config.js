/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}'
  ],
  theme: {
    extend: {
      colors: {
        abyss: '#0B0F17',
        surface: '#111827',
        aether: '#00F2FE',
        neonviolet: '#8B5CF6'
      },
      boxShadow: {
        glow: '0 1px 2px rgba(0, 0, 0, 0.5), 0 0 12px rgba(0, 242, 254, 0.10)',
        'glow-sm': '0 0 8px rgba(0, 242, 254, 0.10)'
      }
    }
  },
  plugins: []
};
