# my_server

Several independent projects share this repository and its GitHub Pages site
(https://icyice1998.github.io/my_server/). Each one lives in its own folder, publishes under its own
path, and owns its own workflows, so they do not step on each other.

| Project | Folder | Page | Workflows |
|---|---|---|---|
| Market Analyzer: Thai / US stocks and funds, Elliott Wave, SMC, screener | [`market/`](market/README.md) | `/my_server/market/` | `market_analysis.yml`, `market_screener.yml` |

The root `index.html` is only a hub that links to each project's page (and forwards old Market Analyzer links).

## Adding a project without collisions

- Put everything (code, data, tests, `requirements.txt`, README) under one folder named after the project.
- Publish its web page as `<folder>/index.html`; add one entry to `PROJECTS` in the root `index.html`.
- Prefix workflow file names, `concurrency` groups and any issue-title triggers with the project name.
- Workflows that commit to `main` should `git add` only their own folder and retry with `git pull --rebase`.
