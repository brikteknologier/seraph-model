var util = require('util');

var modelIndex = 'nodes';

function Model(seraphDb, type) {
  this.type = type;
  this.db = seraphDb;
}

Model.prototype.save = function(object, callback) {
  var self = this;
  this.db.save(object, function(err, saved) {
    if (err) return callback(err);

    self.db.index(modelIndex, saved, 'type', self.type, function(err) {
      if (err) return callback(err);

      callback(null, saved);
    });
  })
}

Model.prototype.findAll = function(callback) {
  db.index.read(modelIndex, 'type', this.type, callback);
}

Model.prototype.where = function(predicate, any, callback) {
  if (typeof any === 'function') {
    callback = any;
    any = false;
  }

  var scope = 'node:' + modelIndex + '(type = "' + this.type + '")';
  db.find(predicate, any, scope, callback);
}
