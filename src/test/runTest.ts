import * as os from "os";
import * as path from "path";
import { runTests } from "@vscode/test-electron";

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, "../../");

    const extensionTestsPath = path.resolve(__dirname, "./suite/index");

    // VS Code's singleton-instance IPC socket lives under --user-data-dir,
    // and Unix domain socket paths are capped at ~103 chars on macOS/Linux.
    // The default user-data-dir (<repo>/.vscode-test/user-data) is fine
    // locally, but GitHub Actions checks out to a long, doubled-up path
    // (/Users/runner/work/<repo>/<repo>/...) that overflows the limit and
    // fails with `listen EINVAL`. Use a short OS temp dir instead.
    const userDataDir = path.join(os.tmpdir(), "playbook-vscode-test-user-data");

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [`--user-data-dir=${userDataDir}`],
    });
  } catch (err) {
    console.error("Failed to run tests");
    process.exit(1);
  }
}

main();
