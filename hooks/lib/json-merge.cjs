const fs = require("fs");
const file = process.argv[2];
const key = process.argv[3];
const value = process.argv[4];
try {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  data[key] = value;
  fs.writeFileSync(file, JSON.stringify(data));
} catch {
  /* best-effort */
}
