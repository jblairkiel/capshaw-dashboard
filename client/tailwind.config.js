/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        church: {
          navy:   '#1a2744',
          gold:   '#c9a84c',
          cream:  '#f9f6f0',
          brown:  '#5c3d2e',
          sage:   '#7b9e87',
        },
      },
      fontFamily: {
        serif: ['"Georgia"', '"Times New Roman"', 'serif'],
      },
    },
  },
  plugins: [],
};
