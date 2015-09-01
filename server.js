'use strict';
var fs = require('fs');
var url = require('url');
var http2 = require('http2');
var options = {
  key: fs.readFileSync('./ssl.key'),
  cert: fs.readFileSync('./ssl.cert')
};
var cache = new Map();
var stream = require('stream');
var Transform = stream.Transform;
var noms = require('noms');
var mime = require('mime');
var path = require('path');
var cwd = process.cwd();
var mdeps = require('module-deps');
var routex = /^\/(?:node_modules|app|index\.html|boot\.js|package\.json)/;
http2.createServer(options, function (req, res) {
  var path = url.parse(req.url);
  var match = path.pathname && path.pathname.match && path.pathname.match(routex);
  if (!match) {
    return notFound(res);
  }
  console.log(path.pathname);
  getFile(res, '.' + path.pathname);
}).listen(8081, function () {
  console.log('listening on port 8081');
});
function notFound(res, cb) {
  res.writeHead(404, {
  'Content-Type': 'text/plain' });
  res.end('not found', cb);
}
function sendFile(res, file, mimeType, cb) {
  var fullPath = path.resolve(file);
  if (cache.has(fullPath)) {
    let file = cache.get(fullPath);
    if (!file) {
      return process.nextTick(notFound, res, cb);
    }
    return process.nextTick(function () {
      res.writeHead(200, {
      'Content-Type': mimeType });
      res.end(file, cb);
    });
  }
  return fs.readFile(file, function (err, resp) {
    if (err) {
      cache.set(fullPath, false);
      return notFound(res, cb);
    }
    cache.set(fullPath, resp);
    res.writeHead(200, {
    'Content-Type': mimeType });
    res.end(resp, cb);
  });
}
var packageRegexp = /package\.json$/;
function getFile(res, file) {
  if (file.match(packageRegexp)) {
    return sendPackage(res, file, mimeType);
  }
  var mimeType = mime.lookup(file);
  if (mimeType !== 'application/javascript') {
    return sendFile(res, file, mimeType);
  }
  if (file === './node_modules/rave/rave.js') {
    return sendFile(res, file, mimeType);
  }
  sendWithDeps(res, file);
}
function reletivePath(inPath) {
  return path.relative(cwd, inPath);
}
var packageCache = new Map();
function getPackage(fullPath, cb) {
  if (packageCache.has(fullPath)) {
    let file = packageCache.get(fullPath);
    if (!file) {
      return process.nextTick(cb, new Error('not found'));
    }
    return process.nextTick(cb, null, file);
  }
  fs.readFile(fullPath, function (err, resp) {
    if (err) {
      return cb(err);
    }
    var fin;
    try {
      var out = JSON.parse(resp);
      var deps = out.dependencies || {};
      var restring = JSON.stringify(out);
      fin = {
        id: fullPath,
        source: restring,
        dependencies: makeDeps(deps, fullPath)
      };
      packageCache.set(fullPath, fin);
    } catch(e) {
      packageCache.set(fullPath, false);
      return cb(e);
    }
    if (fin) {
      return cb(null, fin);
    }
    cb(new Error('not found'));
  });
}
function getAllPackages(deps) {
  var cache = deps.slice();
  return noms.obj(function (done){
    var self = this;
    if (!cache.length) {
      this.push(null);
      return done();
    }
    var current = cache.shift();
    getPackage(current, function (err, resp) {
      if (err) {
        return done(err);
      }
      self.push(resp);
      if (resp.dependencies.length) {
        cache = cache.concat(resp.dependencies);
      }
      done();
    });
  });
}

function makeDeps(deps, fullPath) {
  var out = [];
  var base = path.dirname(fullPath);
  Object.keys(deps).forEach(function (key) {
    out.push(path.join(base, 'node_modules', key, 'package.json'));
  });
  return out;
}
function sendPackage(res, file, mimeType) {
  var fullPath = path.resolve(file);
  getPackage(fullPath, function (err, resp) {
    if (err) {
      return notFound(res);
    }
    getAllPackages(resp.dependencies).pipe(new Transform({
      objectMode: true,
      flush: function (done) {
        res.writeHead(200, {
        'Content-Type': mimeType });
        res.end(resp.source, done);
      },
        transform: function (chunk, _, next) {
          var shortPath = reletivePath(chunk.id);
          var push = res.push('/' + shortPath);
          push.writeHead(200, {
            'Content-Type': mime.lookup(chunk.id),
            'X-Pushed': file
          });
          push.end(chunk.source);
          next();
        }
    }));
  });
}
function noop(){}
function sendWithDeps(res, file, cb) {
  cb = cb || noop;
  var md = mdeps();
  md.on('error', function (e) {
    console.log(e);
  }).pipe(new Transform({
    objectMode: true,
    transform: function (chunk, _, next) {
      cache.set(chunk.id, chunk.source);
      if (chunk.file === file) {
        return next();
      }
      var shortPath = reletivePath(chunk.id);
      var push = res.push('/' + shortPath);
      push.writeHead(200, {
        'Content-Type': mime.lookup(chunk.id),
        'X-Pushed': file
      });
      push.end(chunk.source);
      next();
    },
    flush: function (done) {
      sendFile(res, file, 'application/javascript', done);
    }
  })).on('end', cb);
  md.end({
    file: file
  });
}
