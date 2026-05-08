// Override the workspace-root postcss.config.js which applies
// tailwindcss@3 to all CSS.  Tailwind 4 (used here) processes CSS
// via @tailwindcss/vite plugin directly and needs NO postcss
// plugins.  Leaving plugins empty prevents the root config from
// clobbering ours.
module.exports = { plugins: {} };
