const fs = require("fs");
const file = process.argv[2];
const field = process.argv[3];
try {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  process.stdout.write(String(data[field] || ""));
} catch {
  process.stdout.write("");
}
