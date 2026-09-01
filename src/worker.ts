import { startScheduler } from "@/features/scheduler/run";

console.log("Curator worker starting");
startScheduler();
process.on("unhandledRejection", (error) => console.error("Worker rejection", error));
process.on("uncaughtException", (error) => { console.error("Worker exception", error); process.exit(1); });
