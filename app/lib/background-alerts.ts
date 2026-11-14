import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { db } from "./client";
import { expoProjectId, pollResidentAlerts } from "./push-notifications";

const TASK_NAME = "resident-phone-alerts";

TaskManager.defineTask(TASK_NAME, async () => {
  try {
    if (!db) return BackgroundTask.BackgroundTaskResult.Failed;
    if (expoProjectId()) return BackgroundTask.BackgroundTaskResult.Success;
    await pollResidentAlerts();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function syncResidentBackgroundAlerts(enabled: boolean) {
  if (Platform.OS === "web") return;
  if (expoProjectId()) enabled = false;
  const registered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
  if (!enabled || registered) {
    if (!enabled && registered) await BackgroundTask.unregisterTaskAsync(TASK_NAME);
    return;
  }
  if (await BackgroundTask.getStatusAsync() !== BackgroundTask.BackgroundTaskStatus.Available) return;
  await BackgroundTask.registerTaskAsync(TASK_NAME, { minimumInterval: 15 });
}
