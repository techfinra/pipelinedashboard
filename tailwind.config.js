/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: "#0D1F4E", deep: "#071230" },
        gold: "#C8A84B",
      },
      fontFamily: {
        sans: ["Noto Sans KR", "Malgun Gothic", "sans-serif"],
      },
    },
  },
  plugins: [],
};
