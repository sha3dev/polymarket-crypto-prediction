/**
 * @section imports:externals
 */

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

/**
 * @section consts
 */

const EXEC_FILE_ASYNC = promisify(execFile);

/**
 * @section types
 */

type CommandOutput = {
  stdout: string;
  stderr: string;
};

type CommandRunner = (command: string, args: string[], cwd: string) => Promise<CommandOutput>;
type RestartLauncher = (pm2AppName: string, repositoryRoot: string) => Promise<void>;

/**
 * @section class
 */

export class UpdateService {
  /**
   * @section private:attributes
   */

  private readonly repositoryRoot: string;
  private readonly pm2AppName: string;
  private readonly commandRunner: CommandRunner;
  private readonly restartLauncher: RestartLauncher;

  /**
   * @section constructor
   */

  public constructor(
    repositoryRoot: string,
    pm2AppName: string,
    commandRunner: CommandRunner = async (command: string, args: string[], cwd: string): Promise<CommandOutput> => {
      const commandOutput = await EXEC_FILE_ASYNC(command, args, { cwd });
      return {
        stdout: commandOutput.stdout ?? "",
        stderr: commandOutput.stderr ?? "",
      };
    },
    restartLauncher: RestartLauncher = async (nextPm2AppName: string, cwd: string): Promise<void> => {
      const launchResult = await new Promise<void>((resolveRestart, rejectRestart) => {
        const restartProcess = spawn("pm2", ["restart", nextPm2AppName], {
          cwd,
          detached: true,
          stdio: "ignore",
        });
        restartProcess.once("error", (error) => {
          rejectRestart(error);
        });
        restartProcess.once("spawn", () => {
          restartProcess.unref();
          resolveRestart();
        });
      });
      return launchResult;
    },
  ) {
    this.repositoryRoot = repositoryRoot;
    this.pm2AppName = pm2AppName;
    this.commandRunner = commandRunner;
    this.restartLauncher = restartLauncher;
  }

  /**
   * @section public:methods
   */

  public async runUpdate(): Promise<{
    ok: boolean;
    repositoryRoot: string;
    pm2AppName: string;
    gitStdout: string;
    gitStderr: string;
    message: string;
  }> {
    const gitOutput = await this.commandRunner("git", ["pull"], this.repositoryRoot);
    await this.restartLauncher(this.pm2AppName, this.repositoryRoot);
    return {
      ok: true,
      repositoryRoot: this.repositoryRoot,
      pm2AppName: this.pm2AppName,
      gitStdout: gitOutput.stdout,
      gitStderr: gitOutput.stderr,
      message: "Update started. PM2 restart has been requested.",
    };
  }
}
