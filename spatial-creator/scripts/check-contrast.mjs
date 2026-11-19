/**
 * 可读性门禁：把 CSS 变量按 WCAG 2.1 算对比度。
 *
 * 为什么需要这个脚本：面板是半透明的，背景亮度随场景变化，
 * "看得清"不能靠眼睛判断，必须给出数字并且在最坏情况下也达标。
 * 最坏情况按"面板叠在纯白场景上"计算——浅色模型和明亮环境光都会逼近这个情形。
 */
import { readFileSync, writeFileSync } from "node:fs";

const css = readFileSync("src/styles.css", "utf8");
const pick = (name) => {
  const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`找不到变量 --${name}`);
  return m[1].trim();
};

function parseColor(s) {
  if (s.startsWith("#")) {
    const h = s.slice(1);
    const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    return { r: parseInt(n.slice(0, 2), 16), g: parseInt(n.slice(2, 4), 16), b: parseInt(n.slice(4, 6), 16), a: 1 };
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`无法解析颜色 ${s}`);
  const p = m[1].split(",").map((x) => parseFloat(x.trim()));
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}

const srgb = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const lum = ({ r, g, b }) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const ratio = (a, b) => {
  const l1 = lum(a);
  const l2 = lum(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
};
const over = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});

const panel = parseColor(pick("panel"));
const text = parseColor(pick("text"));
const dim = parseColor(pick("dim"));
const dim2 = parseColor(pick("dim-2"));
const accent = parseColor(pick("accent"));

const white = { r: 255, g: 255, b: 255, a: 1 };
const black = { r: 0, g: 0, b: 0, a: 1 };

/* 两种背景：纯黑场景（最亮对比）与纯白场景（最差对比） */
const bgBlack = over(panel, black);
const bgWhite = over(panel, white);

/* 高对比模式：body.contrast-high 覆盖了同名变量 */
const highBlock = css.match(/body\.contrast-high\s*\{([\s\S]*?)\}/);
const highPick = (name) => {
  const m = highBlock && highBlock[1].match(new RegExp(`--${name}:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
};
const hPanel = highPick("panel") ? parseColor(highPick("panel")) : panel;
const hText = highPick("text") ? parseColor(highPick("text")) : text;
const hDim = highPick("dim") ? parseColor(highPick("dim")) : dim;
const hDim2 = highPick("dim-2") ? parseColor(highPick("dim-2")) : dim2;
const hAccent = highPick("accent") ? parseColor(highPick("accent")) : accent;

const rows = [
  { name: "正文 --text", fg: text, bg: bgWhite, min: 4.5, level: "AA 正文" },
  { name: "次要 --dim", fg: dim, bg: bgWhite, min: 4.5, level: "AA 正文" },
  { name: "辅助 --dim-2", fg: dim2, bg: bgWhite, min: 3.0, level: "AA 大字/非文本" },
  { name: "强调 --accent", fg: accent, bg: bgWhite, min: 3.0, level: "AA 大字/非文本" },
  { name: "正文 --text（暗背景）", fg: text, bg: bgBlack, min: 4.5, level: "AA 正文" },
  { name: "辅助 --dim-2（暗背景）", fg: dim2, bg: bgBlack, min: 3.0, level: "AA 大字/非文本" },
  /* 高对比模式也必须过线，否则这个开关就是装饰 */
  { name: "高对比 · 正文", fg: hText, bg: over(hPanel, white), min: 7.0, level: "AAA 正文" },
  { name: "高对比 · 次要", fg: hDim, bg: over(hPanel, white), min: 7.0, level: "AAA 正文" },
  { name: "高对比 · 辅助", fg: hDim2, bg: over(hPanel, white), min: 4.5, level: "AA 正文" },
  { name: "高对比 · 强调", fg: hAccent, bg: over(hPanel, white), min: 4.5, level: "AA 正文" },
];

const out = { checkedAt: new Date().toISOString(), panelAlpha: panel.a, rows: [] };
let fail = 0;
for (const r of rows) {
  const c = ratio(r.fg, r.bg);
  const ok = c >= r.min;
  if (!ok) fail++;
  out.rows.push({ name: r.name, contrast: +c.toFixed(2), min: r.min, level: r.level, ok });
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${r.name.padEnd(22)} ${c.toFixed(2)}:1  (要求 ≥${r.min}, ${r.level})`);
}

out.pass = rows.length - fail;
out.total = rows.length;
writeFileSync("test-artifacts/contrast.json", JSON.stringify(out, null, 2));
console.log(`\n通过 ${out.pass}/${out.total}`);
process.exitCode = fail ? 1 : 0;
