var workerFarm = require('worker-farm');

var workers;

var Preprocessor = function(options) {
  var server = options.server;
  var logger = server.logger;
  var raven_client = server.raven_client;
  var preprocessor = this;
  this.preprocessors_path = options.preprocessors_path;
  this.view = options.view;
  this.resources = options.resources || {};
  this.has_process = !!options.process;

  // run preprocessor on supplied data
  this.process = function(context, callback) {
    if (!this.has_process) return callback(null, context);

    workers(this.preprocessors_path, this.view, context, function(err, preprocessed_context) {
      // preprocessor errors don't bubble up
      // so log them here
      if( err ){
        logger.log( 'Preprocessor Error:\n'+ err.stack, 0 );
        if( raven_client ){
          raven_client.captureError( err, {
            extra: {
              context: context
            }
          });
        }
        if( callback ) return callback( null, context );
      }
      if( callback ) return callback( null, preprocessed_context );
    });
  };
};

Preprocessor.setWorkers = function(){
  workers = workerFarm({
    maxCallsPerWorker: 100,
    maxConcurrentWorkers: 4,
    maxConcurrentCallsPerWorker: -1,
    maxCallTime: 1000
  }, require.resolve('./preprocessor_worker.js'));
};

// destroy and re-initialize worker farm
// this is used to update preprocessor modules in development
Preprocessor.resetWorkers = function(){
  workerFarm.end( workers );
  Preprocessor.setWorkers();
};

Preprocessor.setWorkers();

module.exports = Preprocessor;
