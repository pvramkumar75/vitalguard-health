/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#0f172a', // Slate 900
          light: '#334155',   // Slate 700
        },
        accent: {
          DEFAULT: '#0ea5e9', // Sky 500
          hover: '#0284c7',   // Sky 600
        },
        surface: '#ffffff',
        border: '#e2e8f0',    // Slate 200
        success: '#10b981',
        error: '#ef4444',
        warning: '#f59e0b',
      },
      backgroundColor: {
        subtle: '#f8fafc', // Slate 50
      },
      textColor: {
        main: '#0f172a',
        muted: '#64748b',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        heading: ['Outfit', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
