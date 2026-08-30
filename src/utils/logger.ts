import chalk from "chalk";

type Level = "info" | "success" | "warn" | "error" | "step" | "gate";

function timestamp(): string {
  return new Date().toISOString().replace("T", " ").substring(0, 19);
}

function log(level: Level, stage: string, msg: string): void {
  const ts = chalk.gray(`[${timestamp()}]`);
  const stageTag = chalk.cyan(`[${stage}]`);

  switch (level) {
    case "info":    console.log(`${ts} ${stageTag} ${msg}`); break;
    case "success": console.log(`${ts} ${stageTag} ${chalk.green("✓")} ${msg}`); break;
    case "warn":    console.warn(`${ts} ${stageTag} ${chalk.yellow("⚠")} ${msg}`); break;
    case "error":   console.error(`${ts} ${stageTag} ${chalk.red("✗")} ${msg}`); break;
    case "step":    console.log(`${ts} ${stageTag} ${chalk.blue("→")} ${msg}`); break;
    case "gate":    console.log(`\n${ts} ${stageTag} ${chalk.magenta("⏸  APPROVAL GATE:")} ${msg}\n`); break;
  }
}

export const logger = {
  info:    (stage: string, msg: string) => log("info",    stage, msg),
  success: (stage: string, msg: string) => log("success", stage, msg),
  warn:    (stage: string, msg: string) => log("warn",    stage, msg),
  error:   (stage: string, msg: string) => log("error",   stage, msg),
  step:    (stage: string, msg: string) => log("step",    stage, msg),
  gate:    (stage: string, msg: string) => log("gate",    stage, msg),
};
