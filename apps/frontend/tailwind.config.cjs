import('tailwindcss').Config
// import 'tailwindcss/tailwind.css';
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx,vue}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bgMain: 'var(--color-bg-main)',
        bgVice: 'var(--color-bg-vice)',
        bgAddition: 'var(--color-bg-addition)',
        bgReverse: 'var(--color-bg-reverse)',
        amethyst: 'var(--color-amethyst)',
        topaz: 'var(--color-topaz)',
        text: {
          gentle: 'var(--color-text-gentle)',
          heavy: 'var(--color-text-heavy)',
        },
      }
    }
  },
  plugins: [],
}
