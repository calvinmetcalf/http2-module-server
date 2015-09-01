'use strict';
var PouchDB = require('pouchdb');
var http = require('http');
var db = new PouchDB('https://skimdb.npmjs.com/registry');
var zlib = require('zlib');
var crypto = require('crypto');
exports.getInfo = getInfo;

function getInfo(name) {
  return db.get(name);
}
function getTarBall(dist) {
  var hash = crypto.createHash('sha1');
  var unzip = zlib.createGunzip();
  return new Promise(function (yes, no) {
    http.get(dist.tarball, function (resp) {
      resp.pipe(hash);
      resp.pipe(unzip);
      yes(Promise.all([new Promise(function (success, failure) {
        hash.on('data', function (d) {
          if (d.toString('hex') !== dist.shasum) {
            return failure(new Error('sha1 missmatch'));
          }
          success();
        });
      }), new Promise(function (success, failure) {
        var data = new Buffer('');
        unzip.on('data', function (d) {
          data = Buffer.concat([data, d]);
        }).on('end', function () {
          success(data);
        }).on('error', failure);
      })]).then(function (things) {
        return things[1];
      }));
    });
  });
}
exports.getVersion = getVersion;
function getVersion(name, version) {
  return getInfo(name).then(function (info) {
    if (version in info.versions) {
      return info.versions[version];
    }
    throw new Error('not found');
  }).then(function (version) {
    return getTarBall(version.dist);
  });
}
