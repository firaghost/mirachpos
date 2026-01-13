'use strict';

module.exports = function whitebirdShim() {
  throw new Error('whitebird shim: this dependency was unpublished from npm; this local shim exists only to satisfy unzipper transitive dependency during install.');
};
