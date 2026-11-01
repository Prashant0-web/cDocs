/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                // "Paper & Ink" Brand Palette
                brand: {
                    light: '#f7f6f1',   // Paper cream (e.g. bg-brand-light)
                    DEFAULT: '#364252', // Deep ink slate (e.g. bg-brand, text-brand)
                    dark: '#242d38',    // Dark ink (e.g. bg-brand-dark)
                },
                accent: {
                    DEFAULT: '#f9dc42', // Golden ink accent (e.g. bg-accent, text-accent)
                    dark: '#eab308',    // Deep accent hover
                },
            }
        },
    },
    plugins: [],
}