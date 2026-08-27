#!/usr/bin/env node
// Generates self-hosted stats/top-languages/streak/terminal SVG cards for the
// profile README, replacing the flaky github-readme-stats.vercel.app service.
// Runs on GitHub Actions with the default GITHUB_TOKEN — no PAT needed.
//
// Single fixed black + green palette everywhere (no light/dark variants) —
// the whole README is meant to read as one minimalist black/green design.

const USERNAME = process.env.PROFILE_USER || "lucianookdp";
const TOKEN = process.env.GITHUB_TOKEN;

const ACCENT = "#1e8e56";
const BG = "#0c0c0c";
const BORDER = "#2b2b2b";
const FG = "#e6e6e6";
const MUTED = "#8a8a8a";
const TRACK = "#1f1f1f";

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

function card({ title, width, height, body }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="'Cascadia Code', 'Fira Code', Consolas, monospace">
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="${BG}" stroke="${BORDER}" />
  <style>
    .title { font-size: 15px; font-weight: 600; fill: ${ACCENT}; }
    .label { font-size: 12px; fill: ${MUTED}; }
    .value { font-size: 12px; font-weight: 600; fill: ${FG}; }
  </style>
  <text x="20" y="28" class="title">${escapeXml(title)}</text>
  ${body}
</svg>`;
}

function statsCard({ repos, stars, followers, contributions }) {
  const rows = [
    ["Total repositories", repos],
    ["Total stars", stars],
    ["Followers", followers],
    ["Contributions", contributions],
  ];
  const body = rows
    .map(([label, value], i) => {
      const y = 56 + i * 26;
      return `<text x="20" y="${y}" class="label">${escapeXml(label)}</text><text x="335" y="${y}" text-anchor="end" class="value">${escapeXml(value)}</text>`;
    })
    .join("\n  ");
  return card({ title: "GitHub Stats", width: 355, height: 56 + rows.length * 26 - 4, body });
}

function topLangsCard(totals) {
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const total = sorted.reduce((sum, [, bytes]) => sum + bytes, 0);
  const palette = ["#1e8e56", "#3fb27f", "#6fcf9e", "#a3e0bf", FG, MUTED];

  const barWidth = 315;
  let track = `<rect x="20" y="48" width="${barWidth}" height="8" rx="4" fill="${TRACK}" />`;
  let x = 20;
  const segments = sorted
    .map(([lang, bytes], i) => {
      const w = total > 0 ? (bytes / total) * barWidth : 0;
      const rect = `<rect x="${x}" y="48" width="${w}" height="8" fill="${palette[i % palette.length]}" />`;
      x += w;
      return rect;
    })
    .join("\n  ");

  const legend = sorted
    .map(([lang, bytes], i) => {
      const pct = total > 0 ? ((bytes / total) * 100).toFixed(1) : "0.0";
      const col = i % 2;
      const row = Math.floor(i / 2);
      const lx = 20 + col * 170;
      const ly = 80 + row * 22;
      return `<circle cx="${lx}" cy="${ly - 4}" r="5" fill="${palette[i % palette.length]}" /><text x="${lx + 12}" y="${ly}" class="label">${escapeXml(lang)} <tspan fill="${MUTED}">${pct}%</tspan></text>`;
    })
    .join("\n  ");

  const rows = Math.ceil(sorted.length / 2);
  const height = 80 + rows * 22 - 6;
  const body = `${track}\n  ${segments}\n  ${legend}`;
  return card({ title: "Most Used Languages", width: 355, height, body });
}

function streakCard({ current, longest }) {
  const cols = [
    ["Current streak", current],
    ["Longest streak", longest],
  ];
  const colWidth = 355 / cols.length;
  const body = cols
    .map(([label, value], i) => {
      const cx = colWidth * i + colWidth / 2;
      return `<text x="${cx}" y="60" text-anchor="middle" class="value" font-size="20" fill="${FG}">${escapeXml(value)}</text><text x="${cx}" y="80" text-anchor="middle" class="label">${escapeXml(label)}</text>`;
    })
    .join("\n  ");
  return card({ title: "Contribution Streak", width: 355, height: 96, body });
}

// ---- Windows Terminal (PowerShell) card ----

const CHAR_W = 8.3; // approx monospace advance at font-size 13 (generous for font fallback)
const PX_PER_SEC = 320; // typing speed
const CLIP_PAD = 30; // safety margin so the last glyph never gets clipped
const PROMPT_STR = "PS C:\\Users\\luciano>";

function windowsChrome({ width, titleText }) {
  return `
    <rect x="0.5" y="0.5" width="${width - 1}" height="31" rx="8" fill="${TRACK}" />
    <rect x="0.5" y="23" width="${width - 1}" height="8" fill="${TRACK}" />
    <rect x="16" y="11" width="5" height="5" fill="${ACCENT}" />
    <rect x="23" y="11" width="5" height="5" fill="${MUTED}" />
    <rect x="16" y="18" width="5" height="5" fill="${MUTED}" />
    <rect x="23" y="18" width="5" height="5" fill="${ACCENT}" />
    <text x="38" y="21" font-size="12" fill="${FG}">${escapeXml(titleText)}</text>
    <line x1="${width - 62}" y1="16" x2="${width - 51}" y2="16" stroke="${MUTED}" stroke-width="1.2" />
    <rect x="${width - 40}" y="10" width="11" height="11" fill="none" stroke="${MUTED}" stroke-width="1.2" />
    <line x1="${width - 24}" y1="10" x2="${width - 13}" y2="21" stroke="${MUTED}" stroke-width="1.2" />
    <line x1="${width - 13}" y1="10" x2="${width - 24}" y2="21" stroke="${MUTED}" stroke-width="1.2" />`;
}

// Builds the SMIL clip-path chain that reveals each line of `lineDefs`
// (each { y, width, render }) one after another, like it's being typed.
function buildTypedLines(lineDefs) {
  let prevId = "winIn";
  const clipDefs = [];
  const rendered = [];
  let lastId = prevId;
  lineDefs.forEach((line, i) => {
    const id = `rev${i}`;
    const dur = Math.max(0.18, line.width / PX_PER_SEC).toFixed(2);
    clipDefs.push(`<clipPath id="clip${i}"><rect x="0" y="${line.y - 15}" width="0" height="19">
      <animate id="${id}" attributeName="width" from="0" to="${line.width.toFixed(0)}" dur="${dur}s" begin="${prevId}.end" fill="freeze" calcMode="linear" />
    </rect></clipPath>`);
    rendered.push(`<g clip-path="url(#clip${i})">${line.render}</g>`);
    prevId = id;
    lastId = id;
  });
  return { clipDefs, rendered, lastId };
}

function blinkCursor(x, y, lastId) {
  return `<rect x="${x.toFixed(0)}" y="${y - 12}" width="7" height="14" fill="${ACCENT}" opacity="0">
    <animate attributeName="opacity" values="1;0" calcMode="discrete" dur="1s" begin="${lastId}.end" repeatCount="indefinite" />
  </rect>`;
}

function terminalCard(topLanguage) {
  const width = 400;
  const lineHeight = 22;
  const fields = [
    ["os", "Windows 11"],
    ["shell", "PowerShell 7"],
    ["editor", "VS Code"],
    ["top_lang", topLanguage],
  ];

  let y = 58;
  const lineDefs = [];

  const cmd1 = `${PROMPT_STR} whoami`;
  lineDefs.push({
    y,
    width: cmd1.length * CHAR_W + CLIP_PAD,
    render: `<text x="16" y="${y}" font-size="13"><tspan fill="${ACCENT}">${escapeXml(PROMPT_STR)}</tspan><tspan fill="${FG}"> whoami</tspan></text>`,
  });
  y += lineHeight;

  fields.forEach(([key, value]) => {
    lineDefs.push({
      y,
      width: 130 + String(value).length * CHAR_W + CLIP_PAD,
      render: `<text x="16" y="${y}" font-size="13"><tspan fill="${ACCENT}">${escapeXml(key)}</tspan><tspan fill="${MUTED}">:</tspan><tspan fill="${FG}" x="130">${escapeXml(value)}</tspan></text>`,
    });
    y += lineHeight;
  });

  const height = y + 18;
  const { clipDefs, rendered, lastId } = buildTypedLines(lineDefs);
  const last = lineDefs[lineDefs.length - 1];
  const cursor = blinkCursor(16 + last.width - CLIP_PAD + 6, last.y, lastId);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="'Cascadia Code', 'Fira Code', Consolas, monospace">
  <defs>
    ${clipDefs.join("\n    ")}
  </defs>
  <g opacity="0">
    <animate id="winIn" attributeName="opacity" from="0" to="1" dur="0.35s" begin="0s" fill="freeze" />
    <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="8" fill="${BG}" stroke="${BORDER}" />
    ${windowsChrome({ width, titleText: "Windows PowerShell" })}
  </g>
  ${rendered.join("\n  ")}
  ${cursor}
</svg>`;
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
  const width = 520;
  const lineHeight = 22;
  const maxChars = 56;

  let y = 58;
  const lineDefs = [];

  const cmd = `${PROMPT_STR} Get-Quote`;
  lineDefs.push({
    y,
    width: cmd.length * CHAR_W + CLIP_PAD,
    render: `<text x="16" y="${y}" font-size="13"><tspan fill="${ACCENT}">${escapeXml(PROMPT_STR)}</tspan><tspan fill="${FG}"> Get-Quote</tspan></text>`,
  });
  y += lineHeight * 1.4;

  const quoteLines = wrapText(`"${quote.text}"`, maxChars);
  quoteLines.forEach((line) => {
    lineDefs.push({
      y,
      width: line.length * CHAR_W + CLIP_PAD,
      render: `<text x="16" y="${y}" font-size="13" fill="${FG}">${escapeXml(line)}</text>`,
    });
    y += lineHeight;
  });

  const authorLine = `— ${quote.author}`;
  lineDefs.push({
    y,
    width: authorLine.length * CHAR_W + CLIP_PAD,
    render: `<text x="16" y="${y}" font-size="13" fill="${ACCENT}">${escapeXml(authorLine)}</text>`,
  });
  y += lineHeight * 1.4;

  const dayLine = `Day ${dayNum} of ${totalDays}`;
  lineDefs.push({
    y,
    width: dayLine.length * CHAR_W + CLIP_PAD,
    render: `<text x="16" y="${y}" font-size="12" fill="${MUTED}">${escapeXml(dayLine)}</text>`,
  });
  y += lineHeight;

  const height = y + 18;
  const { clipDefs, rendered, lastId } = buildTypedLines(lineDefs);
  const last = lineDefs[lineDefs.length - 1];
  const cursor = blinkCursor(16 + last.width - CLIP_PAD + 6, last.y, lastId);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="'Cascadia Code', 'Fira Code', Consolas, monospace">
  <defs>
    ${clipDefs.join("\n    ")}
  </defs>
  <g opacity="0">
    <animate id="winIn" attributeName="opacity" from="0" to="1" dur="0.35s" begin="0s" fill="freeze" />
    <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="8" fill="${BG}" stroke="${BORDER}" />
    ${windowsChrome({ width, titleText: "Windows PowerShell" })}
  </g>
  ${rendered.join("\n  ")}
  ${cursor}
</svg>`;
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

  await fs.writeFile("assets/stats.svg", statsCard(statsData));
  await fs.writeFile("assets/top-langs.svg", topLangsCard(languageTotals));
  await fs.writeFile("assets/streak.svg", streakCard(streakData));

  const [topLanguage] = [...languageTotals.entries()].sort((a, b) => b[1] - a[1])[0] || ["N/A"];
  await fs.writeFile("assets/terminal.svg", terminalCard(topLanguage));

  const quotes = await loadQuotes();
  const now = new Date();
  const doy = dayOfYear(now);
  const quote = quotes[(doy - 1) % quotes.length];
  await fs.writeFile("assets/quote.svg", quoteCard(quote, doy, quotes.length));

  console.log(
    "Generated assets/stats.svg, assets/top-langs.svg, assets/streak.svg, assets/terminal.svg, assets/quote.svg"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
