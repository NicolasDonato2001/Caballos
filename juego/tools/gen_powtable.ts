// Genera src/sim/powtable.ts: tabla de E^exp para E en [0,1] (1024 tramos).
// Se ejecuta UNA vez; los valores quedan escritos como literales, así el simulador
// no depende de Math.pow (cuyo resultado puede variar entre motores JS).
import { writeFileSync } from "node:fs";
const exp = Number(process.argv[2] ?? "1.7");
const N = 1024;
const vals: string[] = [];
for (let i = 0; i <= N; i++) vals.push(Math.pow(i / N, exp).toPrecision(17));
const src = `// GENERADO por tools/gen_powtable.ts — no editar a mano.\nexport const POW_EXP = ${exp};\nexport const POW_N = ${N};\nexport const POW_TABLE: readonly number[] = [${vals.join(",")}];\n`;
writeFileSync(new URL("../src/sim/powtable.ts", import.meta.url), src);
console.log("powtable ok", exp, N);
