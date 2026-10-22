// const http = require("http");
// const url = require("url");


// // not using express js  

// const server = http.createServer((req, res) => {
//   if (req.url === "/favicon.ico") return res.end();
//   const myurl = url.parse(req.url, true);

//   switch (myurl.pathname) {
//     case "/":
//       res.end("Welcome shikhar coder");
//       break;
      
//       case "/about":
//         res.end(`$hello bri{username}`);
//         break;
//     default:
//       res.end("404 Not Found");
//   }
// });

// server.listen(8000, () => console.log("server started"));
//  this above code is not full so reriting code
const http = require("http");
const fs = require("fs");
const url = require("url");

const server = http.createServer((req, res) => {
  if (req.url === "/favicon.ico") return res.end();
  const myurl = url.parse(req.url, true);

  const log = `${new Date().toLocaleString()} ${req.method} ${req.url}\n`;

  fs.appendFile("log.txt", log, () => {
    switch (myurl.pathname) {
      case "/":
        res.end("Welcome");
        break;

      case "/about": {
        const username = myurl.query.name;
        if (!username) {
          res.end("Please give a name");
        } else {
          res.end(`Hello bro ${username}`);
        }
        break;
      }

      case "/time":
        res.end(new Date().toLocaleString());
        break;

      case "/add": {
        const a = Number(myurl.query.a);
        const b = Number(myurl.query.b);
        if (isNaN(a) || isNaN(b)) {
          res.end("Please give numbers a and b");
        } else {
          res.end(`Sum = ${a + b}`);
        }
        break;
      }
      
      
      
      case "/multiply": {
  const a = Number(myurl.query.a);
  const b = Number(myurl.query.b);
  if (isNaN(a) || isNaN(b)) {
    res.end("Please give numbers a and b");
  } else {
    res.end(`Product = ${a * b}`);
  }
  break;
}

      default:
        res.end("404 Not Found");
    }
  });
});

server.listen(8000, () => console.log("server started"));