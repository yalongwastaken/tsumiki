/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // gentle violet — the brand/primary accent
        brand: {
          50: "#F3F1FE",
          100: "#E9E5FD",
          200: "#D6CEFB",
          400: "#9B8AFA",
          500: "#8B7CF6",
          600: "#7C6FE8",
          700: "#6D5DD3",
        },
      },
    },
  },
  plugins: [],
};
