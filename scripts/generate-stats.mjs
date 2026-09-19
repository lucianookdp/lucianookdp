#!/usr/bin/env node
// Generates self-hosted stats, top-languages, streak and quote SVG cards for
// the profile README, replacing the flaky github-readme-stats.vercel.app
// service. Runs on GitHub Actions with the default GITHUB_TOKEN, no PAT needed.
//
// One fixed dark palette for the card chrome, the same tones GitHub uses, so
// the cards sit well on both the light and the dark theme. The chrome itself
// carries no accent colour; the only colour on a card is the language bar,
// drawn in each language's own brand tone.

const USERNAME = process.env.PROFILE_USER || "lucianookdp";
const TOKEN = process.env.GITHUB_TOKEN;

const BG = "#0d1117";
const BORDER = "#22272e";
const RULE = "#1b2026";
const FG = "#e6edf3";
const MUTED = "#8b949e";
const DIM = "#6e7681";
const TRACK = "#21262d";

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Two cards side by side, then the full-width ones underneath.
const HALF = 355;
const FULL = 730;

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

async function graphql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL -> ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
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

async function fetchContributionCalendar() {
  const data = await graphql(
    `query($login: String!) {
      user(login: $login) {
        followers { totalCount }
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks { contributionDays { contributionCount date } }
          }
        }
      }
    }`,
    { login: USERNAME }
  );
  const days = data.user.contributionsCollection.contributionCalendar.weeks.flatMap(
    (w) => w.contributionDays
  );
  return {
    followers: data.user.followers.totalCount,
    totalContributions:
      data.user.contributionsCollection.contributionCalendar.totalContributions,
    days,
  };
}

function computeStreaks(days) {
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : 1));
  let longest = 0;
  let run = 0;
  for (const day of sorted) {
    if (day.contributionCount > 0) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }

  let current = 0;
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const isToday = i === sorted.length - 1;
    if (sorted[i].contributionCount > 0) {
      current += 1;
    } else if (isToday) {
      continue; // today may not have contributions yet, don't break the streak
    } else {
      break;
    }
  }
  return { current, longest };
}

function escapeXml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// The title is a small uppercase eyebrow rather than a coloured heading;
// `text-transform` is unreliable in SVG, so the case is applied here.
function card({ title, width, height, body }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}">
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="12" fill="${BG}" stroke="${BORDER}" />
  <style>
    .eyebrow { font-size: 11px; font-weight: 600; letter-spacing: 1.3px; fill: ${DIM}; }
    .label { font-size: 12.5px; fill: ${MUTED}; }
    .value { font-size: 12.5px; font-weight: 600; fill: ${FG}; }
    .metric { font-size: 22px; font-weight: 600; fill: ${FG}; }
    .quote { font-size: 14px; font-weight: 400; fill: ${FG}; }
    .rule { stroke: ${RULE}; stroke-width: 1; }
  </style>
  <text x="22" y="30" class="eyebrow">${escapeXml(title.toUpperCase())}</text>
  ${body}
