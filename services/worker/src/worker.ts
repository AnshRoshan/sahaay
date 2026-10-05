import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities";

const connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233" });
const worker = await Worker.create({
  connection,
  namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
  taskQueue: "sahaay",
  workflowsPath: new URL("./workflows.ts", import.meta.url).pathname,
  activities,
});
console.log("Sahaay Temporal worker running on task queue 'sahaay'");
await worker.run();
