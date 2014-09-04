const MAX_RESOURCES_CACHE = 50;
const MAX_RESOURCE_AGE = 1000 * 60 * 60 * 24; // 24 hours
const DEFAULT_RESOURCE_FRESHNESS = 60 * 1000; // 60 seconds
const SUCCESSFUL_RESPONSE_CODES = [200];

var _ = require('underscore');
var lru = require('lru-cache');
var ResourceLib = require('solidus-client/lib/resource');
var CachedResource = require('./cached_resource.js');

var cache = lru({
  max: MAX_RESOURCES_CACHE,
  length: function() {return 1},
  maxAge: MAX_RESOURCE_AGE
});

var Resource = function(options, auth, params, logger) {
  this.resource = new ResourceLib(options, auth, params);
  this.logger = logger;
};

Resource.prototype.get = function(callback) {
  if (!this.resource.url) return callback(null, {});

  // TODO: include the auth in the cache key
  var cached_resource = cache.get(this.resource.url);
  if (cached_resource) {
    this.logger.log('Resource recovered from cache: ' + this.resource.url, 3);
    refreshCache.call(this, cached_resource);
    callback(null, cached_resource);
  } else {
    getAndCache.call(this, callback);
  }
};

// PRIVATE

var refreshCache = function(cached_resource) {
  if (!cached_resource.expired() || !cached_resource.lock()) return;

  // The cache is expired, refresh it in the next event loop cycle
  var self = this;
  process.nextTick(function() {
    self.logger.log('Refreshing expired cached resource: ' + self.resource.url, 3);
    getAndCache.call(self, function() {
      cached_resource.unlock();
    });
  });
};

var getAndCache = function(callback) {
  var self = this;

  self.resource.get(function(err, res) {
    if (err) return callback(err, null);

    self.logger.log('Requested resource: [' + res.response.statusCode + '] ' + self.resource.url, 3);
    var cached_resource = new CachedResource(res);

    if (SUCCESSFUL_RESPONSE_CODES.indexOf(res.response.statusCode) > -1) {
      if (!cached_resource.has_expiration) {
        // The response has no cache headers, cache for a default duration
        cached_resource.expires_at = new Date().getTime() + DEFAULT_RESOURCE_FRESHNESS;
      }
      // TODO: include the auth in the cache key
      cache.set(self.resource.url, cached_resource);
    }

    callback(null, cached_resource);
  });
};

Resource.cache = cache;

module.exports = Resource;
