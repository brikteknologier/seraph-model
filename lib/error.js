// create an errortype
function SeraphError (msg) {
  Error.call(this);
  Error.captureStackTrace(this, arguments.callee);
  this.message = msg;
  this.name = 'Neo4j';
}
SeraphError.prototype = Object.create(Error.prototype);

//create a cast error
function CastError (type, value) {
  SeraphError.call(this, 'Cast to ' + type + ' failed for value "' + value + '"');
  Error.captureStackTrace(this, arguments.callee);
  this.name = 'CastError';
  this.type = type;
  this.value = value;
}
CastError.prototype.__proto__ = SeraphError.prototype;

module.exports.error = SeraphError;
module.exports.castError = CastError;
