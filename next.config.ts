import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // Since 16.3, `next dev` upserts a managed "agent rules" block into AGENTS.md whenever it detects an
  // AI coding agent (a Playwright run from Claude Code included). AGENTS.md is curated by hand here.
  agentRules: false,
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
