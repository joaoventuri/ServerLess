import { Router, Request, Response } from "express";
import { execSync, spawn } from "child_process";

const router = Router();
const REPO_DIR = "/opt/serverless";

// ─── Check for updates ─────────────────────────────────────

router.get("/check", async (_req: Request, res: Response) => {
  try {
    execSync("git fetch origin master", { cwd: REPO_DIR, timeout: 15000, stdio: "pipe" });
    const local = execSync("git rev-parse HEAD", { cwd: REPO_DIR, stdio: "pipe" }).toString().trim();
    const remote = execSync("git rev-parse origin/master", { cwd: REPO_DIR, stdio: "pipe" }).toString().trim();

    if (local === remote) {
      return res.json({ updateAvailable: false, current: local.slice(0, 7) });
    }

    // Get commit summary for what's new
    const log = execSync(`git log --oneline ${local}..${remote}`, { cwd: REPO_DIR, stdio: "pipe" }).toString().trim();
    const commits = log.split("\n").filter(Boolean).length;

    res.json({
      updateAvailable: true,
      current: local.slice(0, 7),
      latest: remote.slice(0, 7),
      commits,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Trigger update ─────────────────────────────────────────

router.post("/apply", async (_req: Request, res: Response) => {
  // Respond immediately, then run update in background
  res.json({ success: true, message: "Update started" });

  // Run auto-update.sh detached so the server restart doesn't kill the response
  const child = spawn("bash", [`${REPO_DIR}/auto-update.sh`], {
    cwd: REPO_DIR,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
});

export default router;
