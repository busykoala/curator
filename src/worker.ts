import { startScheduler } from "@/features/scheduler/run";

console.log(JSON.stringify({event:"worker_start",component:"curator",at:new Date().toISOString()}));
startScheduler();
process.on("unhandledRejection", (error) => console.error(JSON.stringify({event:"worker_rejection",error:String(error)})));
process.on("uncaughtException", (error) => { console.error(JSON.stringify({event:"worker_exception",error:String(error)})); process.exit(1); });
