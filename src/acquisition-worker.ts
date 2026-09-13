import { startAcquisitionController } from "@/features/acquisition/controller";

console.log(JSON.stringify({event:"worker_start",component:"acquisition",at:new Date().toISOString()}));
startAcquisitionController();
process.on("unhandledRejection",(error)=>console.error(JSON.stringify({event:"worker_rejection",component:"acquisition",error:String(error)})));
process.on("uncaughtException",(error)=>{console.error(JSON.stringify({event:"worker_exception",component:"acquisition",error:String(error)}));process.exit(1)});
