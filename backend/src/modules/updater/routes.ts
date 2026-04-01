import { Router, Request, Response } from "express";
import { execSync, spawn } from "child_process";

const router = Router();
const REPO_DIR = "/opt/serverless";

// ─── Check for updates ─────────────────────────────────────

router.get("/check", async (_req: Request, res: Response) => {
  try {
    // Check if repo dir exists
    execSync(`test -d "${REPO_DIR}/.git"`, { stdio: "pipe" });

    execSync("git fetch origin", { cwd: REPO_DIR, timeout: 15000, stdio: "pipe" });
    const local = execSync("git rev-parse HEAD", { cwd: REPO_DIR, stdio: "pipe" }).toString().trim();
    const remote = execSync("git rev-parse FETCH_HEAD", { cwd: REPO_DIR, stdio: "pipe" }).toString().trim();

    if (local === remote) {
      return res.json({ updateAvailable: false, current: local.slice(0, 7) });
    }

    const behindOutput = execSync(`git rev-list --count HEAD..FETCH_HEAD`, { cwd: REPO_DIR, stdio: "pipe" }).toString().trim();
    const commits = parseInt(behindOutput, 10) || 0;

    if (commits === 0) {
      return res.json({ updateAvailable: false, current: local.slice(0, 7) });
    }

    res.json({
      updateAvailable: true,
      current: local.slice(0, 7),
      latest: remote.slice(0, 7),
      commits,
    });
  } catch {
    // Not a git repo or git not available (dev env) — no update check
    res.json({ updateAvailable: false });
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
