const DEFAULT_VIEW_EXTENSION = 'hbs';
const DEFAULT_PORT = 8080;
const DEFAULT_LIVERELOAD_PORT = 35729;
const DEFAULT_DEV_ASSETS_MAX_AGE = 0;
const DEFAULT_PROD_ASSETS_MAX_AGE = 1000 * 60 * 60 * 24 * 365; // 1 year, in ms
const SENTRY_DSN = process.env.SENTRY_DSN;
const SENTRY_LEVEL = process.env.SENTRY_LEVEL;
const DEFAULT_API_ROUTE = '/api';

// native
var fs = require('fs');
var path = require('path');
var util = require('util');
var EventEmitter = require('events').EventEmitter;

// third party
var _ = require('underscore');
var async = require('async');
var http = require('http');
http.globalAgent.maxSockets = Infinity;
var https = require('https');
https.globalAgent.maxSockets = Infinity;
var express = require('express');
var expose = require('express-expose');
var Handlebars = require('handlebars');
var handlebars_helper = require('handlebars-helper');
handlebars_helper.help( Handlebars );
var express_handlebars = require('express3-handlebars');
var chokidar = require('chokidar');
var glob = require('glob');
var raven = require('raven');

// our party! \o/
var Page = require('./page.js');
var Preprocessor = require('./preprocessor.js');
var Resource = require('./resource.js');
var Redirect = require('./redirect.js');
var Logger = require('./logger.js');

// make the path into a Windows compatible path
var deGlobifyPath = function( file_path ){
  return file_path.replace( /(\/)/g, path.sep );
};

// escape backslashes in path for use in regex
var escapePathForRegex = function( file_path ){
  return file_path.replace( /(\\)/g, '\\\\' );
};

