import cron, { type ScheduledTask } from "node-cron";
import { getAllUsers } from "./users.js";
import { triggerCall } from "./twilio.js";

const jobs: Map<string, ScheduledTask> = new Map();

function timeToCron(time: string): string {
  const [hour, minute] = time.split(":");
  return `${minute} ${hour} * * *`;
}

export function startScheduler(): void {
  stopScheduler();

  const users = getAllUsers();

  for (const user of users) {
    const cronExpr = timeToCron(user.callTime);

    const job = cron.schedule(
      cronExpr,
      async () => {
        console.log(`Scheduled call triggering for ${user.id}`);
        try {
          await triggerCall(user.id);
        } catch (err) {
          console.error(`Scheduled call failed for ${user.id}:`, err);
        }
      },
      { timezone: user.timezone }
    );

    jobs.set(user.id, job);
    console.log(
      `Scheduled: ${user.id} at ${user.callTime} ${user.timezone} (${cronExpr})`
    );
  }

  if (users.length === 0) {
    console.warn("No enabled users found. No calls scheduled.");
  }
}

export function stopScheduler(): void {
  for (const [id, job] of jobs) {
    job.stop();
    console.log(`Stopped schedule for ${id}`);
  }
  jobs.clear();
}
