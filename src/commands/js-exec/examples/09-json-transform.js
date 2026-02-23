// Read a JSON file, transform the data, and write multiple output files
const fs = require("node:fs");
const path = require("node:path");

// Fetch a rich dataset
const res = await fetch("https://jsonplaceholder.typicode.com/users");
const users = await res.json();

// Create output directory
fs.mkdirSync("/tmp/output", { recursive: true });

// 1. Write a contacts file (name + email only)
var contacts = users.map((u) => ({
  name: u.name,
  email: u.email,
  phone: u.phone,
}));
fs.writeFileSync(
  "/tmp/output/contacts.json",
  JSON.stringify(contacts, null, 2),
);

// 2. Write a geo file (name + coordinates)
var geo = users.map((u) => ({
  name: u.name,
  city: u.address.city,
  lat: u.address.geo.lat,
  lng: u.address.geo.lng,
}));
fs.writeFileSync("/tmp/output/geo.json", JSON.stringify(geo, null, 2));

// 3. Write a companies file grouped by company
var companies = {};
for (let i = 0; i < users.length; i++) {
  const u = users[i];
  const companyName = u.company.name;
  if (!companies[companyName]) {
    companies[companyName] = {
      name: companyName,
      catchPhrase: u.company.catchPhrase,
      employees: [],
    };
  }
  companies[companyName].employees.push(u.name);
}
var companyList = Object.keys(companies).map((k) => companies[k]);
fs.writeFileSync(
  "/tmp/output/companies.json",
  JSON.stringify(companyList, null, 2),
);

// 4. Write an index listing all generated files
var generated = fs.readdirSync("/tmp/output");
var index = generated.map((f) => {
  var stat = fs.statSync(path.join("/tmp/output", f));
  return { file: f, size: stat.size };
});
fs.writeFileSync("/tmp/output/index.json", JSON.stringify(index, null, 2));

console.log("Generated", generated.length, "files in /tmp/output/");
for (let j = 0; j < index.length; j++) {
  console.log(" ", index[j].file, `(${index[j].size} bytes)`);
}