var SolidusServer = function( options ){

  // properly inherit from EventEmitter part 1
  EventEmitter.call( this );

  var solidus_server = this;

  // mix options and defaults
  options = options || {};
  var defaults = {
    port: DEFAULT_PORT,
    log_level: 2,
    site_path: process.cwd(),
    assets_max_age: options.dev ? DEFAULT_DEV_ASSETS_MAX_AGE : DEFAULT_PROD_ASSETS_MAX_AGE,
    livereload_port: DEFAULT_LIVERELOAD_PORT,
    api_route: DEFAULT_API_ROUTE
  };
  this.options = options = _( options ).defaults( defaults );

  // file paths
  var paths = this.paths = {
    site: options.site_path,
    views: path.join( options.site_path, 'views' ),
    auth: path.join( options.site_path, 'auth.json' ),
    redirects: path.join( options.site_path, 'redirects.json' ),
    preprocessors: path.join( options.site_path, 'preprocessors' ),
    assets: path.join( options.site_path, 'assets' ),
    notfound: path.join( options.site_path, 'views', '404.hbs' ),
    preprocessors_config: path.join(options.site_path, 'preprocessors.js')
  };

  // set up collections
  var redirects = this.redirects = [];
  var views = this.views = {};
  var preprocessors = this.preprocessors = {};
  var layouts = this.layouts = [];
  var auth = this.auth = {};

  // set up express server
  var router = this.router = express();
  var server = this.server = http.createServer( router );
  var hbs_config = {
    extname: '.hbs',
    partialsDir: paths.views,
    layoutsDir: paths.views,
    handlebars: Handlebars
  };
  if( fs.existsSync( path.join( paths.views, 'layout.hbs' ) ) ) hbs_config.defaultLayout = 'layout';
  var handlebars = this.handlebars = express_handlebars.create( hbs_config );
  router.engine( DEFAULT_VIEW_EXTENSION, handlebars.engine );
  router.set( 'view engine', DEFAULT_VIEW_EXTENSION );
  router.set( 'views', paths.views );
  router.use( express.compress() );
  router.use( express.static( paths.assets, {
    maxAge: options.assets_max_age
  }));
  // catch-all middleware at the end of the stack for 404 handling
  router.use( router.router );
  // log express errors to sentry
  // log uncaught exceptions to sentry and exit
  if( SENTRY_DSN ){
    router.use( raven.middleware.express( SENTRY_DSN ) );
    var raven_client = solidus_server.raven_client = new raven.Client( SENTRY_DSN );
    raven_client.patchGlobal( function(){
      process.exit(1);
    });
  }
  router.use( function( req, res, next ){
    res.status( 404 );
    // it's cheaper to check this than to fs.exists the notfound path
    if( views[paths.notfound] ){
      res.render( paths.notfound );
    }
    else {
      res.send('404 Not Found');
    }
  });

  var locals = {
    dev: options.dev,
    development: options.dev
  };
  if( options.dev ){
    locals.livereload_port = options.livereload_port;
  }
  router.locals(locals);

  // set up the logger
  this.logger = new Logger({
    level: options.log_level
  });

  var layout_regex = new RegExp( '\/layout\.hbs$', 'i' );

  // adds a new page
  // adds a new layout if the view is a layout
  this.addView = function( view_path, callback ){

    var path_to = path.relative( paths.views, view_path );
    var dir_to = path.dirname( path_to );
    var name = path.basename( view_path, '.'+ DEFAULT_VIEW_EXTENSION );
    if( name === 'layout' ) layouts.push( view_path );
    views[view_path] = new Page( view_path, {
      server: solidus_server
    });
    if( callback ) views[view_path].on( 'ready', callback );

  };

  // updates a view's configuration
  this.updateView = function( view_path ){

    views[view_path].parseConfig();

  };

  // removes a view and its route
  this.removeView = function( view_path ){

    views[view_path].destroy();
    delete views[view_path];
    if( layout_regex.test( view_path ) ) layouts = _( layouts ).without( view_path );

  };

  // creates pages for every view
  this.setupViews = function(){

    glob( this.viewPath('**/*'), function( err, view_paths ){
      view_paths = view_paths.map( deGlobifyPath );
      async.each( view_paths, solidus_server.addView, function( err ){
        solidus_server.emit('ready');
      });
    });

  };

  this.viewPath = function(partial_name) {
    return paths.views + '/' + partial_name + '.' + DEFAULT_VIEW_EXTENSION
  };

  this.setupApi = function() {
    this.router.get(this.options.api_route + '/resource.json', function(req, res) {
      if (!Resource.isUrl(req.query.url)) return res.json(400, {error: "Invalid 'url' parameter"});

      var resource = new Resource(req.query.url, {auth: solidus_server.auth, logger: solidus_server.logger});
      resource.render(req, res, solidus_server);
    });
  };

  // loads global auth
  this.setupAuth = function() {
    var auth = {};

    if (fs.existsSync(paths.auth)) {
      try {
        delete require.cache[require.resolve(paths.auth)];
        auth = require(paths.auth);
      } catch (err) {
        return this.logger.log('Error: could not load ' + path.relative(paths.site, paths.auth) + ': ' + err, 3);
      }
    }

    this.auth = auth;
  };

  // creates redirect routes
  this.setupRedirects = function(){
    var redirects = [];

    if (fs.existsSync(paths.redirects)) {
      try {
        delete require.cache[require.resolve(paths.redirects)];
        redirects = require(paths.redirects).map(function(redirect) {
          return new Redirect(redirect, {server: solidus_server});
        });
      } catch (err) {
        return this.logger.log('Error: could not load ' + path.relative(paths.site, paths.redirects) + ': ' + err, 3);
      }
    }

    if (this.redirects) {
      for (var i in this.redirects) this.redirects[i].destroy();
    }
    this.redirects = redirects;
  };

  // updates the source of a preprocessor
  this.updatePreprocessor = function(file_path) {
    delete require.cache[require.resolve(file_path)];
  };

  // creates preprocessor objects
  this.setupPreprocessors = function() {
    var preprocessors = {};

    if (fs.existsSync(paths.preprocessors_config)) {
      try {
        delete require.cache[require.resolve(paths.preprocessors_config)];
        preprocessors = require(paths.preprocessors_config);

        for (var view in preprocessors) {
          var preprocessor = preprocessors[view]();
          var resources = this.createResources(preprocessor.resources);
          preprocessors[view] = new Preprocessor({preprocessors_path: paths.preprocessors_config, view: view, resources: resources, process: preprocessor.process, server: solidus_server});
        }
      } catch (err) {
        return this.logger.log('Error: could not load ' + path.relative(paths.site, paths.preprocessors_config) + ': ' + err, 3);
      }
    }

    Preprocessor.resetWorkers();
    this.preprocessors = preprocessors;
  };

  this.createResources = function(resources) {
    var result = {};
    for (var name in resources) {
      result[name] = new Resource(resources[name], {auth: this.auth, logger: this.logger});
    }
    return result;
  };

  // watches preprocessors dir and adds/removes when necessary
  this.watch = function(){
    var actions = [
      {
        path:   new RegExp(escapePathForRegex(paths.views) + '.+\.hbs', 'i'),
        add:    function(f) {solidus_server.addView(f);},
        change: function(f) {solidus_server.updateView(f);},
        unlink: function(f) {solidus_server.removeView(f);}
      }, {
        path:   new RegExp(escapePathForRegex(paths.preprocessors) + '.+\.js', 'i'),
        add:    function(f) {solidus_server.updatePreprocessor(f); solidus_server.setupPreprocessors(f);},
        change: function(f) {solidus_server.updatePreprocessor(f); solidus_server.setupPreprocessors(f);},
        unlink: function(f) {solidus_server.updatePreprocessor(f);}
      }, {
        path:   new RegExp(escapePathForRegex(paths.preprocessors_config), 'i'),
        add:    function(f) {solidus_server.setupPreprocessors(f);},
        change: function(f) {solidus_server.setupPreprocessors(f);},
        unlink: function(f) {solidus_server.setupPreprocessors(f);}
      }, {
        path:   new RegExp(escapePathForRegex(paths.redirects), 'i'),
        add:    function(f) {solidus_server.setupRedirects(f);},
        change: function(f) {solidus_server.setupRedirects(f);},
        unlink: function(f) {solidus_server.setupRedirects(f);}
      }, {
        path:   new RegExp(escapePathForRegex(paths.auth), 'i'),
        add:    function(f) {solidus_server.setupAuth(f); solidus_server.setupPreprocessors(f);},
        change: function(f) {solidus_server.setupAuth(f); solidus_server.setupPreprocessors(f);},
        unlink: function(f) {solidus_server.setupAuth(f); solidus_server.setupPreprocessors(f);}
      }
    ];

    var handleEvent = function(file_path, event, message) {
      var action = _(actions).find(function(action) {return action.path.test(file_path);});
      if (action && action[event]) {
        solidus_server.logger.log(message + path.relative(paths.site, file_path), 3);
        action[event](file_path);
      }
    };

    this.watcher = chokidar.watch(paths.site, {
      ignored: function(file_path) {
        // Ignore hidden files and directories
        if (/[\/\\]\./.test(file_path)) return true;

        // Ignore /deploy and /node_modules
        var root = path.relative(paths.site, file_path).split(/[\/\\]/)[0];
        if (root == 'deploy' || root == 'node_modules') return true;

        return false;
      },
      ignoreInitial: true,
      interval: 1000
    });

    this.watcher.on('add', function(file_path) {handleEvent(file_path, 'add', 'File created, adding ')});
    this.watcher.on('change', function(file_path) {handleEvent(file_path, 'change', 'File changed, updating ')});
    this.watcher.on('unlink', function(file_path) {handleEvent(file_path, 'unlink', 'File deleted, removing ')});
  };

  // starts the http server
  this.start = function( params ){

    _.extend( this.options, params );
    if( params.log_level ) this.logger.level = params.log_level;
    server.listen( params.port, function(){
      solidus_server.emit( 'listen', params.port );
      solidus_server.logger.log( 'Server running on port '+ params.port, 2 );
    });

  };

  // ends the http listener and stops the server
  this.stop = function(){

    server.close();
    if( this.watcher ) this.watcher.close();

  };

  // use "this" as "this" for all methods attached to "this"
  _( this ).bindAll( 'addView', 'updateView', 'removeView', 'setupRedirects' );

  this.setupViews();
  this.setupApi();
  this.setupAuth();
  this.setupRedirects();
  this.setupPreprocessors();

  if( options.dev ){
    this.watch();
  }

  this.start({
    port: options.port
  });

};

// properly inherit from EventEmitter part 2
util.inherits( SolidusServer, EventEmitter );

// export our module
module.exports = SolidusServer;