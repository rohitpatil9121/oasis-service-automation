/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#0f766e", dark: "#115e59", light: "#5eead4" },
      },
    },
  },
  plugins: [],
};
