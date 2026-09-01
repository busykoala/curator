import { scanLibrary } from "@/features/scanner/scan";
import { processAlbums } from "@/features/scheduler/process";
console.log("Scanning copied sample library",await scanLibrary());
console.log("Processing copied sample library",await processAlbums(20));
