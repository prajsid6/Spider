/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        spider: {
          // Primary: bold yellow — Rapido-inspired accent
          primary:   '#FFC200',   // Electric yellow
          hover:     '#E6AE00',   // Darker yellow on hover
          // Backgrounds — light neutral palette
          bg:        '#F8FAFC',   // Page background
          surface:   '#FFFFFF',   // Card / surface
          elevated:  '#FFFFFF',   // Elevated surfaces (modals, dropdowns)
          border:    '#E2E8F0',   // Subtle borders
          // Text
          text:      '#1E293B',   // Primary text
          muted:     '#64748B',   // Secondary grey text
          subtle:    '#94A3B8',   // Very muted / disabled
          // Semantic
          success:   '#22C55E',
          danger:    '#EF4444',
          warning:   '#F59E0B',
        }
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        'spider-sm':   '0 2px 8px rgba(0,0,0,0.4)',
        'spider-md':   '0 8px 24px rgba(0,0,0,0.5)',
        'spider-lg':   '0 16px 48px rgba(0,0,0,0.6)',
        'spider-glow': '0 0 24px rgba(255,194,0,0.3)',
        'yellow-glow': '0 0 32px rgba(255,194,0,0.25)',
      }
    },
  },
  plugins: [],
}
