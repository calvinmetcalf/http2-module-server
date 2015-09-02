'use strict';
var PouchDB = require('pouchdb');
var http = require('http');
var db = new PouchDB('https://skimdb.npmjs.com/registry');
var zlib = require('zlib');
var crypto = require('crypto');
var tar = require('tar-stream');
var semver = require('semver');
var Transform = require('stream').Transform;
var size = Symbol('size');
var Cache = require('lru-cache');
var debug = require('debug')('http2:npm');
var packageCache = new Cache({
  max: 1024 * 1024 * 500,
  length: function (thing) {
    return thing[size];
  }
});
var infoCache = new Cache({
  max: 500
});
exports.getInfo = getInfo;
var promiseCache = new Map();
function getInfo(name) {
  debug(`getting ${name}`);
  var thing = infoCache.get(name);
  if (thing) {
    debug('cache hit');
    return Promise.resolve(thing);
  }
  debug('cache miss');
  if (promiseCache.has(name)) {
    debug('promise cache hit');
    return promiseCache.get(name);
  }
  var prom = db.get(name).then(function (thing) {
    debug('retrieved from couchdb');
    infoCache.set(name, thing);
    promiseCache.delete(name);
    return thing;
  }).catch(function (e) {
    debug('error in couchdb');
    promiseCache.delete(name);
    throw e;
  });
  promiseCache.set(name, prom);
  return prom;
}
exports.matchVersion = matchVersion;
function matchVersion(name, range) {
  range = range || '*';
  debug(`range: ${range}`);
  return getInfo(name).then(function (info) {
    var versions = Object.keys(info.versions);
    debug(versions);
    var version = semver.maxSatisfying(versions, range);
    debug(`version: ${version}`);
    return version;
  });
}
function getTarBall(dist) {
  var name = dist.shasum;
  var cached = packageCache.get(name);
  if (cached) {
    return Promise.resolve(cached);
  }
  if (promiseCache.has(name)) {
    debug('promise cache hit');
    return promiseCache.get(name);
  }
  var hash = crypto.createHash('sha1');
  var unzip = zlib.createGunzip();
  var prom = new Promise(function (yes, no) {
    http.get(dist.tarball, function (resp) {
      resp.on('error', no);
      resp.pipe(hash);
      resp.pipe(unzip);
      yes(Promise.all([new Promise(function (success, failure) {
        hash.on('data', function (d) {
          if (areDifferent(d, dist.shasum)) {
            debug(`hashes do not match  ${dist.shasum}, ${d.toString('hex')}`);
            return failure(new Error('sha1 missmatch'));
          }
          debug(`hashes match`);
          success();
        });
      }), extractTarBall(unzip)]).then(function (things) {
        return things[1];
      }));
    });
  }).then(function (thing) {
    packageCache.set(name, thing);
    promiseCache.delete(name);
    return thing;
  }).catch(function (e) {
    promiseCache.delete(name);
    throw e;
  });
  promiseCache.set(name, prom);
  return prom;
}
function extractTarBall(stream) {
  return new Promise(function (yes, no) {
    var out = {};
    out[size] = 0;
    var extract = tar.extract();
    extract.on('error', no);
    extract.on('entry', function(header, stream, next) {
      var data = new Buffer('');
      out[header.name.slice(8)] = data;
      stream.on('data', function (d) {
        data = Buffer.concat([data, d]);
      });
      stream.on('end', next);
      stream.on('error', no);
    });
    extract.on('finish', function () {
      yes(out);
    });
    stream.pipe(new Transform({
      transform: function (chunk, _, next) {
      out[size] += chunk.length;
      this.push(chunk);
      next();
    }})).pipe(extract);
  });
}
exports.getVersion = getVersion;
function getVersion(name, version) {
  var out = {
    version: version,
    package: name
  };
  return getInfo(name).then(function (info) {
    debug(`version: ${version}`);
    debug(`exists: ${version in info.versions}`);
    if (version in info.versions) {
      return info.versions[version];
    }
    throw new Error('not found');
  }).then(function (version) {
    out.dependencies = version.dependencies;
    return getTarBall(version.dist);
  }).then(function (files) {
    out.files = files;
    return out;
  });
}
exports.get = get;
function get(name, range) {
  return matchVersion(name, range).then(function (version) {
    debug(`version: ${version}`);
    return getVersion(name, version);
  });
}
function areDifferent(a, hex) {
  var b = new Buffer(hex, 'hex');
  var len = a.length;
  if (b.length !== len) {
    return true;
  }
  var out = 0;
  var i = -1;
  while (++i < len) {
    out |= a[i] ^ b[i];
  }
  return out;
}
