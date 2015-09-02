'use strict';
var fs = require('fs');
var url = require('url');
var path = require('path');
var http2 = require('http2');
var options = {
  key: fs.readFileSync('./ssl.key'),
  cert: fs.readFileSync('./ssl.cert')
};
var npm = require('npm');
var routeModule = /^\/module\/([A-Za-z0-9_\-]+)(?:\/([A-Za-z0-9_\-\/\.]+))/;
var routeLocal = /^\/local\/([A-Za-z0-9_\-\/\.]+)/;
var routeLib = /^\/lib\.js$/;
var lib = fs.readFileSync('./lib.js');
http2.createServer(options, function (req, res) {
  var path = url.parse(req.url);
  if (!path.pathname || !path.pathname.match) {
    res.writeHead(400, {
    'Content-Type': 'text/plain' });
    return res.end('bad request');
  }
  if (path.pathname.match(routeLib)) {
    res.writeHead(200, {
    'Content-Type': 'application/javascript' });
    return res.end(lib);
  }
  var match = path.pathname.match(routeModule);
  if (match) {
    return getModule(res, path.pathname, match);
  }
  match = path.pathname.match(routeLocal);
  if (match) {
    return getLocal(res, path.pathname, match);
  }
  notFound(res);
}).listen(8081, function () {
  console.log('listening on port 8081');
});
function getModule(res, pathname, match) {
  var moduleName = match[0];
  var file = match[1];

  if (!file) {
    file = npm.getinfo(moduleName).then(function (info) {
      return info.main;
    });
  } else {
    file = Promise.resolve(file);
  }
  Promise.all([file, npm.get(moduleName)]).then(function (things) {
    var fileName = things[0];
    var files = things[1];
    var names = [
      fileName,
      fileName + '.js',
      fileName + '/index.js'
    ];
    var i = -1;
    while (++i < names.length) {
      if (names[i] in files) {
        return files[names[i]];
      }
    }
    throw new Error('file not found');
  }).then(function (file) {
    res.writeHead(200, {
    'Content-Type': 'application/javascript' });
    return res.end(file);
  });
}
function getLocal(res, pathname, match) {
  var fileName = path.normalize(match[0]);
  fs.readFile(fileName, function (err, resp) {
    if (err) {
      return notFound(res);
    }
    res.writeHead(200, {
    'Content-Type': 'application/javascript' });
    return res.end(resp);
  });
}

function notFound(res, cb) {
  res.writeHead(404, {
  'Content-Type': 'text/plain' });
  res.end('not found', cb);
}
