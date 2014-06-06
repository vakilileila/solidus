const TIMEOUT = 5 * 1000;

module.exports = function(fn, context, cb) {
  var preprocess_timeout = setTimeout( function(){
    console.log('process committing suicide');
    process.exit();
  }, TIMEOUT );

  var error;
  try {
    // HACK: worker-farm doesn't send function arguments
    context = eval('(' + fn.toString() + ')')(context);
  } catch( err ){
    error = err;
  } finally {
    clearTimeout( preprocess_timeout );
    if( error ) return cb( error, null );
    return cb( null, context );
  }
};
