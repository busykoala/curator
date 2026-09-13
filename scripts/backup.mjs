import Database from "better-sqlite3";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync, statSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
const source=process.env.CURATOR_DB_PATH??"/app/data/curator.sqlite",directory=process.env.CURATOR_BACKUP_DIR??"/backups/curator",secret=process.env.CURATOR_CREDENTIAL_KEY;
if(!secret||secret.length<32)throw new Error("CURATOR_CREDENTIAL_KEY is required for encrypted backups");
mkdirSync(directory,{recursive:true});const stamp=new Date().toISOString().replace(/[:.]/g,"-"),plain=join(directory,`.curator-${stamp}.sqlite`),target=join(directory,`curator-${stamp}.sqlite.aes`),database=new Database(source,{readonly:true});
await database.backup(plain);database.close();const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",createHash("sha256").update(secret).digest(),iv),output=createWriteStream(target,{mode:0o600});output.write(Buffer.from("CURATOR1"));output.write(iv);await pipeline(createReadStream(plain),cipher,output);const tagged=createWriteStream(`${target}.tag`,{mode:0o600});tagged.end(cipher.getAuthTag());await new Promise((resolve,reject)=>tagged.on("finish",resolve).on("error",reject));unlinkSync(plain);console.log(JSON.stringify({event:"curator_backup_complete",file:basename(target),bytes:statSync(target).size}));
