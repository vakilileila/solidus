const MAX_RESOURCES_CACHE = 50;
const MAX_RESOURCE_AGE = 1000 * 60 * 60 * 24; // 24 hours
const DEFAULT_RESOURCE_FRESHNESS = 60 * 1000; // 60 seconds
const DEFAULT_ENCODING = 'UTF8';
const SUCCESSFUL_RESPONSE_CODES = [200];

var _ = require('underscore');
var url = require('url');
var hyperquest = require('hyperquest');
var zlib = require('zlib');
var lru = require('lru-cache');

var CachedResource = require('./cached_resource.js');

var cache = lru({
  max: MAX_RESOURCES_CACHE,
  length: function(n) {return 1},
  maxAge: MAX_RESOURCE_AGE
});

function Resource(resource, options) {
  this.render = function(req, res, server) {
    this.fetch({}, function(err, cached_resource) {
      if (err) return res.json(400, {error: err});

      if (!server.options.dev) {
        res.set({
          'Cache-Control': 'public, max-age=' + cached_resource.maxAge(),
          'Expires': new Date(cached_resource.expires_at).toUTCString()
        });
      }
      res.json(cached_resource.data);
    });
  };

  this.fetch = function(params, callback) {
    var resource_url = this.generateUrl(params);
    if (!resource_url) return callback(null, {});

    var cached_resource = this.fetchCached(resource_url);
    if (cached_resource) {
      this.logger.log('Resource recovered from cache: ' + resource_url, 3);
      callback(null, cached_resource);
    } else {
      this.fetchAndCache(resource_url, callback);
    }
  };

  // PRIVATE

  this.prepareOptions = function(resource, auth) {
    if (_.isString(resource)) {
      resource = {url: resource};
    }

    // Add auth options
    if (auth) {
      _.each(auth, function(options, match) {
        var matcher = new RegExp(match, 'ig');
        if (matcher.test(resource.url)) {
          resource = _.extend(resource, options);
        }
      });
    }

    // Retrieve compressed response if possible
    if (!resource.headers) resource.headers = {};
    if (!resource.headers['Accept-Encoding']) resource.headers['Accept-Encoding'] = 'gzip,deflate';

    return resource;
  };

  this.generateUrl = function(params) {
    if (!Resource.isUrl(this.options.url)) return null;

    // Replace variable strings like {this} in the resource url with url or query parameters
    var expandVariables = function(string) {
      return string.replace(/\{([^\}]*)\}/ig, function(match, capture, index, str) {
        return params[capture] || '';
      });
    };

    var resource_url = expandVariables(this.options.url);

    // Loop through query params looking for dynamic bits
    var query = {};
    for (var key in this.options.query) {
      query[key] = typeof this.options.query[key] === 'string'
        ? expandVariables(this.options.query[key])
        : this.options.query[key];
    }

    var url_bits = url.parse(resource_url, true);
    url_bits.query = _.defaults(url_bits.query, query);
    delete url_bits.search; // This will confuse url.format if we leave it in
    resource_url = url.format(url_bits);

    return resource_url;
  };

  this.fetchCached = function(resource_url) {
    var cached_resource = cache.get(resource_url);
    if (!cached_resource) return false;

    var self = this;

    if (cached_resource.expired() && cached_resource.lock()) {
      // The cache is expired, refresh it in the next event loop cycle
      process.nextTick(function() {
        self.logger.log('Refreshing expired cached resource: ' + resource_url, 3);
        self.fetchAndCache(resource_url, function() {
          cached_resource.unlock();
        });
      });
    }

    return cached_resource;
  };

  this.fetchAndCache = function(resource_url, callback) {
    var cache_options = {request_time: new Date().getTime()};
    var self = this;

    hyperquest(resource_url, this.options, function(err, res) {
      if (err) return callback(err, null);

      self.logger.log('Requested resource: [' + res.statusCode + '] ' + resource_url, 3);
      cache_options.response = res;
      cache_options.response_time = new Date().getTime();

      self.parseResponse(res, function(err, data) {
        if (err) return callback(err, null);

        cache_options.data = data;
        var cached_resource = new CachedResource(cache_options);

        if (SUCCESSFUL_RESPONSE_CODES.indexOf(res.statusCode) > -1) {
          if (!cached_resource.has_expiration) {
            // The response has no cache headers, cache for a default duration
            cached_resource.expires_at = new Date().getTime() + DEFAULT_RESOURCE_FRESHNESS;
          }
          cache.set(resource_url, cached_resource);
        }

        return callback(null, cached_resource);
      });
    });
  };

  this.parseResponse = function(res, callback) {
    var data = '';

    if (res.headers['content-encoding'] == 'gzip' || res.headers['content-encoding'] == 'deflate') {
      // Response is compressed
      res = res.pipe(new zlib.Unzip());
    }

    res.on('data', function onData(chunk) {
      data += chunk;
    });

    res.on('end', function onEnd() {
      try {
        data = JSON.parse(data.toString(DEFAULT_ENCODING));
      } catch (err) {
        return callback('Invalid JSON: ' + err.message, null);
      }

      callback(null, data);
    });
  };

  this.options = this.prepareOptions(resource, options.auth);
  this.logger = options.logger;
};

Resource.isUrl = function(string) {
  return /^https?:\/\/.+/.test(string)
}

Resource.cache = cache;

module.exports = Resource;
