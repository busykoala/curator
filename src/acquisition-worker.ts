import { startAcquisitionController } from "@/features/acquisition/controller";

console.log("Curator acquisition controller starting");
startAcquisitionController();
process.on("unhandledRejection",(error)=>console.error("Acquisition controller rejection",error));
process.on("uncaughtException",(error)=>{console.error("Acquisition controller exception",error);process.exit(1)});
