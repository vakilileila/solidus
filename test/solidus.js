const DEFAULT_ENCODING = 'UTF8';
const FILESYSTEM_DELAY = 1100;

var path = require('path');
var assert = require('assert');
var async = require('async');
var fs = require('fs');
var moment = require('moment');
var request = require('supertest');
var nock = require('nock');
var zlib = require('zlib');
var timekeeper = require('timekeeper');
var solidus = require('../solidus.js');
var Resource = require('../lib/resource.js');

var original_path = __dirname;
var site1_path = path.join( original_path, 'fixtures', 'site1' );
var site2_path = path.join( original_path, 'fixtures', 'site2' );

var normalizePath = function( file_path ){
  return file_path.replace( /\//g, path.sep );
};

describe( 'Solidus', function(){

  describe( 'production', function(){

    var solidus_server;
    var original_redirects = [];

    beforeEach( function( done ){
      process.chdir( site1_path );
      // Generate time-based redirects
      // These are used to ensure that temporary redirects are properly checked
      original_redirects = fs.readFileSync( 'redirects.json', DEFAULT_ENCODING );
      var original_redirects_arr = JSON.parse( original_redirects );
      var redirect_date_format = 'YYYY-MM-DD HH:mm:ss';
      var temporal_redirects = [{
        start: moment().add( 's', 5 ).format( redirect_date_format ),
        from: '/future-redirect',
        to: '/'
      }, {
        start: moment().subtract( 's', 5 ).format( redirect_date_format ),
        end: moment().add( 's', 5 ).format( redirect_date_format ),
        from: '/current-redirect',
        to: '/'
      }, {
        start: moment().subtract( 's', 10 ).format( redirect_date_format ),
        end: moment().subtract( 's', 5 ).format( redirect_date_format ),
        from: '/past-redirect',
        to: '/'
      }];
      var overlapping_redirects = [{
        start: moment().add( 's', 5 ).format( redirect_date_format ),
        from: '/overlapping-redirect',
        to: '/overlapping-redirect-future'
      }, {
        start: moment().subtract( 's', 5 ).format( redirect_date_format ),
        end: moment().add( 's', 5 ).format( redirect_date_format ),
        from: '/overlapping-redirect',
        to: '/overlapping-redirect-current'
      }, {
        start: moment().subtract( 's', 10 ).format( redirect_date_format ),
        end: moment().subtract( 's', 5 ).format( redirect_date_format ),
        from: '/overlapping-redirect',
        to: '/overlapping-redirect-past'
      }];
      var combined_redirects = JSON.stringify( original_redirects_arr.concat( temporal_redirects, overlapping_redirects ) );
      fs.writeFileSync( 'redirects.json', combined_redirects, DEFAULT_ENCODING );
      Resource.cache.reset();

      // mock http endpoints for resources
      nock('https://solid.us').get('/basic/1').reply( 200, { test: '/basic/1' } );
      nock('https://solid.us').get('/basic/2').times(2).reply( 200, { test: '/basic/2' } );
      nock('https://solid.us').get('/dynamic/segment/3').reply( 200, { test: '/dynamic/segment/3' } );
      nock('https://solid.us').get('/resource/options/url').reply( 200, { test: '/resource/options/url' } );
      nock('https://solid.us').get('/resource/options/query?test=true').reply( 200, { test: '/resource/options/query?test=true' } );
      nock('https://solid.us').get('/resource/options/dynamic/query?test=3').reply( 200, { test: '/resource/options/dynamic/query?test=3' } );
      nock('https://solid.us').get('/resource/options/double/dynamic/query?test2=4&test=3').reply( 200, { test: '/resource/options/double/dynamic/query?test2=4&test=3' } );
      nock('https://solid.us').get('/centralized/auth/query').reply( 200, { test: '/centralized/auth/query' } );
      nock('https://solid.us').get('/resource/options/headers').matchHeader( 'key', '12345' ).reply( 200, { test: '/resource/options/headers' } );
      nock('https://a.solid.us').get('/centralized/auth').matchHeader( 'key', '12345' ).reply( 200, { test: '/centralized/auth' } );
      nock('https://b.solid.us').get('/centralized/auth/query?key=12345').reply( 200, { test: '/centralized/auth/query?key=12345' } );
      // empty dynamic segments
      nock('https://solid.us').get('/dynamic/segment/').reply( 200, { test: false } );
      nock('https://solid.us').get('/resource/options/dynamic/query?test=').reply( 200, { test: false } );
      nock('https://solid.us').get('/resource/options/double/dynamic/query?test2=&test=').reply( 200, { test: false } );

      async.parallel([
        // compressed resources
        function( callback ){
          zlib.gzip( '{"test":"/compressed/gzip"}', function( _, result ){
            nock('https://solid.us').get('/compressed/gzip').reply( 200, result, { 'Content-Encoding': 'gzip' } );
            callback();
          });
        },
        function( callback ){
          zlib.deflate( '{"test":"/compressed/deflate"}', function( _, result ){
            nock('https://solid.us').get('/compressed/deflate').reply( 200, result, { 'Content-Encoding': 'deflate' } );
            callback();
          });
        }
      ],
      function(){
        solidus_server = solidus.start({
          log_level: 0,
          port: 9009
        });
        solidus_server.on( 'ready', done );
      });
    });

    afterEach( function(){
      solidus_server.stop();
      fs.writeFileSync( 'redirects.json', original_redirects, DEFAULT_ENCODING );
      process.chdir( original_path );
    });

    it( 'Starts a new http server', function( done ){
      request( solidus_server.router )
        .get('/')
        .end( function( err, res ){
          if( err ) throw err;
          done();
        });
    });

    it( 'Creates routes based on the contents of /views', function( done ){
      var s_request = request( solidus_server.router );
      async.parallel([
        function( callback ){
          s_request.get('/').expect( 200, callback );
        },
        function( callback ){
          s_request.get('/layout').expect( 200, callback );
        }
      ], function( err, results ){
        if( err ) throw err;
        done();
      });
    });

    it( 'Creates routes with dynamic segments', function( done ){
      var s_request = request( solidus_server.router );
      async.parallel([
        function( callback ){
          s_request.get('/dynamic/1').expect( 200, callback );
        },
        function( callback ){
          s_request.get('/dynamic/2').expect( 200, callback );
        }
      ], function( err, results ){
        if( err ) throw err;
        done();
      });
    });

    it( 'Creates routes for page contexts', function( done ){
      var s_request = request( solidus_server.router );
      async.parallel([
        function( callback ){
          s_request.get('/.json')
            .expect( 'Content-Type', /json/ )
            .expect( 200 )
            .end( function( err, res ){
              assert( res.body.page.title === 'test' );
              assert( res.body.parameters );
              assert( res.body.query );
              callback( err );
            });
        },
        function( callback ){
          s_request.get('/layout.json?test=true')
            .expect( 'Content-Type', /json/ )
            .expect( 200 )
            .end( function( err, res ){
              assert( res.body.page );
              assert( res.body.parameters );
              assert( res.body.query.test );
              callback( err );
            });
        },
        function( callback ){
          s_request.get('/dynamic/1.json')
            .expect( 'Content-Type', /json/ )
            .expect( 200 )
            .end( function( err, res ){
              assert( res.body.page );
              assert( res.body.parameters.segment == '1' );
              assert( res.body.query );
              callback( err );
            });
        },
        function( callback ){
          s_request.get('/dynamic/2.json')
            .expect( 'Content-Type', /json/ )
            .expect( 200 )
            .end( function( err, res ){
              assert( res.body.page );
              assert( res.body.parameters.segment == '2' );
              assert( res.body.query );
              callback( err );
            });
        }
      ], function( err, results ){
        if( err ) throw err;
        done();
      });
    });

    it( 'Returns 404s for unmatched routes', function( done ){
      var s_request = request( solidus_server.router );
      s_request.get('/nonexistent-url')
        .expect( 404 )
        .end( function( err, res ){
          assert( res.text === '404 Not Found' );
          if( err ) throw err;
          done();
        });
    });

    it( 'Makes URL information available in page context', function( done ){
      var s_request = request( solidus_server.router );
      s_request.get('/.json')
        .expect( 'Content-Type', /json/ )
        .expect( 200 )
        .end( function( err, res ){
          assert( res.body.url );
          assert( res.body.url.path === '/.json' );
          if( err ) throw err;
          done();
        });
    });

    it( 'Finds the list of partials used by each page', function( done ){
      var dir = path.join(site1_path, 'views')
      var partials = [
        path.join(dir, 'partial1.hbs'),
        path.join(dir, 'partial1.hbs'),
        path.join(dir, 'partial1.hbs'),
        path.join(dir, 'partial2.hbs'),
        path.join(dir, 'partial2.hbs'),
        path.join(dir, 'partial3.hbs'),
        path.join(dir, 'partial3.hbs'),
        path.join(dir, 'partial/4.hbs'),
        path.join(dir, 'partial9.hbs'),
        path.join(dir, "partial'10.hbs"),
        path.join(dir, 'partial11.hbs'),
        path.join(dir, 'partial"12.hbs')
      ]
      assert.deepEqual(solidus_server.views[path.join(dir, 'multiple_partials.hbs')].params.partials, partials)
      done()
    });

    it( 'Fetches resources and adds them to the page context', function( done ){
      var s_request = request( solidus_server.router );
      async.parallel([
        function( callback ){
          s_request.get('/.json?resource_test=3&resource_test2=4')
            .expect( 'Content-Type', /json/ )
            .expect( 200 )
            .end( function( err, res ){
              assert( res.body.resources.basic.test );
              assert( res.body.resources.basic2.test );
              assert( res.body.resources['dynamic-segment'].test );
              assert( res.body.resources['resource-options-url'].test );
              assert( res.body.resources['resource-options-query'].test );
              assert( res.body.resources['resource-options-headers'].test );
              assert( res.body.resources['resource-options-double-dynamic-query'].test );
              assert( res.body.resources['resource-options-dynamic-query'].test );
              assert( res.body.resources['centralized-auth'].test );
              assert( res.body.resources['centralized-auth-query'].test );
              assert( res.body.resources['compressed-gzip'].test );
              assert( res.body.resources['compressed-deflate'].test );
              callback( err );
            });
        }
      ], function( err, results ){
        if( err ) throw err;
        done();
      });
    });

    it( 'Fetches partials resources and adds them to the page context', function( done ){
      var s_request = request( solidus_server.router );
      async.parallel([
        function( callback ){
          s_request.get('/page_with_resources_and_partials.json')
            .expect( 'Content-Type', /json/ )
            .expect( 200 )
            .end( function( err, res ){
              var resources = {
                'page-resource': {test: '/basic/1'},
                'partial1-resource': {test: '/basic/2'},
                'partial2-resource': {test: '/basic/2'}
              }
              assert.equal(res.body.page.title, 'test');
              assert.deepEqual(res.body.resources, resources);
              callback( err );
            });
        }
      ], function( err, results ){
        if( err ) throw err;
        done();
      });
    });

    it( 'Preprocesses the context of pages', function( done ){
      var s_request = request( solidus_server.router );
      async.parallel([
        function( callback ){
          s_request.get('/.json')
            .expect( 'Content-Type', /json/ )
            .expect( 200 )
            .end( function( err, res ){
              assert( res.body.test === true );
              callback( err );
            });
        },
        function( callback ){
          s_request.get('/infinite.json')
            .expect( 'Content-Type', /json/ )
            .expect( 200 )
            .end( function( err, res ){
              assert( !res.body.test );
              s_request.get('/.json')
                .expect( 'Content-Type', /json/ )
                .expect( 200 )
                .end( function( err, res ){
                  assert( res.body.test === true );
                  callback( err );
                });
            });
        }
      ], function( err, results ){
        if( err ) throw err;
        done();
      });
    });

    it( 'Preprocesses the context of partials', function( done ){
      var s_request = request( solidus_server.router );
      async.parallel([
        function( callback ){
          s_request.get('/page_with_resources_and_partials.json')
            .expect( 'Content-Type', /json/ )
            .expect( 200 )
            .end( function( err, res ){
              var preprocessedBy = [
                'page_with_resources_and_partials.js',
                'partial1_with_resources.js',
                'partial2_with_resources',
                'partial2_with_resources'
              ]
              assert.deepEqual(res.body.preprocessedBy, preprocessedBy);
              callback( err );
            });
        }
      ], function( err, results ){
        if( err ) throw err;
        done();
      });
    });

    it( 'Serves assets in /assets', function( done ){
      var s_request = request( solidus_server.router );
      async.parallel([
        function( callback ){
          s_request.get('/scripts/test.js')
            .expect( 200, callback )
            .expect( 'cache-control', 'public, max-age=31536000' );
        },
        function( callback ){
          s_request.get('/styles/test.css').expect( 200, callback );
        }
      ], function( err, results ){
        if( err ) throw err;
        done();
      });
    });

    it( 'Creates redirects based on the contents of redirects.json', function( done ){
      var s_request = request( solidus_server.router );
      async.parallel([
        function( callback ){
          s_request.get('/redirect1').expect( 302, callback );
        },
        function( callback ){
          s_request.get('/redirect2').expect( 302, callback );
        },
        function( callback ){
          s_request.get('/redirect3').expect( 404, callback );
        },
        function( callback ){
          s_request.get('/redirect4').expect( 404, callback );
        },
        function( callback ){
          s_request.get('/redirect5').expect( 301, callback );
        },
        function( callback ){
          s_request.get('/past-redirect').expect( 404, callback );
        },
        function( callback ){
          s_request.get('/current-redirect').expect( 302, callback );
        },
        function( callback ){
          s_request.get('/future-redirect').expect( 404, callback );
        },
        function( callback ){
          s_request.get('/overlapping-redirect').expect( 'location', '/overlapping-redirect-current', callback );
        }
      ], function( err, results ){
        if( err ) throw err;
        done();
      });
    });

    it( 'Sets the default layout', function(){
      assert( solidus_server.handlebars.defaultLayout === 'layout' );
    });

    it( 'Uses the layout closest to a page view', function( done ){
      var s_request = request( solidus_server.router );
      async.parallel([
        function( callback ){
          s_request
            .get('/deeply/nested/page/using/a_layout.json')
            .expect( 200 )
            .end( function( err, res ){
              assert( res.body.layout === normalizePath('deeply/nested/layout.hbs') );
              callback( err );
            });
        },
        function( callback ){
          s_request
            .get('/deeply/nested/page.json')
            .expect( 200 )
            .end( function( err, res ){
              assert( res.body.layout === normalizePath('deeply/nested/layout.hbs') );
              callback( err );
            });
        }
      ], function( err, results ){
        if( err ) throw err;
        done();
      });
    });

    it( 'Makes partials available even if they have the same name in different directories', function( done ){
      var s_request = request( solidus_server.router );
      async.parallel([
        function( callback ){
          s_request
            .get('/partial_holder/')
            .expect( 200 )
            .end( function( err, res ){
              assert( res.text == 'partial.hbs' );
              callback( err );
            });
        },
        function( callback ){
          s_request
            .get('/partial_holder2/')
            .expect( 200 )
            .end( function( err, res ){
              assert( res.text == 'deeply/partial.hbs' );
              callback( err );
            });
        }
      ], function( err, results ){
        if( err ) throw err;
        done();
      });
    });

    it( 'Sends appropriate cache headers with pages', function( done ){
      var s_request = request( solidus_server.router );
      s_request
        .get('/')
        .expect( 'cache-control', 'public, max-age='+ ( 60 * 5 ) )
        .end( function( err, res ){
          assert( new Date( res.headers['last-modified'] ) < new Date );
          assert( new Date( res.headers['expires'] ) > new Date );
          if( err ) throw err;
          done();
        });
    });

    it( 'Loads handlebars helpers', function( done ){
      var s_request = request( solidus_server.router );
      s_request
        .get('/helpers')
        .end( function( err, res ){
          assert( res.text === 'HANDLEBARS HELPERS LOADED' );
          done();
        });
    });

    describe( 'resource caching', function(){

      function test_caching(cache1, cache2, callback) {
        request(solidus_server.router).get('/caching.json').end(function(err, res) {
          if (err) throw err;
          if (cache1) {
            assert.equal(cache1, res.body.resources.cache1.test);
          } else {
            assert(!res.body.resources.cache1);
          }
          if (cache2) {
            assert.equal(cache2, res.body.resources.cache2.test);
          } else {
            assert(!res.body.resources.cache2);
          }
          callback();
        });
      }

      beforeEach(function() {
        nock('https://solid.us').get('/cache/2').reply( 200, { test: 2 } );
      });

      it( 'Caches the resources', function( done ){
        async.series([
          function(cb) {
            nock('https://solid.us').get('/cache/1').reply( 200, { test: 1 } );
            test_caching(1, 2, cb);
          },
          function(cb) {
            test_caching(1, 2, cb);
          }
          ], done);
      });

      it( 'Does not cache resources with invalid status codes', function( done ){
        async.series([
          function(cb) {
            nock('https://solid.us').get('/cache/1').reply( 500, { test: 1 } );
            test_caching(1, 2, cb);
          },
          function(cb) {
            nock('https://solid.us').get('/cache/1').reply( 200, { test: 3 } );
            test_caching(3, 2, cb);
          }
          ], done);
      });

      it( 'Does not cache resources with invalid data', function( done ){
        async.series([
          function(cb) {
            nock('https://solid.us').get('/cache/1').reply( 200, 'not json' );
            test_caching(null, 2, cb);
          },
          function(cb) {
            nock('https://solid.us').get('/cache/1').reply( 200, { test: 3 } );
            test_caching(3, 2, cb);
          }
          ], done);
      });

      it( 'Renders expired cached resources before refreshing them', function( done ){
        async.series([
          function(cb) {
            nock('https://solid.us').get('/cache/1').reply( 200, { test: 1 }, { 'Cache-Control': 'max-age=0' } );
            test_caching(1, 2, cb);
          },
          function(cb) {
            nock('https://solid.us').get('/cache/1').reply( 200, { test: 3 } );
            test_caching(1, 2, cb);
          },
          function(cb) {
            test_caching(3, 2, cb);
          }
          ], done);
      });

      it( 'Locks expired cached resources while being refreshed', function( done ){
        async.series([
          function(cb) {
            nock('https://solid.us').get('/cache/1').reply( 200, { test: 1 }, { 'Cache-Control': 'max-age=0' } );
            test_caching(1, 2, cb);
          },
          function(cb1) {
            // Delay the response, to make sure the next request comes in before the first one is refreshed
            nock('https://solid.us').get('/cache/1').delay(25).reply( 200, { test: 3 }, { 'Cache-Control': 'max-age=0' } );
            async.parallel([
              function(cb2) {
                test_caching(1, 2, cb2);
              },
              function(cb2) {
                test_caching(1, 2, cb2);
              }
              ], cb1);
          },
          function(cb) {
            // The previous requests are done, but the refresh might not, wait to make sure the lock is released
            setTimeout(function() {
              nock('https://solid.us').get('/cache/1').reply( 200, { test: 4 } );
              test_caching(3, 2, cb);
            }, 50);
          },
          function(cb) {
            test_caching(4, 2, cb);
          }
          ], done);
      });

      it( 'Unlocks expired cached resources with invalid status codes', function( done ){
        async.series([
          function(cb) {
            nock('https://solid.us').get('/cache/1').reply( 200, { test: 1 }, { 'Cache-Control': 'max-age=0' } );
            test_caching(1, 2, cb);
          },
          function(cb) {
            nock('https://solid.us').get('/cache/1').reply( 500, { test: 3 } );
            test_caching(1, 2, cb);
          },
          function(cb) {
            nock('https://solid.us').get('/cache/1').reply( 200, { test: 4 } );
            test_caching(1, 2, cb);
          },
          function(cb) {
            test_caching(4, 2, cb);
          }
          ], done);
      });

      it( 'Unlocks expired cached resources with invalid data', function( done ){
        async.series([
          function(cb) {
            nock('https://solid.us').get('/cache/1').reply( 200, { test: 1 }, { 'Cache-Control': 'max-age=0' } );
            test_caching(1, 2, cb);
          },
          function(cb) {
            nock('https://solid.us').get('/cache/1').reply( 200, 'not json' );
            test_caching(1, 2, cb);
          },
          function(cb) {
            nock('https://solid.us').get('/cache/1').reply( 200, { test: 4 } );
            test_caching(1, 2, cb);
          },
          function(cb) {
            test_caching(4, 2, cb);
          }
          ], done);
      });

    });

    describe('/api/resource.json', function() {
      beforeEach(function() {
        var now = new Date(1397524638000); // Test date rounded to the second, to simplify comparisons
        timekeeper.freeze(now);
      });

      afterEach(function() {
        timekeeper.reset();
      });

      it('fetches and renders the url in the query string', function(done) {
        nock('https://solid.us').get('/api-resource').reply(200, {test: 2});

        var s_request = request(solidus_server.router);
        s_request.get('/api/resource.json?url=https://solid.us/api-resource')
          .expect(200)
          .expect('Content-Type', /json/)
          .end(function(err, res) {
            if (err) throw err;
            assert.deepEqual(res.body, {test: 2});
            done();
          });
      });

      it('renders an error when missing url', function(done) {
        var s_request = request(solidus_server.router);
        s_request.get('/api/resource.json')
          .expect(400)
          .expect('Content-Type', /json/)
          .end(function(err, res) {
            if (err) throw err;
            assert.deepEqual(res.body, {error: "Invalid 'url' parameter"});
            done();
          });
      });

      it('renders an error when bad url', function(done) {
        var s_request = request(solidus_server.router);
        s_request.get('/api/resource.json?url=not-a-url')
          .expect(400)
          .expect('Content-Type', /json/)
          .end(function(err, res) {
            if (err) throw err;
            assert.deepEqual(res.body, {error: "Invalid 'url' parameter"});
            done();
          });
      });

      it('fetches and renders an error when resource is invalid', function(done) {
        nock('https://solid.us').get('/api-resource').reply(200, 'this is not json');

        var s_request = request(solidus_server.router);
        s_request.get('/api/resource.json?url=https://solid.us/api-resource')
          .expect(400)
          .expect('Content-Type', /json/)
          .end(function(err, res) {
            if (err) throw err;
            assert.deepEqual(res.body, {error: 'Invalid JSON: Unexpected token h'});
            done();
          });
      });

      it('returns the resource\'s freshness when the resource is valid and has caching headers', function(done) {
        nock('https://solid.us').get('/api-resource').reply(200, {test: 2}, {'Cache-Control': 'max-age=123'});

        var s_request = request(solidus_server.router);
        s_request.get('/api/resource.json?url=https://solid.us/api-resource')
          .expect('Cache-Control', 'public, max-age=123')
          .expect('Expires', new Date(new Date().getTime() + 123 * 1000).toUTCString())
          .end(function(err, res) {
            if (err) throw err;
            done();
          });
      });

      it('returns the default freshness when the resource is valid and has no caching headers', function(done) {
        nock('https://solid.us').get('/api-resource').reply(200, {test: 2});

        var s_request = request(solidus_server.router);
        s_request.get('/api/resource.json?url=https://solid.us/api-resource')
          .expect('Cache-Control', 'public, max-age=60')
          .expect('Expires', new Date(new Date().getTime() + 60 * 1000).toUTCString())
          .end(function(err, res) {
            if (err) throw err;
            done();
          });
      });

      it('returns the resource\'s freshness when the resource is invalid and has caching headers', function(done) {
        nock('https://solid.us').get('/api-resource').reply(400, {test: 2}, {'Cache-Control': 'max-age=123'});

        var s_request = request(solidus_server.router);
        s_request.get('/api/resource.json?url=https://solid.us/api-resource')
          .expect('Cache-Control', 'public, max-age=123')
          .expect('Expires', new Date(new Date().getTime() + 123 * 1000).toUTCString())
          .end(function(err, res) {
            if (err) throw err;
            done();
          });
      });

      it('returns no freshness when the resource is invalid and has no caching headers', function(done) {
        nock('https://solid.us').get('/api-resource').reply(400, {test: 2});

        var s_request = request(solidus_server.router);
        s_request.get('/api/resource.json?url=https://solid.us/api-resource')
          .expect('Cache-Control', 'public, max-age=0')
          .expect('Expires', new Date().toUTCString())
          .end(function(err, res) {
            if (err) throw err;
            done();
          });
      });

      it('fetches the url using the appropriate auth', function(done) {
        nock('https://a.solid.us').get('/api-resource').matchHeader('key', '12345').reply(200, {test: 2});

        var s_request = request(solidus_server.router);
        s_request.get('/api/resource.json?url=https://a.solid.us/api-resource')
          .expect(200)
          .expect('Content-Type', /json/)
          .end(function(err, res) {
            if (err) throw err;
            assert.deepEqual(res.body, {test: 2});
            done();
          });
      });
    });
  });

  describe( 'development', function(){

    var solidus_server;

    beforeEach( function( done ){
      process.chdir( site2_path );
      solidus_server = solidus.start({
        log_level: 0,
        port: 9009,
        dev: true,
        livereload_port: 12345
      });
      // hack that will work until .start callback is complete
      solidus_server.on( 'ready', function(){
        setTimeout( done, FILESYSTEM_DELAY );
      });
    });

    afterEach( function(){
      solidus_server.stop();
      process.chdir( original_path );
    });

    it( 'Adds a route when a new view is added', function( done ){
      fs.writeFileSync( 'views/watch_test.hbs', 'test', DEFAULT_ENCODING );
      var s_request = request( solidus_server.router );
      setTimeout( function(){
        s_request.get('/watch_test').expect( 200, function( err ){
          if( err ) throw err;
          done();
        });
      }, FILESYSTEM_DELAY );
    });

    it( 'Removes a route when a view is removed', function( done ){
      fs.unlinkSync('views/watch_test.hbs');
      var s_request = request( solidus_server.router );
      setTimeout( function(){
        s_request.get('/watch_test').expect( 404, function( err ){
          if( err ) throw err;
          done();
        });
      }, FILESYSTEM_DELAY );
    });

    var redirects = [{
      "from": "/redirect1",
      "to": "/"
    }];

    it( 'Adds redirects when redirects.json is added', function( done ){
      var s_request = request( solidus_server.router );
      var redirects_json = JSON.stringify( redirects );
      fs.writeFileSync( 'redirects.json', redirects_json, DEFAULT_ENCODING );
      setTimeout( function(){
        s_request.get('/redirect1').expect( 302, function( err ){
          if( err ) throw err;
          done();
        });
      }, FILESYSTEM_DELAY );
    });

    it( 'Updates redirects when redirects.json changes', function( done ){
      var s_request = request( solidus_server.router );
      redirects.push({
        from: '/redirect2',
        to: '/'
      });
      var redirects_json = JSON.stringify( redirects );
      fs.writeFileSync( 'redirects.json', redirects_json, DEFAULT_ENCODING );
      setTimeout( function(){
        s_request.get('/redirect2').expect( 302, function( err ){
          if( err ) throw err;
          done();
        });
      }, FILESYSTEM_DELAY );
    });

    it( 'Removes redirects when redirects.json is deleted', function( done ){
      var s_request = request( solidus_server.router );
      fs.unlinkSync('redirects.json');
      setTimeout( function(){
        s_request.get('/redirect1').expect( 404, function( err ){
          if( err ) throw err;
          done();
        });
      }, FILESYSTEM_DELAY );
    });

    var test_preprocessor_contents = 'module.exports.process=function(context){context.test = true;return context;};';

    it( 'Adds preprocessors when a preprocessor js file is added', function( done ){
      var s_request = request( solidus_server.router );
      fs.writeFileSync( 'preprocessors/test.js', test_preprocessor_contents, DEFAULT_ENCODING );
      setTimeout( function(){
        s_request.get('/test.json')
          .expect( 200 )
          .end( function( err, res ){
            if( err ) throw err;
            assert( res.body.test );
            fs.unlinkSync('preprocessors/test.js');
            done();
          });
      }, FILESYSTEM_DELAY );
    });

    var test_preprocessor_contents_2 = 'module.exports.process=function(context){context.test2 = true;return context;};';

    it( 'Updates preprocessors when their files change', function( done ){
      var s_request = request( solidus_server.router );
      fs.writeFileSync( 'preprocessors/test.js', test_preprocessor_contents_2, DEFAULT_ENCODING );
      setTimeout( function(){
        s_request.get('/test.json')
          .expect( 200 )
          .end( function( err, res ){
            if( err ) throw err;
            assert( res.body.test2 );
            done();
          });
      }, FILESYSTEM_DELAY );
    });

    it( 'Removes preprocessors when their file is removed', function( done ){
      fs.unlinkSync('preprocessors/test.js');
      var s_request = request( solidus_server.router );
      setTimeout( function(){
        s_request.get('/test.json')
          .expect( 200 )
          .end( function( err, res ){
            if( err ) throw err;
            assert( !res.body.test );
            done();
          });
      }, FILESYSTEM_DELAY );
    });

    var old_preprocessors_config =
"module.exports = {\n\
  'test.hbs': function() {\n\
    return require('./preprocessors/test.js');\n\
  }\n\
};\n\
"
    var new_preprocessors_config =
"module.exports = {\n\
  'test.hbs': function() {\n\
    return {\n\
      process: function(context) {\n\
        context.test_new = true;\n\
        return context;\n\
      }\n\
    }\n\
  }\n\
};\n\
"

    it('Updates preprocessors config when preprocessors.js changes', function(done) {
      var s_request = request(solidus_server.router);
      fs.writeFileSync('preprocessors.js', new_preprocessors_config, DEFAULT_ENCODING);
      setTimeout(function() {
        s_request.get('/test.json')
          .expect(200)
          .end(function(err, res) {
            if (err) throw err;
            assert(!res.body.test);
            assert(res.body.test_new);
            done();
          });
      }, FILESYSTEM_DELAY);
    });

    it('Clears preprocessors config when preprocessors.js is deleted', function(done) {
      var s_request = request(solidus_server.router);
      fs.unlinkSync('preprocessors.js');
      setTimeout(function() {
        s_request.get('/test.json')
          .expect(200)
          .end(function(err, res) {
            if (err) throw err;
            assert(!res.body.test);
            assert(!res.body.test_new);
            done();
          });
      }, FILESYSTEM_DELAY);
    });

    it('Adds preprocessors config when preprocessors.js is added', function(done) {
      var s_request = request(solidus_server.router);
      fs.writeFileSync('preprocessors.js', new_preprocessors_config, DEFAULT_ENCODING);
      setTimeout(function() {
        s_request.get('/test.json')
          .expect(200)
          .end(function(err, res) {
            if (err) throw err;
            fs.writeFileSync('preprocessors.js', old_preprocessors_config, DEFAULT_ENCODING);
            assert(!res.body.test);
            assert(res.body.test_new);
            done();
          });
      }, FILESYSTEM_DELAY);
    });

    it( 'Passes dev variables to view context', function( done ){
      var s_request = request( solidus_server.router );
      s_request.get('/dev.json')
        .expect( 200 )
        .end( function( err, res ){
          if( err ) throw err;
          assert( res.body.dev );
          assert( res.body.development );
          assert.equal( 12345, res.body.livereload_port );
          done();
        });
    });

    it( 'Does not send cache headers in development', function( done ){
      var s_request = request( solidus_server.router );
      s_request.get('/')
        .expect( 'cache-control', null )
        .expect( 'last-modified', null )
        .expect( 'expires', null )
        .end( function( err, res ){
          done();
        });
    });

    it( 'Does not cache assets in development', function( done ){
      var s_request = request( solidus_server.router );
      s_request.get('/scripts/test.js')
        .expect( 'cache-control', 'public, max-age=0' )
        .end( function( err, res ){
          done();
        });
    });

  });

});