</svg>`;
}

const ROW_TOP = 64;
const ROW_STEP = 27;

function statsCardHeight() {
  return ROW_TOP + 3 * ROW_STEP + 18;
}

// `minHeight` lets this be matched to topLangsCard's height so the two
// sit flush when GitHub places them side by side (GitHub strips inline
// `style="vertical-align"`, so equal SVG heights is the only reliable fix).
function statsCard({ repos, stars, followers, contributions }, minHeight) {
  const rows = [
    ["Repositories", repos],
    ["Stars", stars],
    ["Followers", followers],
    ["Contributions (last year)", contributions],
  ];
  const body = rows
    .map(([label, value], i) => {
      const y = ROW_TOP + i * ROW_STEP;
      const rule =
        i === 0
          ? ""
          : `<line x1="22" x2="${HALF - 22}" y1="${y - 18}" y2="${y - 18}" class="rule" />`;
      return `${rule}<text x="22" y="${y}" class="label">${escapeXml(label)}</text><text x="${HALF - 22}" y="${y}" text-anchor="end" class="value">${escapeXml(value)}</text>`;
    })
    .join("\n  ");
  const height = Math.max(statsCardHeight(), minHeight || 0);
  return card({ title: "GitHub", width: HALF, height, body });
}

const LEGEND_TOP = 86;
const LEGEND_STEP = 24;

function topLangsCardHeight(totals) {
  const rows = Math.ceil(Math.min(totals.size, 6) / 2);
  return LEGEND_TOP + (rows - 1) * LEGEND_STEP + 14;
}

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

function topLangsCard(totals, minHeight) {
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const total = sorted.reduce((sum, [, bytes]) => sum + bytes, 0);

  const barWidth = HALF - 44;
  const track = `<rect x="22" y="52" width="${barWidth}" height="8" rx="4" fill="${TRACK}" />`;
  let x = 22;
  const segments = sorted
    .map(([lang, bytes], i) => {
      const w = total > 0 ? Number(((bytes / total) * barWidth).toFixed(2)) : 0;
      const rect = `<rect x="${Number(x.toFixed(2))}" y="52" width="${w}" height="8" fill="${corDaLinguagem(lang, i)}" />`;
      x += w;
      return rect;
    })
    .join("\n  ");

  const legend = sorted
    .map(([lang, bytes], i) => {
      const pct = total > 0 ? ((bytes / total) * 100).toFixed(1) : "0.0";
      const col = i % 2;
      const row = Math.floor(i / 2);
      const lx = 22 + col * 166;
      const ly = LEGEND_TOP + row * LEGEND_STEP;
      return `<rect x="${lx}" y="${ly - 9}" width="8" height="8" rx="2" fill="${corDaLinguagem(lang, i)}" /><text x="${lx + 16}" y="${ly}" class="label"><tspan fill="${FG}">${escapeXml(lang)}</tspan> ${pct}%</text>`;
    })
    .join("\n  ");

  const height = Math.max(topLangsCardHeight(totals), minHeight || 0);
  const body = `${track}\n  ${segments}\n  ${legend}`;
  return card({ title: "Languages", width: HALF, height, body });
}

function streakCard({ current, longest }) {
  const cols = [
    ["Current streak", current],
    ["Longest streak", longest],
  ];
  const colWidth = FULL / cols.length;
  const divider = `<line x1="${colWidth}" x2="${colWidth}" y1="50" y2="98" class="rule" />`;
  const body = cols
    .map(([label, value], i) => {
      const cx = colWidth * i + colWidth / 2;
      return `<text x="${cx}" y="76" text-anchor="middle" class="metric">${escapeXml(value)}</text><text x="${cx}" y="96" text-anchor="middle" class="label">${escapeXml(label)}</text>`;
    })
    .join("\n  ");
  return card({
    title: "Contribution streak",
    width: FULL,
    height: 116,
    body: `${divider}\n  ${body}`,
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
  const width = FULL;
  const lineHeight = 24;
  const linhas = wrapText(quote.text, 84);

  let y = 62;
  const corpo = linhas
    .map((linha) => {
      const t = `<text x="22" y="${y}" class="quote">${escapeXml(linha)}</text>`;
      y += lineHeight;
      return t;
    })
    .join("\n  ");

  const rodapeY = y + 10;
  const autor = `<text x="22" y="${rodapeY}" class="label">${escapeXml(quote.author || "Unknown")}</text>`;
  const dia = `<text x="${width - 22}" y="${rodapeY}" class="label" text-anchor="end">day ${dayNum} of ${totalDays}</text>`;
  const height = rodapeY + 20;

  return card({
    title: "Quote of the day",
    width,
    height,
    body: `${corpo}\n  ${autor}\n  ${dia}`,
  });
}

async function main() {
  const repos = await fetchAllOwnedRepos();
  const stars = repos.reduce((sum, r) => sum + r.stargazers_count, 0);
  const languageTotals = await fetchLanguageBytes(repos);
  const { followers, totalContributions, days } = await fetchContributionCalendar();
  const { current, longest } = computeStreaks(days);

  const fs = await import("node:fs/promises");
  await fs.mkdir("assets", { recursive: true });

  const statsData = { repos: repos.length, stars, followers, contributions: totalContributions };
  const streakData = { current, longest };

  const matchedHeight = Math.max(statsCardHeight(), topLangsCardHeight(languageTotals));
  await fs.writeFile("assets/stats.svg", statsCard(statsData, matchedHeight));
  await fs.writeFile("assets/top-langs.svg", topLangsCard(languageTotals, matchedHeight));
  await fs.writeFile("assets/streak.svg", streakCard(streakData));

  const quotes = await loadQuotes();
  const now = new Date();
  const doy = dayOfYear(now);
  const quote = quotes[(doy - 1) % quotes.length];
  await fs.writeFile("assets/quote.svg", quoteCard(quote, doy, quotes.length));

  console.log(
    "Generated assets/stats.svg, assets/top-langs.svg, assets/streak.svg, assets/quote.svg"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
