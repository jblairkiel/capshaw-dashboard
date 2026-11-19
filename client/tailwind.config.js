import plugin from 'tailwindcss/plugin';
import { tailwindColors, THEMES, cssVars } from './theme/palettes.js';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    // Every color reads a CSS variable so a member's Display theme can swap the
    // palette (theme/palettes.js). The Standard values are the usual ones.
    colors: {
      transparent: 'transparent',
      current:     'currentColor',
      inherit:     'inherit',
      ...tailwindColors.colors,
    },
    extend: {
      backgroundColor: tailwindColors.backgroundColor,
      textColor:       tailwindColors.textColor,
      fontFamily: {
        serif: ['"Georgia"', '"Times New Roman"', 'serif'],
      },
    },
  },
  plugins: [
    plugin(({ addBase }) => {
      addBase({
        ':root': cssVars(THEMES.standard),
        ':root[data-theme="dark"]': { ...cssVars(THEMES.dark), colorScheme: 'dark' },
        ':root[data-theme="contrast"]': cssVars(THEMES.contrast),
      });
    }),
  ],
};
