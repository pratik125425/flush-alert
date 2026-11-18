import { defineConfig, type Plugin } from "vite";

// Preload the two Latin font files used above the fold, so the headline does not reflow on swap.
const preloadFonts = (): Plugin => ({
  name: "preload-fonts",
  transformIndexHtml(_html, ctx) {
    if (!ctx.bundle) return;
    return Object.keys(ctx.bundle)
      .filter((f) => /(source-serif-4-latin-opsz|public-sans-latin-wght)-normal-.*\.woff2$/.test(f))
      .map((f) => ({ tag: "link", injectTo: "head-prepend" as const,
        attrs: { rel: "preload", as: "font", type: "font/woff2", href: `./${f}`, crossorigin: "" } }));
  },
});

// Relative base so the build works from any GitHub Pages sub-path.
export default defineConfig({
  base: "./",
  plugins: [preloadFonts()],
  build: { target: "es2022", assetsInlineLimit: 0, chunkSizeWarningLimit: 600 },
});
