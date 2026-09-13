import path from "node:path";

export const SOURCE_ROOT = process.cwd();
export const SITE_ROOT = path.resolve(SOURCE_ROOT, process.env.SITE_ROOT ?? "_site");
