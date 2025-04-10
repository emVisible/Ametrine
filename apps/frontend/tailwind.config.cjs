import('tailwindcss').Config
// import 'tailwindcss/tailwind.css';
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx,vue}",
  ],
  theme: {
    extend: {
      backgroundImage:{
          "main": "url('/images/background.jpg')"
      }
    },
  },
  plugins: [],
}
