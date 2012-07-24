var util = require('util');
var async = require('async');
var modelIndex = 'nodes';

function Model(seraphDb, type) {
  this.type = type;
  this.db = seraphDb;
  this.validators = [];
  this.preparers = [];
  this.fields = [];

  this.preparers.push(function whitelist(obj, callback) {
    if (!Array.isArray(this.fields) || !this.fields.length) {
      callback(null, object);
    } else {
      var result = {};
      this.fields.each(function(field) {
        if (field in obj) result[field] = obj[field];
      });
      callback(null, result);
    }
  }.bind(this))
}

Model.prototype.save = function(object, callback) {
  var self = this;
  async.waterfall([
    this.prepare.bind(this, object),

    function validate(object, callback) {
      self.validate(object, function(err) {
        if (err) {
          callback(err);
        } else {
          callback(null, object);
        }
      })
    },

    this._unsafeSave.bind(this)
  ], callback);
}

Model.prototype._unsafeSave = function(object, callback) {
  var self = this;
  this.db.save(object, function(err, saved) {
    if (err) return callback(err);

    self.db.index(modelIndex, saved, 'type', self.type, function(err) {
      if (err) return callback(err);

      callback(null, saved);
    });
  })
}

Model.prototype.validate = function(object, callback) {
  if (!Array.isArray(this.validators) || !this.validators.length) {
    callback();
  } else {
    async.forEach(this.validators, function(validator, callback) {
      validator(object, callback);
    }, callback);
  }
}

Model.prototype.prepare = function(object, callback) {
  if (!Array.isArray(this.preparers) || !this.preparers.length) {
    callback();
  } else {
    async.waterfall(this.preparers, callback);
  }
}

Model.prototype.findAll = function(callback) {
  this.db.index.read(modelIndex, 'type', this.type, callback);
}

Model.prototype.where = function(predicate, any, callback) {
  if (typeof any === 'function') {
    callback = any;
    any = false;
  }

  this.db.find(predicate, any, this.cypherStart(), callback);
}


Model.prototype.cypherStart = function() {
  return 'node:' + modelIndex + '(type = "' + this.type + '")';
}