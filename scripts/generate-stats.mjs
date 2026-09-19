#!/usr/bin/env node
// Generates the self-hosted top-languages and quote-of-the-day SVG cards for
// the profile README, replacing the flaky github-readme-stats.vercel.app
// service. Runs on GitHub Actions with the default GITHUB_TOKEN, no PAT needed.
//
// One fixed dark palette for the card chrome, the same tones GitHub uses, so
// the cards sit well on both the light and the dark theme. Languages keep
// their own brand colours.

const USERNAME = process.env.PROFILE_USER || "lucianookdp";
const TOKEN = process.env.GITHUB_TOKEN;

const ACCENT = "#3fb950";
const BG = "#0d1117";
const BORDER = "#22272e";
const FG = "#e6edf3";
const MUTED = "#8b949e";
const TRACK = "#21262d";

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const WIDTH = 520;

if (!TOKEN) {
  console.error("Missing GITHUB_TOKEN");
  process.exit(1);
}

const headers = {
  Authorization: `bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "User-Agent": `${USERNAME}-profile-stats`,
};

async function rest(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) throw new Error(`REST ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function fetchAllOwnedRepos() {
  const repos = [];
  let page = 1;
  while (true) {
    const batch = await rest(
      `/users/${USERNAME}/repos?type=owner&per_page=100&page=${page}`
    );
    repos.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return repos.filter((r) => !r.fork);
}

async function fetchLanguageBytes(repos) {
  const totals = new Map();
  for (const repo of repos) {
    const langs = await rest(`/repos/${USERNAME}/${repo.name}/languages`);
    for (const [lang, bytes] of Object.entries(langs)) {
      totals.set(lang, (totals.get(lang) || 0) + bytes);
    }
  }
  return totals;
}

function escapeXml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function card({ title, width, height, body }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}">
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="12" fill="${BG}" stroke="${BORDER}" />
  <style>
    .title { font-size: 14px; font-weight: 600; fill: ${ACCENT}; }
    .label { font-size: 12.5px; fill: ${MUTED}; }
    .value { font-size: 12.5px; font-weight: 600; fill: ${FG}; }
    .quote { font-size: 14px; font-weight: 400; fill: ${FG}; }
  </style>
  <text x="22" y="30" class="title">${escapeXml(title)}</text>
  ${body}
</svg>`;
}

// ---- Most used languages ----

// Cor de marca de cada linguagem, as mesmas que o GitHub usa no linguist.
const LANG_COLORS = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572A5",
  PHP: "#4F5D95",
  "C#": "#178600",
  Dart: "#00B4AB",
  C: "#555555",
  Go: "#00ADD8",
  Astro: "#ff5a03",
  HTML: "#e34c26",
  CSS: "#563d7c",
  SCSS: "#c6538c",
  Blade: "#f7523f",
  Shell: "#89e051",
  Java: "#b07219",
  Ruby: "#701516",
  Rust: "#dea584",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  Jupyter: "#DA5B0B",
  "Jupyter Notebook": "#DA5B0B",
  Dockerfile: "#384d54",
  Makefile: "#427819",
  "C++": "#f34b7d",
};
const corDaLinguagem = (lang, i) =>
  LANG_COLORS[lang] || ["#8b949e", "#6e7681", "#484f58"][i % 3];

const LEGEND_TOP = 84;
const LEGEND_STEP = 24;
const LEGEND_COLS = 3;

function topLangsCard(totals) {
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const total = sorted.reduce((sum, [, bytes]) => sum + bytes, 0);

  const barWidth = WIDTH - 44;
  const track = `<rect x="22" y="50" width="${barWidth}" height="8" rx="4" fill="${TRACK}" />`;
  let x = 22;
  const segments = sorted
    .map(([lang, bytes], i) => {
      const w = total > 0 ? Number(((bytes / total) * barWidth).toFixed(2)) : 0;
      const rect = `<rect x="${Number(x.toFixed(2))}" y="50" width="${w}" height="8" fill="${corDaLinguagem(lang, i)}" />`;
      x += w;
      return rect;
    })
    .join("\n  ");

  const colWidth = barWidth / LEGEND_COLS;
  const legend = sorted
    .map(([lang, bytes], i) => {
      const pct = total > 0 ? ((bytes / total) * 100).toFixed(1) : "0.0";
      const lx = Number((22 + (i % LEGEND_COLS) * colWidth).toFixed(2));
      const ly = LEGEND_TOP + Math.floor(i / LEGEND_COLS) * LEGEND_STEP;
      return `<rect x="${lx}" y="${ly - 9}" width="8" height="8" rx="2" fill="${corDaLinguagem(lang, i)}" /><text x="${lx + 16}" y="${ly}" class="label"><tspan fill="${FG}">${escapeXml(lang)}</tspan> ${pct}%</text>`;
    })
    .join("\n  ");

  const rows = Math.ceil(sorted.length / LEGEND_COLS);
  const height = LEGEND_TOP + (rows - 1) * LEGEND_STEP + 16;
  return card({
    title: "Most Used Languages",
    width: WIDTH,
    height,
    body: `${track}\n  ${segments}\n  ${legend}`,
  });
}

// ---- Quote of the day (day-of-year -> fixed quote, no randomness) ----

function dayOfYear(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const diff = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start;
  return Math.floor(diff / 86400000) + 1;
}

function wrapText(text, maxChars) {
  const words = text.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function loadQuotes() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const raw = await fs.readFile(path.join(dir, "quotes.json"), "utf8");
  return JSON.parse(raw);
}

function quoteCard(quote, dayNum, totalDays) {
  const lineHeight = 22;
  const linhas = wrapText(quote.text, 62);

  let y = 58;
  const corpo = linhas
    .map((linha) => {
      const t = `<text x="22" y="${y}" class="quote">${escapeXml(linha)}</text>`;
      y += lineHeight;
      return t;
    })
    .join("\n  ");

  const rodapeY = y + 8;
  const autor = `<text x="22" y="${rodapeY}" class="label">${escapeXml(quote.author || "Unknown")}</text>`;
  const dia = `<text x="${WIDTH - 22}" y="${rodapeY}" class="label" text-anchor="end">day ${dayNum} of ${totalDays}</text>`;

  return card({
    title: "Quote of the day",
    width: WIDTH,
    height: rodapeY + 18,
    body: `${corpo}\n  ${autor}\n  ${dia}`,
  });
}

async function main() {
  const repos = await fetchAllOwnedRepos();
  const languageTotals = await fetchLanguageBytes(repos);

  const fs = await import("node:fs/promises");
  await fs.mkdir("assets", { recursive: true });
  await fs.writeFile("assets/top-langs.svg", topLangsCard(languageTotals));

  const quotes = await loadQuotes();
  const doy = dayOfYear(new Date());
  const quote = quotes[(doy - 1) % quotes.length];
  await fs.writeFile("assets/quote.svg", quoteCard(quote, doy, quotes.length));

  console.log("Generated assets/top-langs.svg and assets/quote.svg");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
