var workerFarm = require('worker-farm');

var workers;

var Preprocessor = function(fn, options) {
  var server = options.server;
  var logger = server.logger;
  var raven_client = server.raven_client;
  var preprocessor = this;
  this.view = options.view;
  this.resources = options.resources || {};
  this.fn = fn;

  // run preprocessor on supplied data
  this.process = function(context, callback) {
    if (!this.fn) return callback(null, context);

    // HACK: worker-farm doesn't send function arguments
    workers(this.fn.toString(), context, function(err, preprocessed_context) {
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
